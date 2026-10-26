"""What a song looks like on the way in and out. Field names match the app (camelCase).

Every song is checked here before it is saved, with the same rules as the app: each step's pitch
must be exactly its string and fret in standard tuning, chords use different strings, steps are
numbered in order. So a broken or tampered song can never reach other users.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

MAX_NOTES = 2000
MAX_SOURCE_TEXT = 100 * 1024
MAX_FRET = 24
# Open-string pitch (MIDI) of strings 1 (thinnest) to 6 in standard tuning.
STANDARD_OPEN = {1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40}

Difficulty = Literal["beginner", "intermediate", "advanced"]


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Position(Camel):
    string_number: int = Field(ge=1, le=6)
    fret: int = Field(ge=0, le=MAX_FRET)


class ChordTone(Camel):
    midi: int
    position: Position


class Chord(Camel):
    name: str | None = Field(default=None, max_length=24)
    tones: list[ChordTone] = Field(min_length=2, max_length=6)
    simplified_from: str | None = Field(default=None, max_length=120)


class SongNote(Camel):
    index: int = Field(ge=0)
    midi: int
    position: Position | None
    chord: Chord | None = None
    lyric: str | None = Field(default=None, max_length=300)
    duration_beats: float | None = Field(default=None, gt=0, le=64)
    measure: int | None = Field(default=None, ge=0, le=100_000)
    # Which line of the sheet the step was written on (1, 2, …); absent for one-line songs.
    line: int | None = Field(default=None, ge=1, le=100_000)

    @model_validator(mode="after")
    def pitch_matches_position(self) -> "SongNote":
        step = self.index + 1
        if self.position is None:
            raise ValueError(f"Step {step} has no string and fret.")
        if self.midi != STANDARD_OPEN[self.position.string_number] + self.position.fret:
            raise ValueError(f"Step {step}: the note does not match string {self.position.string_number}, fret {self.position.fret}.")
        if self.chord:
            strings = [tone.position.string_number for tone in self.chord.tones]
            if len(set(strings)) != len(strings):
                raise ValueError(f"Step {step}: a chord can use each string only once.")
            for tone in self.chord.tones:
                if tone.midi != STANDARD_OPEN[tone.position.string_number] + tone.position.fret:
                    raise ValueError(f"Step {step}: a chord note does not match its string and fret.")
            lowest = min(self.chord.tones, key=lambda tone: tone.midi)
            if self.midi != lowest.midi or self.position != lowest.position:
                raise ValueError(f"Step {step}: a chord step must point at its lowest string.")
        return self


class SongIn(Camel):
    """A new or changed song, as made by the app's "Add a song" page."""

    title: str
    artist: str | None = None
    description: str | None = None
    difficulty: Difficulty | None = None
    tuning_id: Literal["standard"] = "standard"
    source_text: str | None = Field(default=None, max_length=MAX_SOURCE_TEXT)
    notes: list[SongNote] = Field(min_length=1, max_length=MAX_NOTES)

    @field_validator("title")
    @classmethod
    def title_ok(cls, value: str) -> str:
        title = " ".join(value.split())
        if not title:
            raise ValueError("Please give the song a title.")
        if len(title) > 120:
            raise ValueError("Please use a title of 120 characters or less.")
        return title

    @field_validator("artist", "description")
    @classmethod
    def optional_text(cls, value: str | None, info) -> str | None:
        if value is None:
            return None
        text = " ".join(value.split())
        limit = 120 if info.field_name == "artist" else 500
        if len(text) > limit:
            raise ValueError(f"Please use {limit} characters or less.")
        return text or None

    @model_validator(mode="after")
    def steps_in_order(self) -> "SongIn":
        for i, note in enumerate(self.notes):
            if note.index != i:
                raise ValueError(f"Step {i + 1} is numbered {note.index + 1}; steps must be numbered in order.")
        return self


class SongCreate(SongIn):
    # Only the admin may add straight to the global set list.
    scope: Literal["mine", "global"] = "mine"


class DeviceSongsIn(Camel):
    """Songs that were saved on a phone before accounts existed, moved into the user's account."""

    songs: list[SongIn] = Field(min_length=1, max_length=100)


class SongSummaryOut(Camel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, serialize_by_alias=True)

    id: str
    title: str
    artist: str | None
    description: str | None
    difficulty: Difficulty | None
    scope: Literal["global", "mine"]
    can_edit: bool
    note_count: int
    chord_count: int
    updated_at: datetime


class SongOut(SongSummaryOut):
    tuning_id: str
    source_text: str | None
    notes: list[dict]
