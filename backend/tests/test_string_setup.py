from tests.test_songs import guest, person

SETUP = {"open": {"1": 1.7e-5, "2": 4.2e-5, "3": 3.7e-5}, "misfit": {"1": 0.34, "2": 0.31, "3": 2.46}}


def test_no_setup_until_the_student_saves_one():
    isura = person("Isura", "isura@example.com")
    missing = isura.get("/api/string-setup")
    assert missing.status_code == 404 and missing.json()["detail"] == "No guitar setup yet."


def test_save_the_setup_and_read_it_back_saving_again_replaces_it():
    isura = person("Isura", "isura@example.com")
    saved = isura.put("/api/string-setup", json=SETUP)
    assert saved.status_code == 200
    body = saved.json()
    assert body["open"] == SETUP["open"] and body["misfit"] == SETUP["misfit"] and body["savedAt"]
    assert isura.get("/api/string-setup").json()["open"] == SETUP["open"]
    isura.put("/api/string-setup", json={"open": {"6": 1.76e-4}})
    again = isura.get("/api/string-setup").json()
    assert again["open"] == {"6": 1.76e-4} and again["misfit"] == {}


def test_the_setup_is_private_and_needs_an_account():
    isura = person("Isura", "isura@example.com")
    nimal = person("Nimal", "nimal@example.com")
    isura.put("/api/string-setup", json=SETUP)
    assert nimal.get("/api/string-setup").status_code == 404
    visitor = guest()
    assert visitor.get("/api/string-setup").status_code == 401
    assert visitor.put("/api/string-setup", json=SETUP).status_code == 401


def test_only_real_measurements_are_kept():
    isura = person("Isura", "isura@example.com")
    for bad in (
        {"open": {}},
        {"open": {"7": 1e-5}},
        {"open": {"1": 0}},
        {"open": {"1": 0.5}},
        {"open": {"1": 1e-5}, "misfit": {"1": 4.0}},
        {"open": {"1": 1e-5}, "extra": 1},
    ):
        assert isura.put("/api/string-setup", json=bad).status_code == 422, bad
    assert isura.get("/api/string-setup").status_code == 404


def test_remove_the_setup():
    isura = person("Isura", "isura@example.com")
    isura.put("/api/string-setup", json=SETUP)
    assert isura.delete("/api/string-setup").status_code == 204
    assert isura.get("/api/string-setup").status_code == 404
    assert isura.delete("/api/string-setup").status_code == 404
