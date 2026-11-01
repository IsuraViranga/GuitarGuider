"""Guitar recordings (the dataset collector): labelled recordings of single plucks, used by the
string check's sound match (frontend/src/dataset/soundMatch.ts) and for research.

- Signed-in players only (401 for visitors). Every player may record their own guitars; every
  guitar's fingerprints can be read by every player (to choose any recorded guitar). Recording
  into a guitar, and listing, playing, marking or deleting its samples: its owner or the admin.
  Setting the default guitar and exporting: the admin only.
- Self-contained: practice only reads fingerprints; removing this leaves the string check as it was.
- Each sample is one pluck: string and fret, the expected note (worked out here from the standard
  tuning, as the app does), the recording conditions, and the audio file exactly as the browser
  captured it. The file goes to private storage (app/dataset_storage.py); only its key is stored here.
- Saving is all or nothing: the audio first, then the row; if the row fails, the audio is removed.
"""

import csv
import io
import json
import logging
import math
import struct
import uuid
from array import array
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response
from pydantic import ConfigDict, Field, ValidationError, field_validator
from pydantic.alias_generators import to_camel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import current_user, require_admin
from .dataset_storage import AudioStore, StorageError, get_store
from .db import get_db
from .models import DatasetGuitar, DatasetSample, User
from .song_schemas import MAX_FRET, Camel

router = APIRouter(prefix="/api/dataset", tags=["dataset collector"])
DbSession = Annotated[Session, Depends(get_db)]
Admin = Annotated[User, Depends(require_admin)]
Player = Annotated[User, Depends(current_user)]
Store = Annotated[AudioStore | None, Depends(get_store)]
_log = logging.getLogger("app.dataset")

# Standard tuning, A4 = 440 Hz: the same as the app (frontend/src/music/tuning.ts and pitch.ts).
OPEN_STRING_MIDI = {1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40}
NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")

# One pluck with some sound before and after it: a few seconds. Larger files are refused.
MIN_SECONDS, MAX_SECONDS = 0.5, 15
MAX_AUDIO_BYTES = 8 * 1024 * 1024
# Each guitar is about 150 MB of audio: these keep the free storage (10 GB) from filling up.
MAX_GUITARS_PER_PLAYER = 3
MAX_SAMPLES_PER_GUITAR = 400

GuitarType = Literal["acoustic", "classical", "electric", "other"]
StringMaterial = Literal["steel", "nylon", "unknown"]
Noise = Literal["quiet", "moderate", "noisy"]
PluckMethod = Literal["finger", "pick"]
PluckStrength = Literal["soft", "medium", "strong"]
Device = Literal["phone", "tablet", "laptop", "other"]
ReviewStatus = Literal["accepted", "needs_review", "rejected"]
StringNumber = Annotated[int, Field(ge=1, le=6)]


def expected_note(string_number: int, fret: int) -> tuple[int, str, float]:
    """MIDI note, name (e.g. "E4") and frequency (Hz) of a position in standard tuning."""
    midi = OPEN_STRING_MIDI[string_number] + fret
    return midi, f"{NOTE_NAMES[midi % 12]}{midi // 12 - 1}", round(440 * 2 ** ((midi - 69) / 12), 2)


# ---------- the audio file ----------


@dataclass
class WavInfo:
    audio_format: str
    sample_rate: int
    bit_depth: int
    channels: int
    duration_ms: int
    peak: float


