"""Sharing a song with everyone: the owner sends a request, the admin approves or rejects it.

- Only the owner of a song (their own, not global) can request; one waiting request per song.
- The request keeps a copy of the song as it was sent; approving publishes that copy (or the
  admin's corrected version) as a NEW global song. The user's own song stays theirs.
- The owner can withdraw a waiting request. A rejection may give a reason (optional).
"""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import current_user, require_admin
from .db import get_db
from .models import ShareRequest, Song, User
from .song_schemas import RejectIn, ShareRequestDetailOut, ShareRequestOut, SongIn, SongSummaryOut
from .songs import _visible, apply, own_share, shared_copy_gone, summary

router = APIRouter(prefix="/api", tags=["sharing"])
DbSession = Annotated[Session, Depends(get_db)]
SignedInUser = Annotated[User, Depends(current_user)]
Admin = Annotated[User, Depends(require_admin)]

ALREADY_WAITING = "This song is already waiting for the admin's review."
REQUEST_NOT_FOUND = "This request was not found. It may have been withdrawn."


def snapshot_of(song: Song) -> dict:
    """The song as it is now, in the same shape the app sends (checked again on approval)."""
    return {
        "title": song.title,
        "artist": song.artist,
        "description": song.description,
        "difficulty": song.difficulty,
        "tuningId": song.tuning_id,
        "sourceText": song.source_text,
        "notes": song.notes,
    }


def request_out(request: ShareRequest) -> ShareRequestOut:
    snap = request.snapshot
    notes = snap.get("notes", [])
    return ShareRequestOut(
        id=str(request.id),
        song_id=request.song_id,
        title=snap.get("title", ""),
        artist=snap.get("artist"),
        requester_name=request.requester.display_name if request.requester else "A former user",
        status=request.status,
        reason=request.reason,
        note_count=len(notes),
        chord_count=sum(1 for note in notes if note.get("chord")),
        created_at=request.created_at,
        reviewed_at=request.reviewed_at,
        global_song_id=request.global_song_id,
    )


def _own_song(db: Session, song_id: str, user: User) -> Song:
    song = _visible(db, song_id, user)
    if song.scope != "private" or song.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can share their own song.")
    return song


def _find(db: Session, request_id: str) -> ShareRequest:
    try:
        request = db.get(ShareRequest, uuid.UUID(request_id))
    except ValueError:
        request = None
    if request is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, REQUEST_NOT_FOUND)
    return request


def _pending(db: Session, request_id: str) -> ShareRequest:
    request = _find(db, request_id)
    if request.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "This request has already been reviewed.")
    return request


# ---------- the song's owner ----------


@router.post("/songs/{song_id}/share", status_code=status.HTTP_201_CREATED)
def request_share(song_id: str, db: DbSession, user: SignedInUser) -> SongSummaryOut:
    song = _own_song(db, song_id, user)
    current = own_share(db, song)
    if current is not None and current.status == "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_WAITING)
    if current is not None and current.status == "approved" and not shared_copy_gone(current):
        # Sharing again would put a second copy in the global set list.
        raise HTTPException(status.HTTP_409_CONFLICT, "This song is already shared with everyone.")
    request = ShareRequest(song_id=song.id, requester_id=user.id, status="pending", snapshot=snapshot_of(song))
    db.add(request)
    try:
        db.commit()
    except IntegrityError:  # two requests at the same moment (one waiting request per song)
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, ALREADY_WAITING) from None
    return summary(song, user, request)


@router.delete("/songs/{song_id}/share", status_code=status.HTTP_204_NO_CONTENT)
def withdraw_share(song_id: str, db: DbSession, user: SignedInUser) -> None:
    song = _own_song(db, song_id, user)
    request = own_share(db, song)
    if request is None or request.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "There is no waiting request to withdraw.")
    db.delete(request)
    db.commit()


# ---------- the admin ----------


@router.get("/share-requests")
def list_requests(db: DbSession, _admin: Admin, state: Literal["pending", "reviewed"] = "pending") -> dict[str, list[ShareRequestOut]]:
    query = select(ShareRequest)
    if state == "pending":
        query = query.where(ShareRequest.status == "pending").order_by(ShareRequest.created_at)
    else:
        query = query.where(ShareRequest.status != "pending").order_by(ShareRequest.reviewed_at.desc()).limit(50)
    return {"requests": [request_out(r) for r in db.scalars(query).all()]}


@router.get("/share-requests/{request_id}")
def get_request(request_id: str, db: DbSession, _admin: Admin) -> ShareRequestDetailOut:
    request = _find(db, request_id)
    return ShareRequestDetailOut(**request_out(request).model_dump(), song=request.snapshot)


@router.post("/share-requests/{request_id}/approve")
def approve(request_id: str, db: DbSession, admin: Admin, body: SongIn | None = None) -> ShareRequestOut:
    """Publishes the song as sent, or the admin's corrected version (body), as a new global song."""
    request = _pending(db, request_id)
    data = body if body is not None else SongIn.model_validate(request.snapshot)
    song = Song(id=str(uuid.uuid4()), scope="global", owner_id=None, created_by=request.requester_id)
    apply(song, data)
    db.add(song)
    db.flush()
    request.status = "approved"
    request.reviewed_by = admin.id
    request.reviewed_at = datetime.now(UTC)
    request.global_song_id = song.id
    db.commit()
    return request_out(request)


@router.post("/share-requests/{request_id}/reject")
def reject(request_id: str, db: DbSession, admin: Admin, body: RejectIn | None = None) -> ShareRequestOut:
    request = _pending(db, request_id)
    reason = " ".join((body.reason or "").split()) if body else ""
    request.status = "rejected"
    request.reason = reason or None
    request.reviewed_by = admin.id
    request.reviewed_at = datetime.now(UTC)
    db.commit()
    return request_out(request)
