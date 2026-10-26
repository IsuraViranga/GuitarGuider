from fastapi.testclient import TestClient

from app.cli import create_admin
from app.db import SessionLocal
from app.main import app
from app.models import Song
from app.seed import load_seed_songs, seed_global_songs

HEADERS = {"X-Requested-With": "fetch"}
OPEN = {1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40}


def note(i, string, fret, lyric=None, measure=None):
    n = {"index": i, "midi": OPEN[string] + fret, "position": {"stringNumber": string, "fret": fret}}
    if lyric:
        n["lyric"] = lyric
    if measure is not None:
        n["measure"] = measure
    return n


def chord(i, *positions, name=None):
    tones = [{"midi": OPEN[s] + f, "position": {"stringNumber": s, "fret": f}} for s, f in positions]
    lowest = min(tones, key=lambda t: t["midi"])
    return {"index": i, "midi": lowest["midi"], "position": lowest["position"], "chord": {"tones": tones, **({"name": name} if name else {})}}


def song(title="My Song", **extra):
    return {"title": title, "tuningId": "standard", "sourceText": "10 11 13", "notes": [note(0, 1, 0), note(1, 1, 1), note(2, 1, 3)], **extra}


def person(name, email, admin=False):
    client = TestClient(app, headers=HEADERS)
    if admin:
        create_admin(email, name, "admin-pass-1")
        assert client.post("/api/auth/signin", json={"email": email, "password": "admin-pass-1"}).status_code == 200
    else:
        assert client.post("/api/auth/signup", json={"name": name, "email": email, "password": "guitar-123"}).status_code == 201
    return client


def guest():
    return TestClient(app, headers=HEADERS)


def seed():
    with SessionLocal() as db:
        return seed_global_songs(db)


# ---------- built-in songs ----------


def test_built_in_songs_are_added_to_the_global_set_list_once():
    added = seed()
    assert "library-twinkle-twinkle" in added and "sample-first-frets" in added
    assert seed() == []  # running again (every deploy) adds nothing
    songs = guest().get("/api/songs").json()["songs"]
    assert len(songs) == len(load_seed_songs())
    twinkle = guest().get("/api/songs/library-twinkle-twinkle").json()
    assert twinkle["title"] == "Twinkle, twinkle"
    assert twinkle["noteCount"] == 42 and twinkle["scope"] == "global"
    assert twinkle["notes"][0]["lyric"] == "Twin"
    assert twinkle["sourceText"].startswith("title: Twinkle, twinkle")


def test_a_built_in_song_the_admin_deleted_is_not_added_again():
    seed()
    admin = person("Isura", "admin@example.com", admin=True)
    assert admin.delete("/api/songs/sample-first-frets").status_code == 204
    assert seed() == []
    assert guest().get("/api/songs/sample-first-frets").status_code == 404


# ---------- guests ----------


def test_guests_can_see_and_open_global_songs_but_nothing_else():
    seed()
    visitor = guest()
    assert visitor.get("/api/songs").status_code == 200
    assert visitor.get("/api/songs/sample-first-frets").json()["canEdit"] is False
    assert visitor.get("/api/songs?scope=mine").status_code == 401
    assert visitor.post("/api/songs", json=song()).status_code == 401
    assert visitor.put("/api/songs/sample-first-frets", json=song()).status_code == 401
    assert visitor.delete("/api/songs/sample-first-frets").status_code == 401


# ---------- own songs ----------


def test_a_user_adds_changes_and_deletes_their_own_songs():
    isura = person("Isura", "isura@example.com")
    created = isura.post("/api/songs", json=song(artist="  Isura  ", difficulty="beginner")).json()
    assert created["scope"] == "mine" and created["canEdit"] is True
    assert created["artist"] == "Isura" and created["noteCount"] == 3 and created["chordCount"] == 0
    assert [s["id"] for s in isura.get("/api/songs?scope=mine").json()["songs"]] == [created["id"]]

    changed = isura.put(f"/api/songs/{created['id']}", json=song("New Title", notes=[note(0, 2, 3), chord(1, (5, 3), (4, 2), (3, 0), (2, 1), (1, 0), name="C")]))
    assert changed.status_code == 200
    assert changed.json()["title"] == "New Title" and changed.json()["chordCount"] == 1 and changed.json()["id"] == created["id"]

    assert isura.delete(f"/api/songs/{created['id']}").status_code == 204
    assert isura.get(f"/api/songs/{created['id']}").status_code == 404
    assert isura.get("/api/songs?scope=mine").json()["songs"] == []


def test_artist_is_optional():
    isura = person("Isura", "isura@example.com")
    assert isura.post("/api/songs", json=song()).json()["artist"] is None


def test_nobody_sees_or_changes_another_users_own_songs_not_even_the_admin():
    isura = person("Isura", "isura@example.com")
    rasika = person("Rasika", "rasika@example.com")
    admin = person("Admin", "admin@example.com", admin=True)
    mine = isura.post("/api/songs", json=song()).json()["id"]
    for other in (rasika, admin, guest()):
        assert other.get(f"/api/songs/{mine}").status_code == 404
        assert other.put(f"/api/songs/{mine}", json=song("Taken")).status_code in (401, 404)
        assert other.delete(f"/api/songs/{mine}").status_code in (401, 404)
    assert rasika.get("/api/songs?scope=mine").json()["songs"] == []
    assert all(s["id"] != mine for s in guest().get("/api/songs").json()["songs"])
    assert isura.get(f"/api/songs/{mine}").json()["title"] == "My Song"


# ---------- global songs: admin only ----------


