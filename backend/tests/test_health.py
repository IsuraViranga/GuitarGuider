import app.main as main


def test_liveness_answers_without_the_database(client, monkeypatch):
    def no_database():
        raise AssertionError("liveness must not use the database")

    monkeypatch.setattr(main.engine, "connect", no_database)
    response = client.get("/api/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}
    assert response.headers["cache-control"] == "no-store"


def test_readiness_checks_the_database_and_its_tables(client):
    response = client.get("/api/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "ok", "migration": main._latest_migration()}


def test_not_ready_when_the_database_does_not_answer(client, monkeypatch):
    def down():
        raise OSError("connection refused")

    monkeypatch.setattr(main.engine, "connect", down)
    response = client.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "not ready", "database": "unreachable"}


def test_not_ready_when_a_table_change_is_missing(client, monkeypatch):
    current = main._latest_migration()
    monkeypatch.setattr(main, "_latest_migration", lambda: "9999_future")
    response = client.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "not ready", "database": "ok", "migration": current, "expected": "9999_future"}


def test_the_old_health_addresses_still_work(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/health/db").json() == {"status": "ok"}
