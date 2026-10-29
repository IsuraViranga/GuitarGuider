import csv
import io
import json
import struct
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dataset import expected_note, read_wav
from app.dataset_storage import LocalStore, S3Store, StorageError, get_store
from app.db import SessionLocal
from app.main import app
from app.models import DatasetSample
from tests.test_songs import guest, person


def wav(seconds=2.0, rate=48000, channels=1, kind="float32", level=0.5):
    """A WAV file like the app records (32-bit float, or 16-bit), with a peak of `level`."""
    count = int(seconds * rate) * channels
    if kind == "float32":
        code, bits, data = 3, 32, struct.pack(f"<{count}f", *([0.0] * (count - 1) + [level]))
    else:
        code, bits, data = 1, 16, struct.pack(f"<{count}h", *([0] * (count - 1) + [int(level * 32767)]))
    block = channels * bits // 8
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, code, channels, rate, rate * block, block, bits)
    return header + b"data" + struct.pack("<I", len(data)) + data


class MemoryStore:
    name = "memory"

    def __init__(self):
        self.files = {}
        self.fail_put = self.fail_delete = False

    def put(self, key, data, content_type):
        if self.fail_put:
            raise StorageError("down")
        self.files[key] = data

    def get(self, key):
        return self.files[key]

    def delete(self, key):
        if self.fail_delete:
            raise StorageError("down")
        self.files.pop(key, None)

    def playback_url(self, key, sample_id):
        return f"https://storage.example/{key}?signed=1"


@pytest.fixture
def store():
    memory = MemoryStore()
    app.dependency_overrides[get_store] = lambda: memory
    yield memory
    app.dependency_overrides.pop(get_store, None)


def admin():
    return person("Melantha", "admin@example.com", admin=True)


