"""Saved practice ("My progress"): the student saves a practice when they choose to.

- One saved practice per song: saving again replaces it.
- Only songs the student can open (global songs and their own songs).
- Private: nobody else (not even the admin) can read it.
- The 1-3 pick rating is worked out here from the result, with the same rule as the app.
"""

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .auth import current_user
from .db import get_db
from .models import PracticeSave, Song, User
from .song_schemas import Camel, Position
from .songs import _visible

router = APIRouter(prefix="/api/progress", tags=["progress"])
DbSession = Annotated[Session, Depends(get_db)]
SignedInUser = Annotated[User, Depends(current_user)]

MAX_TRIES_PER_STEP = 50
MAX_COUNT = 1_000_000


class HeardNote(Camel):
    heard_midi: float = Field(ge=0, le=140)
    # The string check heard the right note on another string: where it was played.
    heard_position: Position | None = None


class HeardChord(Camel):
    heard_chord: str | None = Field(max_length=24)


class StepRecord(Camel):
    wrong: list[HeardNote | HeardChord] = Field(max_length=MAX_TRIES_PER_STEP)
    result: Literal["correct", "skipped"] | None


class PracticeIn(Camel):
    mode: Literal["strict", "flow"]
    completed: bool
    wrong_count: int = Field(ge=0, le=MAX_COUNT)
    best_streak: int = Field(ge=0, le=MAX_COUNT)
    skipped_count: int = Field(ge=0, le=MAX_COUNT)
    record: list[StepRecord] = Field(min_length=1, max_length=2000)


class PracticeOut(Camel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, serialize_by_alias=True)

    song_id: str
    song_title: str
    song_artist: str | None
    song_scope: Literal["global", "mine"]
    mode: Literal["strict", "flow"]
    completed: bool
    right_count: int
    wrong_count: int
    best_streak: int
    skipped_count: int
    rating: int | None
    total_steps: int
    played_steps: int
    saved_at: datetime


class PracticeDetailOut(PracticeOut):
    record: list[dict]


def rating_for(completed: bool, wrong_count: int) -> int | None:
    """3 picks for no mistakes, 2 for up to 3, 1 for more; only for a finished song."""
    if not completed:
        return None
    if wrong_count == 0:
        return 3
    return 2 if wrong_count <= 3 else 1


def practice_out(save: PracticeSave, song: Song) -> PracticeOut:
    return PracticeOut(
        song_id=song.id,
        song_title=song.title,
        song_artist=song.artist,
        song_scope="global" if song.scope == "global" else "mine",
        mode=save.mode,
        completed=save.completed,
        right_count=save.right_count,
        wrong_count=save.wrong_count,
        best_streak=save.best_streak,
        skipped_count=save.skipped_count,
        rating=save.rating,
        total_steps=len(save.record),
        played_steps=sum(1 for step in save.record if step.get("result") or step.get("wrong")),
        saved_at=save.saved_at,
    )


@router.get("")
def list_progress(db: DbSession, user: SignedInUser) -> dict[str, list[PracticeOut]]:
    rows = db.execute(
        select(PracticeSave, Song).join(Song, Song.id == PracticeSave.song_id).where(PracticeSave.user_id == user.id).order_by(PracticeSave.saved_at.desc())
    ).all()
    # A song that became someone else's (it cannot) or private is never shown; global and own only.
    return {"progress": [practice_out(save, song) for save, song in rows if song.scope == "global" or song.owner_id == user.id]}


def _save_of(db: Session, user: User, song_id: str) -> PracticeSave | None:
    return db.scalar(select(PracticeSave).where(PracticeSave.user_id == user.id, PracticeSave.song_id == song_id))


@router.get("/{song_id}")
def get_progress(song_id: str, db: DbSession, user: SignedInUser) -> PracticeDetailOut:
    song = _visible(db, song_id, user)
    save = _save_of(db, user, song.id)
    if save is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No saved practice for this song yet.")
    return PracticeDetailOut(**practice_out(save, song).model_dump(), record=save.record)


@router.put("/{song_id}")
def save_progress(song_id: str, body: PracticeIn, db: DbSession, user: SignedInUser) -> PracticeOut:
    song = _visible(db, song_id, user)
    if len(body.record) != song.note_count:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "This practice does not match the song any more (it may have been changed). Please practise it again.",
        )
    # Only what was sent is stored (a try without a position stays exactly as before).
    record = [step.model_dump(by_alias=True, exclude_unset=True) for step in body.record]
    values = {
        "mode": body.mode,
        "completed": body.completed,
        "right_count": sum(1 for step in body.record if step.result == "correct"),
        "wrong_count": body.wrong_count,
        "best_streak": body.best_streak,
        "skipped_count": body.skipped_count,
        "rating": rating_for(body.completed, body.wrong_count),
        "record": record,
        "saved_at": datetime.now(UTC),
    }
    # One per song: insert, or replace the earlier save (safe if two saves arrive at once).
    statement = insert(PracticeSave).values(user_id=user.id, song_id=song.id, **values)
    db.execute(statement.on_conflict_do_update(constraint="practice_saves_one_per_song", set_=values))
    db.commit()
    return practice_out(_save_of(db, user, song.id), song)


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_progress(song_id: str, db: DbSession, user: SignedInUser) -> None:
    save = _save_of(db, user, song_id)
    if save is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No saved practice for this song.")
    db.delete(save)
    db.commit()