def read_wav(data: bytes) -> WavInfo:
    """What the file really is (from its own header), or ValueError with a message for the admin.
    Accepted: mono WAV, 16-bit whole numbers or 32-bit float (what the app records)."""
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("The recording is not a WAV file.")
    fmt = None
    samples = None
    offset = 12
    while offset + 8 <= len(data):
        chunk, size = data[offset : offset + 4], struct.unpack_from("<I", data, offset + 4)[0]
        body = data[offset + 8 : offset + 8 + size]
        if chunk == b"fmt " and len(body) >= 16:
            fmt = struct.unpack_from("<HHIIHH", body)
        elif chunk == b"data":
            samples = body
            break
        offset += 8 + size + (size & 1)
    if fmt is None or samples is None:
        raise ValueError("The recording is not a complete WAV file.")
    code, channels, rate, _byte_rate, _align, bits = fmt
    kinds = {(1, 16): ("wav-pcm16", "h", 32768.0), (3, 32): ("wav-float32", "f", 1.0)}
    if (code, bits) not in kinds:
        raise ValueError("The recording must be 16-bit or 32-bit float WAV.")
    if channels != 1:
        raise ValueError("The recording must be mono (one channel).")
    if not 8000 <= rate <= 192000:
        raise ValueError("The recording's sample rate is not one a microphone uses.")
    name, typecode, scale = kinds[(code, bits)]
    values = array(typecode)
    values.frombytes(samples[: len(samples) - len(samples) % values.itemsize])
    seconds = len(values) / rate
    if not MIN_SECONDS <= seconds <= MAX_SECONDS:
        raise ValueError(f"The recording must be {MIN_SECONDS}–{MAX_SECONDS} seconds long.")
    peak = max((abs(v) for v in values), default=0.0) / scale
    if not math.isfinite(peak):
        raise ValueError("The recording contains broken sound values.")
    return WavInfo(name, rate, bits, channels, round(seconds * 1000), round(peak, 4))


# ---------- guitars ----------


class GuitarIn(Camel):
    name: str = Field(min_length=1, max_length=60)
    guitar_type: GuitarType = "acoustic"
    string_material: StringMaterial = "steel"
    # Which strings are wound (null: not known).
    wound_strings: list[StringNumber] | None = None

    @field_validator("name")
    @classmethod
    def _trimmed(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Please give the guitar a name.")
        return value

    @field_validator("wound_strings")
    @classmethod
    def _sorted(cls, value: list[int] | None) -> list[int] | None:
        return None if value is None else sorted(set(value))


class Out(Camel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, serialize_by_alias=True)


class GuitarOut(Out):
    id: uuid.UUID
    name: str
    guitar_type: str
    string_material: str
    wound_strings: list[int] | None
    samples: int
    # Kept samples with a sound-match fingerprint, and kept samples still without one (older recordings).
    fingerprints: int
    missing_fingerprints: int
    owner_name: str | None
    # Recorded by the player asking (they may record into it and manage its samples).
    mine: bool
    is_default: bool

    @classmethod
    def of(cls, guitar: DatasetGuitar, user: User, counts: tuple[int, int, int] = (0, 0, 0)) -> "GuitarOut":
        samples, fingerprints, missing = counts
        return cls(
            id=guitar.id, name=guitar.name, guitar_type=guitar.guitar_type, string_material=guitar.string_material, wound_strings=guitar.wound_strings,
            samples=samples, fingerprints=fingerprints, missing_fingerprints=missing,
            owner_name=guitar.owner.display_name if guitar.owner else None, mine=guitar.owner_id == user.id, is_default=guitar.is_default,
        )


class PositionCount(Out):
    string_number: int
    fret: int
    count: int


def _guitar(db: Session, guitar_id: uuid.UUID) -> DatasetGuitar:
    guitar = db.get(DatasetGuitar, guitar_id)
    if guitar is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guitar not found.")
    return guitar


def _may_change(user: User, guitar: DatasetGuitar) -> bool:
    return user.role == "admin" or guitar.owner_id == user.id


def _own_guitar(db: Session, guitar_id: uuid.UUID, user: User) -> DatasetGuitar:
    """The guitar, when this player may record into it and manage its samples (owner or admin)."""
    guitar = _guitar(db, guitar_id)
    if not _may_change(user, guitar):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This guitar was recorded by another player.")
    return guitar


def _counts(db: Session, guitar_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[int, int, int]]:
    """Per guitar: all samples, kept ones with a fingerprint, kept ones without."""
    kept = DatasetSample.status != "rejected"
    rows = db.execute(
        select(
            DatasetSample.guitar_id,
            func.count(),
            func.count().filter(kept, DatasetSample.fingerprint.is_not(None)),
            func.count().filter(kept, DatasetSample.fingerprint.is_(None)),
        )
        .where(DatasetSample.guitar_id.in_(guitar_ids))
        .group_by(DatasetSample.guitar_id)
    ).all()
    return {row[0]: (row[1], row[2], row[3]) for row in rows}


def _out(db: Session, guitar: DatasetGuitar, user: User) -> GuitarOut:
    return GuitarOut.of(guitar, user, _counts(db, [guitar.id]).get(guitar.id, (0, 0, 0)))


@router.get("/guitars")
def list_guitars(db: DbSession, user: Player) -> list[GuitarOut]:
    """Every recorded guitar (any player may compare with any of them)."""
    guitars = db.scalars(select(DatasetGuitar).order_by(func.lower(DatasetGuitar.name), DatasetGuitar.created_at)).all()
    counts = _counts(db, [g.id for g in guitars])
    return [GuitarOut.of(g, user, counts.get(g.id, (0, 0, 0))) for g in guitars]


@router.post("/guitars", status_code=status.HTTP_201_CREATED)
def add_guitar(body: GuitarIn, db: DbSession, user: Player) -> GuitarOut:
    if user.role != "admin":
        owned = db.scalar(select(func.count()).select_from(DatasetGuitar).where(DatasetGuitar.owner_id == user.id))
        if owned >= MAX_GUITARS_PER_PLAYER:
            raise HTTPException(status.HTTP_409_CONFLICT, f"You can record up to {MAX_GUITARS_PER_PLAYER} guitars. Choose one of yours from the list.")
    guitar = DatasetGuitar(name=body.name, guitar_type=body.guitar_type, string_material=body.string_material, wound_strings=body.wound_strings, owner_id=user.id)
    db.add(guitar)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "You already have a guitar with this name. Choose it from the list.") from None
    db.refresh(guitar)
    return _out(db, guitar, user)