def add_guitar(client, **fields):
    body = {"name": "Yamaha black", "guitarType": "acoustic", "stringMaterial": "steel", "woundStrings": [3, 4, 5, 6], **fields}
    response = client.post("/api/dataset/guitars", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def save(client, guitar_id, audio=None, **fields):
    meta = {"guitarId": guitar_id, "stringNumber": 2, "fret": 5, **fields}
    return client.post("/api/dataset/samples", files={"audio": ("pluck.wav", audio or wav(), "audio/wav")}, data={"meta": json.dumps(meta)})


def rows():
    with SessionLocal() as db:
        return db.scalars(select(DatasetSample)).all()


# ---------- labels ----------


def test_expected_note_uses_the_apps_standard_tuning():
    assert expected_note(1, 0) == (64, "E4", 329.63)
    assert expected_note(2, 5) == (64, "E4", 329.63)
    assert expected_note(6, 0) == (40, "E2", 82.41)
    assert expected_note(5, 0) == (45, "A2", 110.0)
    assert expected_note(3, 1) == (56, "G#3", 207.65)


def test_a_saved_pluck_keeps_its_labels_conditions_and_the_exact_audio(store):
    client = admin()
    guitar = add_guitar(client)
    audio = wav(seconds=3, rate=44100, level=0.8)
    response = save(
        client, guitar["id"], audio, backgroundNoise="moderate", pluckMethod="pick", pluckStrength="strong", device="phone",
        notes="  new strings  ", pluckAtMs=520, capture={"sampleRate": 44100, "echoCancellation": False},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    sample = body["sample"]
    assert body["countAtPosition"] == 1
    assert (sample["stringNumber"], sample["fret"], sample["position"]) == (2, 5, "25")
    assert (sample["expectedMidi"], sample["expectedNote"], sample["expectedHz"]) == (64, "E4", 329.63)
    assert sample["stringConstruction"] == "unwound"
    assert (sample["guitarName"], sample["guitarType"], sample["stringMaterial"]) == ("Yamaha black", "acoustic", "steel")
    assert (sample["backgroundNoise"], sample["pluckMethod"], sample["pluckStrength"], sample["device"]) == ("moderate", "pick", "strong", "phone")
    assert sample["notes"] == "new strings" and sample["pluckAtMs"] == 520 and sample["capture"]["sampleRate"] == 44100
    assert (sample["audioFormat"], sample["sampleRate"], sample["bitDepth"], sample["channels"]) == ("wav-float32", 44100, 32, 1)
    assert sample["durationMs"] == 3000 and sample["audioBytes"] == len(audio) and sample["peak"] == 0.8
    assert sample["status"] == "accepted"
    # The original file, unchanged, under a key the server made.
    assert store.files == {sample["audioKey"]: audio}
    assert sample["audioKey"] == f"samples/{sample['id'].replace('-', '')}.wav"


def test_defaults_wound_strings_and_16_bit_files(store):
    client = admin()
    guitar = add_guitar(client, name="Nylon", guitarType="classical", stringMaterial="nylon", woundStrings=[6, 4, 5, 4])
    assert guitar["woundStrings"] == [4, 5, 6]
    sample = save(client, guitar["id"], wav(kind="pcm16"), stringNumber=4, fret=0).json()["sample"]
    assert sample["stringConstruction"] == "wound" and sample["audioFormat"] == "wav-pcm16" and sample["bitDepth"] == 16
    assert (sample["backgroundNoise"], sample["pluckMethod"], sample["pluckStrength"], sample["device"]) == ("quiet", "finger", "medium", None)
    unknown = add_guitar(client, name="Borrowed", woundStrings=None)
    assert save(client, unknown["id"], stringNumber=1, fret=0).json()["sample"]["stringConstruction"] == "unknown"


def test_many_recordings_of_one_position_and_progress(store):
    client = admin()
    guitar = add_guitar(client)
    counts = [save(client, guitar["id"]).json()["countAtPosition"] for _ in range(3)]
    assert counts == [1, 2, 3]
    save(client, guitar["id"], stringNumber=3, fret=0)
    progress = client.get(f"/api/dataset/guitars/{guitar['id']}/progress").json()
    assert sorted((p["stringNumber"], p["fret"], p["count"]) for p in progress) == [(2, 5, 3), (3, 0, 1)]
    listed = client.get("/api/dataset/guitars").json()
    assert [(g["name"], g["samples"]) for g in listed] == [("Yamaha black", 4)]


def test_guitar_names_are_reused_not_repeated(store):
    client = admin()
    add_guitar(client, name="Guitar A")
    again = client.post("/api/dataset/guitars", json={"name": "  guitar   a "})
    assert again.status_code == 409
    assert client.post("/api/dataset/guitars", json={"name": "   "}).status_code == 422
    assert client.post("/api/dataset/guitars", json={"name": "B", "guitarType": "banjo"}).status_code == 422
    assert client.post("/api/dataset/guitars", json={"name": "B", "woundStrings": [7]}).status_code == 422


# ---------- checks on what is sent ----------


def test_only_real_mono_wav_plucks_with_valid_labels_are_saved(store):
    client = admin()
    guitar = add_guitar(client)
    bad_audio = [b"not a wav file at all" * 4, wav(channels=2), wav(seconds=0.2), wav(seconds=16, rate=8000), wav()[:30]]
    for audio in bad_audio:
        assert save(client, guitar["id"], audio).status_code == 422
    for meta in ({"stringNumber": 7}, {"fret": 25}, {"fret": -1}, {"pluckMethod": "slap"}, {"extra": 1}, {"notes": "x" * 501}):
        assert save(client, guitar["id"], **meta).status_code == 422, meta
    assert client.post("/api/dataset/samples", files={"audio": ("p.wav", wav(), "audio/wav")}, data={"meta": "{nope"}).status_code == 422
    assert save(client, "00000000-0000-0000-0000-000000000000").status_code == 404
    assert rows() == [] and store.files == {}


def test_a_file_too_large_is_refused(store, monkeypatch):
    monkeypatch.setattr("app.dataset.MAX_AUDIO_BYTES", 1000)
    client = admin()
    guitar = add_guitar(client)
    assert save(client, guitar["id"]).status_code == 413
    assert rows() == [] and store.files == {}


# ---------- nothing half-saved ----------


def test_if_the_audio_cannot_be_stored_nothing_is_saved(store):
    client = admin()
    guitar = add_guitar(client)
    store.fail_put = True
    response = save(client, guitar["id"])
    assert response.status_code == 502 and "nothing was saved" in response.json()["detail"]
    assert rows() == []


def test_if_the_database_fails_the_stored_audio_is_removed_again(store, monkeypatch):
    client = admin()
    guitar = add_guitar(client)
    real_commit = Session.commit

    def failing_commit(session):
        if any(isinstance(item, DatasetSample) for item in session.new):
            raise RuntimeError("database down")
        return real_commit(session)

    monkeypatch.setattr(Session, "commit", failing_commit)
    response = save(client, guitar["id"])
    assert response.status_code == 500 and "nothing was kept" in response.json()["detail"]
    monkeypatch.setattr(Session, "commit", real_commit)
    assert rows() == [] and store.files == {}


def test_without_storage_set_up_nothing_can_be_saved():
    client = admin()
    guitar = add_guitar(client)
    response = save(client, guitar["id"])
    assert response.status_code == 503 and "not set up" in response.json()["detail"]
    assert rows() == []


# ---------- admin only ----------


def test_only_the_admin_can_use_the_collector(store):
    owner = admin()
    guitar = add_guitar(owner)
    sample = save(owner, guitar["id"]).json()["sample"]
    student = person("Isura", "isura@example.com")
    visitor = guest()
    calls = [
        ("get", "/api/dataset/guitars", {}),
        ("post", "/api/dataset/guitars", {"json": {"name": "Mine"}}),
        ("get", f"/api/dataset/guitars/{guitar['id']}/progress", {}),
        ("post", "/api/dataset/samples", {"files": {"audio": ("p.wav", wav(), "audio/wav")}, "data": {"meta": json.dumps({"guitarId": guitar["id"], "stringNumber": 1, "fret": 0})}}),
        ("get", "/api/dataset/samples", {}),
        ("get", f"/api/dataset/samples/{sample['id']}/audio-url", {}),
        ("get", f"/api/dataset/samples/{sample['id']}/audio", {}),
        ("patch", f"/api/dataset/samples/{sample['id']}", {"json": {"status": "rejected"}}),
        ("delete", f"/api/dataset/samples/{sample['id']}", {}),
        ("get", "/api/dataset/export?format=csv", {}),
    ]
    for method, url, kwargs in calls:
        assert getattr(student, method)(url, **kwargs).status_code == 403, url
        assert getattr(visitor, method)(url, **kwargs).status_code == 401, url
    assert len(rows()) == 1 and len(store.files) == 1 and rows()[0].status == "accepted"


# ---------- reviewing ----------


def test_list_filter_and_pages(store):
    client = admin()
    steel = add_guitar(client, name="Steel")
    nylon = add_guitar(client, name="Nylon", guitarType="classical", stringMaterial="nylon")
    for fret in range(5):
        save(client, steel["id"], stringNumber=3, fret=fret)
    save(client, steel["id"], stringNumber=4, fret=0, backgroundNoise="noisy")
    save(client, nylon["id"], stringNumber=3, fret=0)

    def listed(query):
        return client.get(f"/api/dataset/samples?{query}").json()

    assert listed("")["total"] == 7
    assert listed(f"guitarId={steel['id']}")["total"] == 6
    assert listed("stringNumber=3")["total"] == 6
    assert listed("stringNumber=3&fret=0")["total"] == 2
    assert listed("stringMaterial=nylon")["items"][0]["guitarName"] == "Nylon"
    assert listed("backgroundNoise=noisy")["items"][0]["position"] == "40"
    first, second = listed("pageSize=4&page=1"), listed("pageSize=4&page=2")
    assert (len(first["items"]), len(second["items"]), first["total"]) == (4, 3, 7)
    assert not {s["id"] for s in first["items"]} & {s["id"] for s in second["items"]}
    assert client.get("/api/dataset/samples?stringNumber=9").status_code == 422


def test_mark_samples_and_rejected_ones_do_not_count(store):
    client = admin()
    guitar = add_guitar(client)
    sample = save(client, guitar["id"]).json()["sample"]
    changed = client.patch(f"/api/dataset/samples/{sample['id']}", json={"status": "needs_review", "notes": "buzz"}).json()
    assert (changed["status"], changed["notes"]) == ("needs_review", "buzz")
    assert client.patch(f"/api/dataset/samples/{sample['id']}", json={"status": "rejected"}).json()["notes"] == "buzz"
    assert client.get(f"/api/dataset/guitars/{guitar['id']}/progress").json() == []
    assert client.get("/api/dataset/samples?status=rejected").json()["total"] == 1
    assert client.patch(f"/api/dataset/samples/{sample['id']}", json={"status": "great"}).status_code == 422


def test_play_a_sample_through_a_short_lived_link(store):
    client = admin()
    guitar = add_guitar(client)
    sample = save(client, guitar["id"]).json()["sample"]
    assert client.get(f"/api/dataset/samples/{sample['id']}/audio-url").json() == {"url": f"https://storage.example/{sample['audioKey']}?signed=1"}
    # The file itself is only sent by the API when it is kept on this computer.
    assert client.get(f"/api/dataset/samples/{sample['id']}/audio").status_code == 404


def test_local_storage_keeps_files_on_this_computer_and_the_api_plays_them(tmp_path):
    local = LocalStore(str(tmp_path))
    app.dependency_overrides[get_store] = lambda: local
    try:
        client = admin()
        guitar = add_guitar(client)
        audio = wav()
        sample = save(client, guitar["id"], audio).json()["sample"]
        assert (tmp_path / sample["audioKey"]).read_bytes() == audio
        url = client.get(f"/api/dataset/samples/{sample['id']}/audio-url").json()["url"]
        played = client.get(url)
        assert played.status_code == 200 and played.content == audio and played.headers["content-type"] == "audio/wav"
        assert client.delete(f"/api/dataset/samples/{sample['id']}").status_code == 204
        assert not (tmp_path / sample["audioKey"]).exists()
    finally:
        app.dependency_overrides.pop(get_store, None)
    with pytest.raises(StorageError):
        local.put("../outside.wav", b"x", "audio/wav")


def test_the_bucket_stays_private_links_are_signed_and_expire():
    bucket = S3Store("https://s3.us-east-005.backblazeb2.com", "us-east-005", "guitar-dataset", "key-id", "secret")
    url = bucket.playback_url("samples/" + "a" * 32 + ".wav", "id")
    query = parse_qs(urlparse(url).query)
    assert "guitar-dataset" in url and "samples/" in url
    assert query["X-Amz-Expires"] == ["300"] and query["X-Amz-Signature"] and "secret" not in url
    with pytest.raises(StorageError):
        bucket.playback_url("../other-bucket-file", "id")


def test_storage_is_off_until_every_bucket_setting_is_given(monkeypatch):
    from app.config import get_settings

    get_settings.cache_clear()
    get_store.cache_clear()
    try:
        monkeypatch.setenv("DATASET_STORAGE", "s3")
        monkeypatch.setenv("DATASET_S3_BUCKET", "guitar-dataset")
        assert get_store() is None
        get_settings.cache_clear()
        get_store.cache_clear()
        for name, value in [("ENDPOINT", "https://s3.example"), ("REGION", "r"), ("KEY_ID", "k"), ("SECRET", "s")]:
            monkeypatch.setenv(f"DATASET_S3_{name}", value)
        assert isinstance(get_store(), S3Store)
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()
        get_store.cache_clear()


# ---------- delete and export ----------


def test_delete_removes_the_row_and_the_audio(store):
    client = admin()
    guitar = add_guitar(client)
    keep = save(client, guitar["id"]).json()["sample"]
    gone = save(client, guitar["id"]).json()["sample"]
    assert client.delete(f"/api/dataset/samples/{gone['id']}").status_code == 204
    assert [str(r.id) for r in rows()] == [keep["id"]] and list(store.files) == [keep["audioKey"]]
    assert client.delete(f"/api/dataset/samples/{gone['id']}").status_code == 404


def test_if_the_audio_cannot_be_deleted_the_sample_is_kept(store):
    client = admin()
    guitar = add_guitar(client)
    sample = save(client, guitar["id"]).json()["sample"]
    store.fail_delete = True
    assert client.delete(f"/api/dataset/samples/{sample['id']}").status_code == 502
    assert len(rows()) == 1 and sample["audioKey"] in store.files


def test_export_metadata_and_storage_keys_without_audio(store):
    client = admin()
    guitar = add_guitar(client)
    first = save(client, guitar["id"], capture={"sampleRate": 48000}).json()["sample"]
    save(client, guitar["id"], stringNumber=6, fret=5)
    jsonl = client.get("/api/dataset/export?format=jsonl")
    assert jsonl.status_code == 200 and "attachment" in jsonl.headers["content-disposition"]
    records = [json.loads(line) for line in jsonl.text.splitlines()]
    assert [r["position"] for r in records] == ["25", "65"]
    assert records[0]["audio_key"] == first["audioKey"] and records[0]["storage"] == "memory" and records[0]["string_number"] == 2
    assert records[0]["capture"] == {"sampleRate": 48000}
    csv_text = client.get(f"/api/dataset/export?format=csv&stringNumber=6&guitarId={guitar['id']}").text
    table = list(csv.DictReader(io.StringIO(csv_text)))
    assert len(table) == 1 and table[0]["expected_note"] == "A2" and table[0]["fret"] == "5" and table[0]["string_construction"] == "wound"
    assert len(jsonl.content) < 10_000  # labels only, no sound


def test_read_wav_reports_what_the_file_really_is():
    info = read_wav(wav(seconds=1.5, rate=96000, level=0.25))
    assert (info.audio_format, info.sample_rate, info.bit_depth, info.channels, info.duration_ms, info.peak) == ("wav-float32", 96000, 32, 1, 1500, 0.25)
    with pytest.raises(ValueError):
        read_wav(wav(kind="float32")[:40])
