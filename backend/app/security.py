"""Passwords (argon2) and session keys. Plain passwords and keys are never stored."""

import hashlib
import secrets
from threading import BoundedSemaphore

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()
# Each hash uses about 64 MB of memory (that is what makes guessing slow). The free server has
# 512 MB, so at most two are worked out at the same moment; others wait their turn briefly.
_hashing = BoundedSemaphore(2)
# Checked when an email has no account, so a wrong email takes as long as a wrong password.
_DUMMY_HASH = _hasher.hash("not-a-real-password")


def hash_password(password: str) -> str:
    with _hashing:
        return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        with _hashing:
            return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def new_session_token() -> str:
    """A random key for the session cookie (256 bits)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
