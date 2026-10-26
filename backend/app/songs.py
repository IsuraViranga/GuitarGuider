"""Songs: the global set list (everyone, even without an account) and each user's own songs.

Who can do what (checked here, on the server):
- Everyone: list, search and open global songs.
- Signed-in users: list, add, change and delete their own songs; move songs from their phone.
- Admin: also add, change and delete global songs.
Nobody can see another user's own songs.
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import current_user, current_user_optional
from .db import get_db
from .models import ShareRequest, Song, User
from .song_schemas import DeviceSongsIn, SongCreate, SongIn, SongOut, SongSummaryOut
from .text import normalize_for_search

router = APIRouter(prefix="/api/songs", tags=["songs"])
DbSession = Annotated[Session, Depends(get_db)]
MaybeUser = Annotated[User | None, Depends(current_user_optional)]
SignedInUser = Annotated[User, Depends(current_user)]

NOT_FOUND = "This song was not found. It may have been deleted."


def _can_edit(song: Song, user: User | None) -> bool:
    if user is None:
        return False
    if song.scope == "global":
        return user.role == "admin"
    return song.owner_id == user.id


def _scope_for(song: Song) -> Literal["global", "mine"]:
    return "global" if song.scope == "global" else "mine"


def summary(song: Song, user: User | None, share: ShareRequest | None = None) -> SongSummaryOut:
    return SongSummaryOut(
        id=song.id,
        title=song.title,
        artist=song.artist,
        description=song.description,
        difficulty=song.difficulty,
        scope=_scope_for(song),
        can_edit=_can_edit(song, user),
        note_count=song.note_count,
        chord_count=song.chord_count,
        updated_at=song.updated_at,
        share_status=share.status if share else None,
        share_reason=share.reason if share else None,
    )


def latest_shares(db: Session, song_ids: list[str]) -> dict[str, ShareRequest]:
    """The most recent share request of each of these songs."""
    latest: dict[str, ShareRequest] = {}
    if song_ids:
        rows = db.scalars(select(ShareRequest).where(ShareRequest.song_id.in_(song_ids)).order_by(ShareRequest.created_at)).all()
        for row in rows:
            latest[row.song_id] = row
    return latest


def own_share(db: Session, song: Song) -> ShareRequest | None:
    return latest_shares(db, [song.id]).get(song.id) if song.scope == "private" else None


def full(song: Song, user: User | None, share: ShareRequest | None = None) -> SongOut:
    return SongOut(
        **summary(song, user, share).model_dump(),
        tuning_id=song.tuning_id,
        source_text=song.source_text,
        notes=song.notes,
    )


def apply(song: Song, data: SongIn) -> None:
    """Copies checked song data onto a database row (and keeps the counts and search text up to date)."""
    song.title = data.title
    song.artist = data.artist
    song.description = data.description
    song.difficulty = data.difficulty
    song.tuning_id = data.tuning_id
    song.source_text = data.source_text
    song.notes = [note.model_dump(by_alias=True, exclude_none=True) for note in data.notes]
    song.note_count = len(data.notes)
    song.chord_count = sum(1 for note in data.notes if note.chord)
    song.search_text = normalize_for_search(f"{data.title} {data.artist or ''}")
    song.updated_at = datetime.now(UTC)


def _visible(db: Session, song_id: str, user: User | None) -> Song:
    song = db.get(Song, song_id)
    if song is None or (song.scope == "private" and (user is None or song.owner_id != user.id)):
        # Someone else's own song looks exactly like a missing one.
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return song


def _editable(db: Session, song_id: str, user: User) -> Song:
    song = _visible(db, song_id, user)
    if not _can_edit(song, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the admin can change songs in the global set list.")
    return song


@router.get("")
def list_songs(
    db: DbSession,
    user: MaybeUser,
    scope: Literal["global", "mine"] = "global",
    q: Annotated[str, Query(max_length=120)] = "",
) -> dict[str, list[SongSummaryOut]]:
    if scope == "mine":
        if user is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in to see your songs.")
        query = select(Song).where(Song.scope == "private", Song.owner_id == user.id).order_by(Song.updated_at.desc())
    else:
        query = select(Song).where(Song.scope == "global").order_by(Song.search_text)
    needle = normalize_for_search(q)
    if needle:
        escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.where(Song.search_text.like(f"%{escaped}%", escape="\\"))
    songs = db.scalars(query.limit(500)).all()
    shares = latest_shares(db, [song.id for song in songs]) if scope == "mine" else {}
    return {"songs": [summary(song, user, shares.get(song.id)) for song in songs]}


@router.get("/{song_id}")
def get_song(song_id: str, db: DbSession, user: MaybeUser) -> SongOut:
    song = _visible(db, song_id, user)
    return full(song, user, own_share(db, song))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_song(body: SongCreate, db: DbSession, user: SignedInUser) -> SongOut:
    if body.scope == "global" and user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the admin can add songs to the global set list.")
    song = Song(
        id=str(uuid.uuid4()),
        scope="global" if body.scope == "global" else "private",
        owner_id=None if body.scope == "global" else user.id,
        created_by=user.id,
    )
    apply(song, body)
    db.add(song)
    db.commit()
    return full(song, user)


@router.put("/{song_id}")
def update_song(song_id: str, body: SongIn, db: DbSession, user: SignedInUser) -> SongOut:
    song = _editable(db, song_id, user)
    apply(song, body)
    db.commit()
    return full(song, user, own_share(db, song))


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_song(song_id: str, db: DbSession, user: SignedInUser) -> None:
    song = _editable(db, song_id, user)
    db.delete(song)
    db.commit()


@router.post("/move-from-device", status_code=status.HTTP_201_CREATED)
def move_from_device(body: DeviceSongsIn, db: DbSession, user: SignedInUser) -> dict[str, list[SongSummaryOut]]:
    """Songs saved on a phone before accounts existed become the user's own songs (all or nothing)."""
    added = []
    for data in body.songs:
        song = Song(id=str(uuid.uuid4()), scope="private", owner_id=user.id, created_by=user.id)
        apply(song, data)
        db.add(song)
        added.append(song)
    db.commit()
    return {"songs": [summary(song, user) for song in added]}

