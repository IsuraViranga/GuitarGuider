from tests.test_songs import guest, person, seed, song

FIRST_FRETS = "sample-first-frets"  # 8 steps


def practice(steps=8, completed=True, wrong=None, **extra):
    record = [{"wrong": [], "result": "correct"} for _ in range(steps)]
    for index, tries in (wrong or {}).items():
        record[index] = {"wrong": tries, "result": "correct"}
    wrong_count = sum(len(t) for t in (wrong or {}).values())
    return {"mode": "strict", "completed": completed, "wrongCount": wrong_count, "bestStreak": 5, "skippedCount": 0, "record": record, **extra}


def test_save_a_practice_and_see_it_in_my_progress():
    seed()
    isura = person("Isura", "isura@example.com")
    saved = isura.put(f"/api/progress/{FIRST_FRETS}", json=practice(wrong={1: [{"heardMidi": 67}]}))
    assert saved.status_code == 200
    body = saved.json()
    assert body["songTitle"] == "First Frets on String 1" and body["songScope"] == "global"
    assert body["rating"] == 2 and body["rightCount"] == 8 and body["wrongCount"] == 1 and body["totalSteps"] == 8
    [listed] = isura.get("/api/progress").json()["progress"]
    assert listed["songId"] == FIRST_FRETS
    detail = isura.get(f"/api/progress/{FIRST_FRETS}").json()
    assert detail["record"][1] == {"wrong": [{"heardMidi": 67.0}], "result": "correct"}


def test_a_wrong_string_try_keeps_where_it_was_played():
    seed()
    isura = person("Isura", "isura@example.com")
    wrong_string = {"heardMidi": 64.1, "heardPosition": {"stringNumber": 2, "fret": 5}}
    assert isura.put(f"/api/progress/{FIRST_FRETS}", json=practice(wrong={0: [wrong_string, {"heardMidi": 65}]})).status_code == 200
    detail = isura.get(f"/api/progress/{FIRST_FRETS}").json()
    assert detail["record"][0]["wrong"] == [wrong_string, {"heardMidi": 65.0}]
    bad = {"heardMidi": 64, "heardPosition": {"stringNumber": 7, "fret": 5}}
    assert isura.put(f"/api/progress/{FIRST_FRETS}", json=practice(wrong={0: [bad]})).status_code == 422


def test_only_one_saved_practice_per_song_saving_again_replaces_it():
    seed()
    isura = person("Isura", "isura@example.com")
    isura.put(f"/api/progress/{FIRST_FRETS}", json=practice(wrong={0: [{"heardMidi": 60}]}))
    isura.put(f"/api/progress/{FIRST_FRETS}", json=practice())
    listed = isura.get("/api/progress").json()["progress"]
    assert len(listed) == 1 and listed[0]["rating"] == 3 and listed[0]["wrongCount"] == 0


def test_the_rating_follows_the_result():
    seed()
    isura = person("Isura", "isura@example.com")
    assert isura.put(f"/api/progress/{FIRST_FRETS}", json=practice()).json()["rating"] == 3
    many = {i: [{"heardMidi": 60}] for i in range(4)}
    assert isura.put(f"/api/progress/{FIRST_FRETS}", json=practice(wrong=many)).json()["rating"] == 1
    unfinished = practice(completed=False)
    unfinished["record"][7] = {"wrong": [], "result": None}
    saved = isura.put(f"/api/progress/{FIRST_FRETS}", json=unfinished).json()
    assert saved["rating"] is None and saved["completed"] is False and saved["playedSteps"] == 7


def test_progress_is_private_and_needs_an_account():
    seed()
    isura = person("Isura", "isura@example.com")
    admin = person("Admin", "admin@example.com", admin=True)
    isura.put(f"/api/progress/{FIRST_FRETS}", json=practice())
    assert admin.get("/api/progress").json()["progress"] == []
    assert admin.get(f"/api/progress/{FIRST_FRETS}").status_code == 404
    visitor = guest()
    assert visitor.get("/api/progress").status_code == 401
    assert visitor.put(f"/api/progress/{FIRST_FRETS}", json=practice()).status_code == 401


def test_own_songs_can_be_saved_but_not_someone_elses():
    isura = person("Isura", "isura@example.com")
    rasika = person("Rasika", "rasika@example.com")
    mine = isura.post("/api/songs", json=song()).json()["id"]  # 3 steps
    assert isura.put(f"/api/progress/{mine}", json=practice(steps=3)).status_code == 200
    assert rasika.put(f"/api/progress/{mine}", json=practice(steps=3)).status_code == 404


def test_a_practice_that_does_not_match_the_song_is_refused():
    seed()
    isura = person("Isura", "isura@example.com")
    wrong_length = isura.put(f"/api/progress/{FIRST_FRETS}", json=practice(steps=5))
    assert wrong_length.status_code == 422 and "does not match the song" in wrong_length.json()["detail"]
    bad = practice()
    bad["record"][0] = {"wrong": [], "result": "maybe"}
    assert isura.put(f"/api/progress/{FIRST_FRETS}", json=bad).status_code == 422
    assert isura.put(f"/api/progress/{FIRST_FRETS}", json=practice(mode="fast")).status_code == 422


def test_chords_heard_are_kept():
    seed()
    isura = person("Isura", "isura@example.com")
    saved = practice(wrong={2: [{"heardChord": "G"}, {"heardChord": None}]})
    isura.put(f"/api/progress/{FIRST_FRETS}", json=saved)
    assert isura.get(f"/api/progress/{FIRST_FRETS}").json()["record"][2]["wrong"] == [{"heardChord": "G"}, {"heardChord": None}]


def test_remove_a_saved_practice_and_it_goes_when_the_song_goes():
    isura = person("Isura", "isura@example.com")
    mine = isura.post("/api/songs", json=song()).json()["id"]
    isura.put(f"/api/progress/{mine}", json=practice(steps=3))
    assert isura.delete(f"/api/progress/{mine}").status_code == 204
    assert isura.get("/api/progress").json()["progress"] == []
    isura.put(f"/api/progress/{mine}", json=practice(steps=3))
    isura.delete(f"/api/songs/{mine}")
    assert isura.get("/api/progress").json()["progress"] == []