class DefaultChange(Camel):
    is_default: bool


@router.put("/guitars/{guitar_id}/default")
def set_default(guitar_id: uuid.UUID, body: DefaultChange, db: DbSession, admin: Admin) -> GuitarOut:
    """The guitar players are compared with before they choose one (at most one)."""
    guitar = _guitar(db, guitar_id)
    if body.is_default:
        for other in db.scalars(select(DatasetGuitar).where(DatasetGuitar.is_default, DatasetGuitar.id != guitar_id)):
            other.is_default = False
        db.flush()
    guitar.is_default = body.is_default
    db.commit()
    db.refresh(guitar)
    return _out(db, guitar, admin)


@router.get("/guitars/{guitar_id}/progress")
def guitar_progress(guitar_id: uuid.UUID, db: DbSession, user: Player) -> list[PositionCount]:
    """Samples kept per position (rejected ones do not count)."""
    _own_guitar(db, guitar_id, user)
    rows = db.execute(
        select(DatasetSample.string_number, DatasetSample.fret, func.count())
        .where(DatasetSample.guitar_id == guitar_id, DatasetSample.status != "rejected")
        .group_by(DatasetSample.string_number, DatasetSample.fret)
    ).all()
    return [PositionCount(string_number=s, fret=f, count=n) for s, f, n in rows]


# ---------- sound match ----------
# Each sample's fingerprint is made in the recording player's browser by the app's own code
# (frontend/src/dataset/soundMatch.ts); practice compares plucks with a guitar's fingerprints.

FINGERPRINT_SIZE = 19  # soundMatch.ts FINGERPRINT_SIZE: 16 overtones, odd/even, log stiffness, misfit
FingerprintValues = Annotated[list[float], Field(min_length=FINGERPRINT_SIZE, max_length=FINGERPRINT_SIZE)]


def _finite(value: list[float] | None) -> list[float] | None:
    if value is not None and not all(math.isfinite(x) for x in value):
        raise ValueError("Every fingerprint value must be a finite number.")
    return value


class FingerprintIn(Camel):
    v: FingerprintValues

    @field_validator("v")
    @classmethod
    def _finite_values(cls, value: list[float]) -> list[float]:
        return _finite(value)


class FingerprintsOut(Out):
    fingerprints: list[dict]


@router.get("/guitars/{guitar_id}/fingerprints")
def get_fingerprints(guitar_id: uuid.UUID, db: DbSession, _user: Player) -> FingerprintsOut:
    """The fingerprints of the guitar's kept samples (any player may compare with any guitar)."""
    _guitar(db, guitar_id)
    rows = db.execute(
        select(DatasetSample.id, DatasetSample.string_number, DatasetSample.fret, DatasetSample.fingerprint)
        .where(DatasetSample.guitar_id == guitar_id, DatasetSample.status != "rejected", DatasetSample.fingerprint.is_not(None))
        .order_by(DatasetSample.recorded_at, DatasetSample.id)
    ).all()
    return FingerprintsOut(fingerprints=[{"sampleId": str(r[0]), "stringNumber": r[1], "fret": r[2], "v": r[3]} for r in rows])


