"""Limits repeated sign-in attempts (password guessing) and reset requests.

Kept in the database (table auth_attempts), so every server process and every server shares the
same counts: with several workers, a count in memory would give a guesser a fresh limit per worker.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .models import AuthAttempt


class AttemptLimiter:
    def __init__(self, name: str, attempts: int, window_seconds: int) -> None:
        self.name = name
        self.attempts = attempts
        self.window = window_seconds

    def _key(self, key: str) -> str:
        return f"{self.name}:{key}"

    def _since(self) -> datetime:
        return datetime.now(UTC) - timedelta(seconds=self.window)

    def blocked(self, db: Session, *keys: str) -> bool:
        counts = db.execute(
            select(AuthAttempt.key, func.count())
            .where(AuthAttempt.key.in_([self._key(k) for k in keys]), AuthAttempt.at > self._since())
            .group_by(AuthAttempt.key)
        ).all()
        return any(count >= self.attempts for _key, count in counts)

    def record_failure(self, db: Session, *keys: str) -> None:
        """Counts one attempt for each key (saved at once: an error answer follows) and forgets old ones."""
        names = [self._key(k) for k in keys]
        db.execute(delete(AuthAttempt).where(AuthAttempt.key.in_(names), AuthAttempt.at <= self._since()))
        db.add_all(AuthAttempt(key=name) for name in names)
        db.commit()

    def clear(self, db: Session, *keys: str) -> None:
        """Forgets the attempts of these keys; saved with the caller's next commit."""
        db.execute(delete(AuthAttempt).where(AuthAttempt.key.in_([self._key(k) for k in keys])))