def test_only_the_admin_adds_changes_and_deletes_global_songs():
    seed()
    isura = person("Isura", "isura@example.com")
    admin = person("Admin", "admin@example.com", admin=True)

    refused = isura.post("/api/songs", json={**song(), "scope": "global"})
    assert refused.status_code == 403 and "Only the admin" in refused.json()["detail"]
    assert isura.put("/api/songs/sample-first-frets", json=song("Hacked")).status_code == 403
    assert isura.delete("/api/songs/sample-first-frets").status_code == 403
    assert isura.get("/api/songs/sample-first-frets").json()["canEdit"] is False

    created = admin.post("/api/songs", json={**song("Malata Bambareku Se"), "scope": "global"}).json()
    assert created["scope"] == "global" and created["canEdit"] is True
    assert any(s["id"] == created["id"] for s in guest().get("/api/songs").json()["songs"])
    assert admin.put("/api/songs/sample-first-frets", json=song("First Frets (new)")).json()["title"] == "First Frets (new)"
    assert admin.delete(f"/api/songs/{created['id']}").status_code == 204
    with SessionLocal() as db:
        row = db.get(Song, "sample-first-frets")
        assert row.scope == "global" and row.owner_id is None


# ---------- search ----------


def test_search_by_title_or_artist_in_any_capitals_and_sinhala():
    seed()
    admin = person("Admin", "admin@example.com", admin=True)
    admin.post("/api/songs", json={**song("ශ්‍රී ලංකා මාතා", artist="Ananda Samarakoon"), "scope": "global"})
    titles = lambda q: [s["title"] for s in guest().get("/api/songs", params={"q": q}).json()["songs"]]  # noqa: E731
    assert titles("TWINKLE") == ["Twinkle, twinkle"]
    assert titles("samarakoon") == ["ශ්‍රී ලංකා මාතා"]
    assert titles("ශ්රී") == ["ශ්‍රී ලංකා මාතා"]  # typed without the invisible joiner
    assert titles("%") == [] and titles("_") == []  # search characters are taken literally
    assert len(titles("")) == len(load_seed_songs()) + 1


def test_search_in_my_songs_finds_only_my_songs():
    seed()
    isura = person("Isura", "isura@example.com")
    isura.post("/api/songs", json=song("Twinkle my way"))
    found = isura.get("/api/songs", params={"scope": "mine", "q": "twinkle"}).json()["songs"]
    assert [s["title"] for s in found] == ["Twinkle my way"]


# ---------- songs are checked before saving ----------


def test_a_note_that_does_not_match_its_string_and_fret_is_refused():
    isura = person("Isura", "isura@example.com")
    bad = song(notes=[{"index": 0, "midi": 70, "position": {"stringNumber": 1, "fret": 0}}])
    response = isura.post("/api/songs", json=bad)
    assert response.status_code == 422
    assert "does not match string 1, fret 0" in response.json()["detail"]


def test_impossible_or_broken_songs_are_refused():
    isura = person("Isura", "isura@example.com")
    cases = {
        "string 7": song(notes=[{"index": 0, "midi": 64, "position": {"stringNumber": 7, "fret": 0}}]),
        "fret 30": song(notes=[{"index": 0, "midi": 94, "position": {"stringNumber": 1, "fret": 30}}]),
        "steps out of order": song(notes=[note(1, 1, 0), note(0, 1, 1)]),
        "chord on one string twice": song(notes=[chord(0, (1, 0), (1, 3))]),
        "no title": song("   "),
        "no notes": song(notes=[]),
        "other tuning": song(tuningId="drop-d"),
        "unknown field": {**song(), "owner": "someone"},
        "too many notes": song(notes=[note(i, 1, 0) for i in range(2001)]),
        "bad difficulty": song(difficulty="expert"),
    }
    for name, body in cases.items():
        assert isura.post("/api/songs", json=body).status_code == 422, name


def test_sheet_lines_are_kept_exactly():
    isura = person("Isura", "isura@example.com")
    notes = [{**note(0, 1, 0), "line": 1}, {**note(1, 1, 1), "line": 1}, {**note(2, 1, 3), "line": 2}]
    created = isura.post("/api/songs", json=song(notes=notes)).json()
    assert isura.get(f"/api/songs/{created['id']}").json()["notes"] == notes
    assert isura.post("/api/songs", json=song(notes=[{**note(0, 1, 0), "line": 0}])).status_code == 422


def test_lyrics_measures_and_chords_are_kept_exactly():
    isura = person("Isura", "isura@example.com")
    notes = [note(0, 2, 3, lyric="Twin", measure=1), note(1, 2, 3, lyric="kle,", measure=1), chord(2, (5, 3), (4, 2), (3, 0), (2, 1), (1, 0), name="C")]
    created = isura.post("/api/songs", json=song(notes=notes)).json()
    back = isura.get(f"/api/songs/{created['id']}").json()["notes"]
    assert back == notes


# ---------- songs saved on a phone ----------


def test_songs_saved_on_a_phone_move_into_the_account():
    isura = person("Isura", "isura@example.com")
    moved = isura.post("/api/songs/move-from-device", json={"songs": [song("One"), song("Two")]})
    assert moved.status_code == 201
    assert sorted(s["title"] for s in moved.json()["songs"]) == ["One", "Two"]
    assert len(isura.get("/api/songs?scope=mine").json()["songs"]) == 2
    assert guest().post("/api/songs/move-from-device", json={"songs": [song()]}).status_code == 401


def test_moving_is_all_or_nothing():
    isura = person("Isura", "isura@example.com")
    response = isura.post("/api/songs/move-from-device", json={"songs": [song("Good"), song("   ")]})
    assert response.status_code == 422
    assert isura.get("/api/songs?scope=mine").json()["songs"] == []