# ---------- samples ----------

CaptureValue = str | int | float | bool | None


class SampleIn(Camel):
    guitar_id: uuid.UUID
    string_number: StringNumber
    fret: int = Field(ge=0, le=MAX_FRET)
    background_noise: Noise = "quiet"
    pluck_method: PluckMethod = "finger"
    pluck_strength: PluckStrength = "medium"
    device: Device | None = None
    notes: str | None = Field(default=None, max_length=500)
    pluck_at_ms: int | None = Field(default=None, ge=0, le=MAX_SECONDS * 1000)
    # How the browser captured the sound, e.g. {"sampleRate": 48000, "echoCancellation": false}.
    capture: dict[Annotated[str, Field(max_length=40)], CaptureValue] | None = Field(default=None, max_length=20)
    # The sound-match fingerprint of this pluck, made in the browser (null: it could not be measured).
    fingerprint: FingerprintValues | None = None

    @field_validator("fingerprint")
    @classmethod
    def _finite_fingerprint(cls, value: list[float] | None) -> list[float] | None:
        return _finite(value)

    @field_validator("notes")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return value.strip() or None if value else None


class SampleChange(Camel):
    status: ReviewStatus | None = None
    notes: str | None = Field(default=None, max_length=500)


class SampleOut(Out):
    id: uuid.UUID
    guitar_id: uuid.UUID
    guitar_name: str
    guitar_type: str
    string_material: str
    string_number: int
    fret: int
    position: str
    expected_midi: int
    expected_note: str
    expected_hz: float
    string_construction: str
    background_noise: str
    pluck_method: str
    pluck_strength: str
    device: str | None
    notes: str | None
    audio_key: str
    audio_format: str
    sample_rate: int
    bit_depth: int
    channels: int
    duration_ms: int
    audio_bytes: int
    peak: float
    pluck_at_ms: int | None
    capture: dict | None
    has_fingerprint: bool
    status: str
    recorded_at: datetime

    @classmethod
    def of(cls, s: DatasetSample) -> "SampleOut":
        g = s.guitar
        return cls(
            id=s.id, guitar_id=g.id, guitar_name=g.name, guitar_type=g.guitar_type, string_material=g.string_material,
            string_number=s.string_number, fret=s.fret, position=f"{s.string_number}{s.fret}",
            expected_midi=s.expected_midi, expected_note=s.expected_note, expected_hz=s.expected_hz,
            string_construction=s.string_construction, background_noise=s.background_noise, pluck_method=s.pluck_method,
            pluck_strength=s.pluck_strength, device=s.device, notes=s.notes, audio_key=s.audio_key, audio_format=s.audio_format,
            sample_rate=s.sample_rate, bit_depth=s.bit_depth, channels=s.channels, duration_ms=s.duration_ms,
            audio_bytes=s.audio_bytes, peak=s.peak, pluck_at_ms=s.pluck_at_ms, capture=s.capture, has_fingerprint=s.fingerprint is not None,
            status=s.status, recorded_at=s.recorded_at,
        )


class SavedSample(Out):
    sample: SampleOut
    # Samples now kept at this position on this guitar (for "Saved: 3 at 25").
    count_at_position: int


class SamplePage(Out):
    items: list[SampleOut]
    total: int
    page: int
    page_size: int


def _store(store: AudioStore | None) -> AudioStore:
    if store is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Audio storage is not set up on the server yet, so nothing can be saved.")
    return store


def _own_sample(db: Session, sample_id: uuid.UUID, user: User) -> DatasetSample:
    """The sample, when this player may play or manage it (its guitar's owner, or the admin)."""
    sample = db.get(DatasetSample, sample_id)
    if sample is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sample not found.")
    if not _may_change(user, sample.guitar):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This recording belongs to another player.")
    return sample


def _construction(guitar: DatasetGuitar, string_number: int) -> str:
    if guitar.wound_strings is None:
        return "unknown"
    return "wound" if string_number in guitar.wound_strings else "unwound"


def _count_at(db: Session, guitar_id: uuid.UUID, string_number: int, fret: int) -> int:
    return db.scalar(
        select(func.count()).where(
            DatasetSample.guitar_id == guitar_id, DatasetSample.string_number == string_number, DatasetSample.fret == fret, DatasetSample.status != "rejected"
        )
    )


