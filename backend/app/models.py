"""Database tables: accounts, songs, share requests, saved practice, password resets, guitar setups
and the admin's dataset collector."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

ROLES = ("user", "admin")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role in ('user', 'admin')", name="users_role_valid"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Stored in lower case, so "Me@Mail.com" and "me@mail.com" are the same account.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    display_name: Mapped[str] = mapped_column(String(60))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(10), default="user", server_default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_sign_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    sessions: Mapped[list["AuthSession"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class AuthSession(Base):
    """A signed-in browser. Only a hash of the cookie's random key is stored."""

    __tablename__ = "auth_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(200))

    user: Mapped[User] = relationship(back_populates="sessions")


SCOPES = ("global", "private")
DIFFICULTIES = ("beginner", "intermediate", "advanced")


class Song(Base):
    """A song. Global songs (owner_id empty) are for everyone and only the admin changes them;
    private songs belong to one user."""

    __tablename__ = "songs"
    __table_args__ = (
        CheckConstraint("scope in ('global', 'private')", name="songs_scope_valid"),
        CheckConstraint(
            "(scope = 'global' and owner_id is null) or (scope = 'private' and owner_id is not null)",
            name="songs_owner_matches_scope",
        ),
        CheckConstraint("difficulty is null or difficulty in ('beginner', 'intermediate', 'advanced')", name="songs_difficulty_valid"),
    )

    # Built-in songs keep their old ids ("sample-first-frets"); new songs get a random UUID.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scope: Mapped[str] = mapped_column(String(10))
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    artist: Mapped[str | None] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500))
    difficulty: Mapped[str | None] = mapped_column(String(12))
    tuning_id: Mapped[str] = mapped_column(String(20))
    # The text the song was made from (chord chart, song sheet, numbers…), so it can be edited.
    source_text: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[list] = mapped_column(JSONB)
    note_count: Mapped[int] = mapped_column(Integer)
    chord_count: Mapped[int] = mapped_column(Integer)
    # Title and artist, lower case, for search (Sinhala-safe: see app/text.py).
    search_text: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SeedLog(Base):
    """Built-in songs already added once. A built-in song the admin deletes is not added again."""

    __tablename__ = "seed_log"

    song_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


SHARE_STATUSES = ("pending", "approved", "rejected")


