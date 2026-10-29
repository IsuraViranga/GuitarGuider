"""Guitar setup for the string check, kept with the account.

- One per user: saving again replaces it (the app asks the student first).
- Private: only the student reads it.
- Per string ("1"-"6"): the open string's stiffness and its usual misfit, as the app measured
  them (frontend/src/audio/stringCheck.ts). Strings that were skipped are missing.
"""

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .auth import current_user
from .db import get_db
from .models import StringSetup, User
from .song_schemas import Camel

router = APIRouter(prefix="/api/string-setup", tags=["string setup"])
DbSession = Annotated[Session, Depends(get_db)]
SignedInUser = Annotated[User, Depends(current_user)]

StringKey = Literal["1", "2", "3", "4", "5", "6"]
# A guitar string's stiffness is about 0.00001-0.0002; anything outside this is not a measurement.
Stiffness = Annotated[float, Field(gt=0, lt=0.01)]
# The app never keeps a usual misfit above 3.5 cents (MAX_STRING_MISFIT).
Misfit = Annotated[float, Field(ge=0, le=3.5)]


class StringSetupIn(Camel):
    open: dict[StringKey, Stiffness] = Field(min_length=1)
    misfit: dict[StringKey, Misfit] = Field(default_factory=dict)


class StringSetupOut(Camel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, serialize_by_alias=True)

    open: dict[str, float]
    misfit: dict[str, float]
    saved_at: datetime


def _setup_of(db: Session, user: User) -> StringSetup | None:
    return db.get(StringSetup, user.id)


@router.get("")
def get_string_setup(db: DbSession, user: SignedInUser) -> StringSetupOut:
    setup = _setup_of(db, user)
    if setup is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No guitar setup yet.")
    return StringSetupOut(open=setup.open, misfit=setup.misfit, saved_at=setup.saved_at)


@router.put("")
def save_string_setup(body: StringSetupIn, db: DbSession, user: SignedInUser) -> StringSetupOut:
    values = {"open": body.open, "misfit": body.misfit, "saved_at": datetime.now(UTC)}
    statement = insert(StringSetup).values(user_id=user.id, **values)
    db.execute(statement.on_conflict_do_update(index_elements=[StringSetup.user_id], set_=values))
    db.commit()
    setup = _setup_of(db, user)
    db.refresh(setup)
    return StringSetupOut(open=setup.open, misfit=setup.misfit, saved_at=setup.saved_at)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_string_setup(db: DbSession, user: SignedInUser) -> None:
    setup = _setup_of(db, user)
    if setup is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No guitar setup to remove.")
    db.delete(setup)
    db.commit()