@router.post("/samples", status_code=status.HTTP_201_CREATED)
def save_sample(
    db: DbSession,
    user: Player,
    store: Store,
    audio: Annotated[UploadFile, File(description="The pluck: a mono WAV file, as recorded")],
    meta: Annotated[str, Form(description="The labels and conditions (SampleIn as JSON)")],
) -> SavedSample:
    try:
        body = SampleIn.model_validate_json(meta)
    except ValidationError as error:
        raise RequestValidationError(error.errors()) from None
    target = _store(store)
    guitar = _own_guitar(db, body.guitar_id, user)
    if db.scalar(select(func.count()).select_from(DatasetSample).where(DatasetSample.guitar_id == guitar.id)) >= MAX_SAMPLES_PER_GUITAR:
        raise HTTPException(status.HTTP_409_CONFLICT, f"This guitar already has {MAX_SAMPLES_PER_GUITAR} recordings, which is plenty.")
    data = audio.file.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "The recording is too large for one pluck.")
    try:
        info = read_wav(data)
    except ValueError as error:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(error)) from None

    sample_id = uuid.uuid4()
    key = f"samples/{sample_id.hex}.wav"
    try:
        target.put(key, data, "audio/wav")
    except StorageError:
        _log.exception("Dataset: the audio could not be stored")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The audio could not be stored, so nothing was saved. Please try again.") from None

    midi, note, hz = expected_note(body.string_number, body.fret)
    sample = DatasetSample(
        id=sample_id, guitar_id=guitar.id, string_number=body.string_number, fret=body.fret,
        expected_midi=midi, expected_note=note, expected_hz=hz, string_construction=_construction(guitar, body.string_number),
        background_noise=body.background_noise, pluck_method=body.pluck_method, pluck_strength=body.pluck_strength,
        device=body.device, notes=body.notes, audio_key=key, audio_format=info.audio_format, sample_rate=info.sample_rate,
        bit_depth=info.bit_depth, channels=info.channels, duration_ms=info.duration_ms, audio_bytes=len(data), peak=info.peak,
        pluck_at_ms=body.pluck_at_ms, capture=body.capture, fingerprint=body.fingerprint, status="accepted", recorded_by=user.id,
    )
    try:
        db.add(sample)
        db.commit()
    except Exception:
        db.rollback()
        _log.exception("Dataset: the sample row could not be saved; removing its audio")
        try:
            target.delete(key)
        except StorageError:
            _log.exception("Dataset: could not remove the audio %s of the unsaved sample", key)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "The sample could not be saved, so nothing was kept. Please try again.") from None
    db.refresh(sample)
    return SavedSample(sample=SampleOut.of(sample), count_at_position=_count_at(db, guitar.id, body.string_number, body.fret))


@dataclass
class Filters:
    guitar_id: uuid.UUID | None = None
    string_number: int | None = None
    fret: int | None = None
    string_material: StringMaterial | None = None
    background_noise: Noise | None = None
    status: ReviewStatus | None = None


def filters(
    guitar_id: Annotated[uuid.UUID | None, Query(alias="guitarId")] = None,
    string_number: Annotated[int | None, Query(alias="stringNumber", ge=1, le=6)] = None,
    fret: Annotated[int | None, Query(ge=0, le=MAX_FRET)] = None,
    string_material: Annotated[StringMaterial | None, Query(alias="stringMaterial")] = None,
    background_noise: Annotated[Noise | None, Query(alias="backgroundNoise")] = None,
    review_status: Annotated[ReviewStatus | None, Query(alias="status")] = None,
) -> Filters:
    return Filters(guitar_id, string_number, fret, string_material, background_noise, review_status)


def _matching(f: Filters, user: User | None = None):
    """The samples matching the filters; with `user` (not the admin), only their own guitars'."""
    query = select(DatasetSample).join(DatasetSample.guitar)
    if user is not None and user.role != "admin":
        query = query.where(DatasetGuitar.owner_id == user.id)
    if f.guitar_id is not None:
        query = query.where(DatasetSample.guitar_id == f.guitar_id)
    if f.string_number is not None:
        query = query.where(DatasetSample.string_number == f.string_number)
    if f.fret is not None:
        query = query.where(DatasetSample.fret == f.fret)
    if f.string_material is not None:
        query = query.where(DatasetGuitar.string_material == f.string_material)
    if f.background_noise is not None:
        query = query.where(DatasetSample.background_noise == f.background_noise)
    if f.status is not None:
        query = query.where(DatasetSample.status == f.status)
    return query