class ShareRequest(Base):
    """A user asks for one of their songs to go into the global set list. The song is copied as it
    was when sent (snapshot), so the admin reviews exactly what will be published."""

    __tablename__ = "share_requests"
    __table_args__ = (CheckConstraint("status in ('pending', 'approved', 'rejected')", name="share_requests_status_valid"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    song_id: Mapped[str] = mapped_column(ForeignKey("songs.id", ondelete="CASCADE"), index=True)
    requester_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="pending")
    snapshot: Mapped[dict] = mapped_column(JSONB)
    reason: Mapped[str | None] = mapped_column(String(500))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    global_song_id: Mapped[str | None] = mapped_column(ForeignKey("songs.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    requester: Mapped[User] = relationship(foreign_keys=[requester_id])


class PracticeSave(Base):
    """A practice the student chose to save: one per user and song (saving again replaces it)."""

    __tablename__ = "practice_saves"
    __table_args__ = (
        UniqueConstraint("user_id", "song_id", name="practice_saves_one_per_song"),
        CheckConstraint("mode in ('strict', 'flow')", name="practice_saves_mode_valid"),
        CheckConstraint("rating is null or rating between 1 and 3", name="practice_saves_rating_valid"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    song_id: Mapped[str] = mapped_column(ForeignKey("songs.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(10))
    completed: Mapped[bool] = mapped_column(Boolean)
    # Steps played right, wrong tries, best run of right notes in a row, steps skipped.
    right_count: Mapped[int] = mapped_column(Integer)
    wrong_count: Mapped[int] = mapped_column(Integer)
    best_streak: Mapped[int] = mapped_column(Integer)
    skipped_count: Mapped[int] = mapped_column(Integer)
    # 1-3 picks, only for a finished song (3 = no mistakes, 2 = up to 3, 1 = more).
    rating: Mapped[int | None] = mapped_column(Integer)
    # "What you played": one entry per step of the song.
    record: Mapped[list] = mapped_column(JSONB)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PasswordReset(Base):
    """A "forgot password" link. Only a hash of its random key is stored; it works once, for a short time."""

    __tablename__ = "password_resets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship()


class StringSetup(Base):
    """The guitar setup for the string check: one per user (doing it again replaces it)."""

    __tablename__ = "string_setups"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # Per string ("1"-"6"): the open string's stiffness, and how regular its overtones usually are (cents).
    open: Mapped[dict] = mapped_column(JSONB)
    misfit: Mapped[dict] = mapped_column(JSONB)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---------- dataset collector (admin only; see app/dataset.py) ----------

GUITAR_TYPES = ("acoustic", "classical", "electric", "other")
STRING_MATERIALS = ("steel", "nylon", "unknown")
STRING_CONSTRUCTIONS = ("wound", "unwound", "unknown")
NOISE_LEVELS = ("quiet", "moderate", "noisy")
PLUCK_METHODS = ("finger", "pick")
PLUCK_STRENGTHS = ("soft", "medium", "strong")
DEVICES = ("phone", "tablet", "laptop", "other")
REVIEW_STATUSES = ("accepted", "needs_review", "rejected")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} in ({', '.join(repr(v) for v in values)})"


class DatasetGuitar(Base):
    """A guitar recorded for the dataset. Names are unique (ignoring case), so each is reused."""

    __tablename__ = "dataset_guitars"
    __table_args__ = (
        CheckConstraint(_one_of("guitar_type", GUITAR_TYPES), name="dataset_guitars_type_valid"),
        CheckConstraint(_one_of("string_material", STRING_MATERIALS), name="dataset_guitars_material_valid"),
        Index("dataset_guitars_name_unique", func.lower(text("name")), unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(60))
    guitar_type: Mapped[str] = mapped_column(String(12))
    string_material: Mapped[str] = mapped_column(String(10))
    # Which strings (1-6) are wound, e.g. [3, 4, 5, 6] (null: not known). Copied to each sample.
    wound_strings: Mapped[list | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DatasetSample(Base):
    """One recorded pluck: its labels, the recording conditions and where its audio file is kept.
    The audio itself is never in the database (see app/dataset_storage.py)."""

    __tablename__ = "dataset_samples"
    __table_args__ = (
        CheckConstraint("string_number between 1 and 6", name="dataset_samples_string_valid"),
        CheckConstraint("fret between 0 and 24", name="dataset_samples_fret_valid"),
        CheckConstraint(_one_of("string_construction", STRING_CONSTRUCTIONS), name="dataset_samples_construction_valid"),
        CheckConstraint(_one_of("background_noise", NOISE_LEVELS), name="dataset_samples_noise_valid"),
        CheckConstraint(_one_of("pluck_method", PLUCK_METHODS), name="dataset_samples_method_valid"),
        CheckConstraint(_one_of("pluck_strength", PLUCK_STRENGTHS), name="dataset_samples_strength_valid"),
        CheckConstraint(f"device is null or {_one_of('device', DEVICES)}", name="dataset_samples_device_valid"),
        CheckConstraint(_one_of("status", REVIEW_STATUSES), name="dataset_samples_status_valid"),
        Index("ix_dataset_samples_position", "guitar_id", "string_number", "fret"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    guitar_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dataset_guitars.id", ondelete="RESTRICT"), index=True)
    string_number: Mapped[int] = mapped_column(Integer)
    fret: Mapped[int] = mapped_column(Integer)
    expected_midi: Mapped[int] = mapped_column(Integer)
    expected_note: Mapped[str] = mapped_column(String(4))
    expected_hz: Mapped[float] = mapped_column(Float)
    string_construction: Mapped[str] = mapped_column(String(8))
    background_noise: Mapped[str] = mapped_column(String(10))
    pluck_method: Mapped[str] = mapped_column(String(8))
    pluck_strength: Mapped[str] = mapped_column(String(8))
    device: Mapped[str | None] = mapped_column(String(8))
    notes: Mapped[str | None] = mapped_column(Text)
    # The audio file: its key in the storage, and what the file really is (read from the file).
    audio_key: Mapped[str] = mapped_column(String(120), unique=True)
    audio_format: Mapped[str] = mapped_column(String(20))
    sample_rate: Mapped[int] = mapped_column(Integer)
    bit_depth: Mapped[int] = mapped_column(Integer)
    channels: Mapped[int] = mapped_column(Integer)
    duration_ms: Mapped[int] = mapped_column(Integer)
    audio_bytes: Mapped[int] = mapped_column(Integer)
    peak: Mapped[float] = mapped_column(Float)
    # When the app heard the pluck start, ms from the start of the file (null: not heard).
    pluck_at_ms: Mapped[int | None] = mapped_column(Integer)
    # How the browser captured the sound (e.g. its sample rate and that its sound processing was off).
    capture: Mapped[dict | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(12), default="accepted", server_default="accepted")
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    guitar: Mapped[DatasetGuitar] = relationship()