@router.get("/samples")
def list_samples(
    db: DbSession,
    user: Player,
    f: Annotated[Filters, Depends(filters)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=100)] = 25,
) -> SamplePage:
    """The player's own recordings (the admin: everyone's)."""
    query = _matching(f, user)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.scalars(query.order_by(DatasetSample.recorded_at.desc(), DatasetSample.id).offset((page - 1) * page_size).limit(page_size)).all()
    return SamplePage(items=[SampleOut.of(s) for s in rows], total=total, page=page, page_size=page_size)


@router.get("/samples/{sample_id}/audio-url")
def audio_url(sample_id: uuid.UUID, db: DbSession, user: Player, store: Store) -> dict[str, str]:
    """A link to play the sample: signed and short-lived for the bucket (it stays private)."""
    sample = _own_sample(db, sample_id, user)
    return {"url": _store(store).playback_url(sample.audio_key, str(sample.id))}


@router.get("/samples/{sample_id}/audio")
def audio_file(sample_id: uuid.UUID, db: DbSession, user: Player, store: Store) -> Response:
    """The file itself, through the API: local storage plays this way, and the browser reads older
    recordings this way to make their fingerprints (playing in the list uses signed links)."""
    target = _store(store)
    sample = _own_sample(db, sample_id, user)
    try:
        data = target.get(sample.audio_key)
    except StorageError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The audio file is missing.") from None
    return Response(data, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@router.patch("/samples/{sample_id}")
def change_sample(sample_id: uuid.UUID, body: SampleChange, db: DbSession, user: Player) -> SampleOut:
    sample = _own_sample(db, sample_id, user)
    given = body.model_fields_set
    if "status" in given and body.status is not None:
        sample.status = body.status
    if "notes" in given:
        sample.notes = (body.notes or "").strip() or None
    db.commit()
    db.refresh(sample)
    return SampleOut.of(sample)


@router.put("/samples/{sample_id}/fingerprint")
def save_fingerprint(sample_id: uuid.UUID, body: FingerprintIn, db: DbSession, user: Player) -> SampleOut:
    """An older recording's fingerprint, made in the browser from its audio file."""
    sample = _own_sample(db, sample_id, user)
    sample.fingerprint = body.v
    db.commit()
    db.refresh(sample)
    return SampleOut.of(sample)


@router.delete("/samples/{sample_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sample(sample_id: uuid.UUID, db: DbSession, user: Player, store: Store) -> None:
    """The audio file first, then the row: if the file cannot be removed, the sample stays listed."""
    sample = _own_sample(db, sample_id, user)
    try:
        _store(store).delete(sample.audio_key)
    except StorageError:
        _log.exception("Dataset: could not delete the audio %s", sample.audio_key)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The audio file could not be deleted, so the sample was kept. Please try again.") from None
    db.delete(sample)
    db.commit()


EXPORT_FIELDS = [name for name in SampleOut.model_fields if name not in ("capture", "has_fingerprint")] + ["capture", "storage"]


@router.get("/export")
def export(
    db: DbSession,
    _admin: Admin,
    store: Store,
    f: Annotated[Filters, Depends(filters)],
    file_format: Annotated[Literal["csv", "jsonl"], Query(alias="format")] = "jsonl",
) -> Response:
    """Labels, conditions and storage keys of the matching samples (no audio inside)."""
    rows = db.scalars(_matching(f).order_by(DatasetSample.recorded_at, DatasetSample.id)).all()
    storage = store.name if store else ""
    records = [{**SampleOut.of(s).model_dump(mode="json", by_alias=False, exclude={"has_fingerprint"}), "storage": storage} for s in rows]
    if file_format == "jsonl":
        content = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records)
        media = "application/x-ndjson"
    else:
        out = io.StringIO()
        writer = csv.DictWriter(out, fieldnames=EXPORT_FIELDS, lineterminator="\n")
        writer.writeheader()
        for r in records:
            writer.writerow({**r, "capture": json.dumps(r["capture"]) if r["capture"] is not None else ""})
        content = out.getvalue()
        media = "text/csv"
    return Response(content, media_type=media, headers={"Content-Disposition": f'attachment; filename="guitar-dataset.{file_format}"'})
