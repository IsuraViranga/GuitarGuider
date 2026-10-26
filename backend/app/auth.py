"""Sign up, sign in, sign out, "who am I" and password reset. The session lives in an httpOnly cookie."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .email import send_password_reset
from .models import AuthSession, PasswordReset, User
from .ratelimit import AttemptLimiter
from .schemas import ForgotPasswordIn, ResetLinkIn, ResetPasswordIn, SignInIn, SignUpIn, UserOut
from .security import hash_password, hash_token, needs_rehash, new_session_token, verify_password

COOKIE_NAME = "mga_session"
router = APIRouter(prefix="/api/auth", tags=["auth"])
_settings = get_settings()
signin_limiter = AttemptLimiter(_settings.signin_attempts, _settings.signin_window_seconds)
reset_limiter = AttemptLimiter(_settings.reset_requests_per_address, 3600)

DbSession = Annotated[Session, Depends(get_db)]


def _client_address(request: Request) -> str:
    # Behind Netlify and Render the visitor's address is the first one in X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")


def _start_session(db: Session, user: User, request: Request, response: Response) -> None:
    token = new_session_token()
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=datetime.now(UTC) + timedelta(days=_settings.session_days),
            user_agent=(request.headers.get("user-agent") or "")[:200] or None,
        )
    )
    user.last_sign_in_at = datetime.now(UTC)
    db.commit()
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=_settings.session_days * 24 * 3600,
        httponly=True,
        secure=_settings.cookie_secure,
        samesite="lax",
        path="/api",
    )


def _session_for(db: Session, token: str | None) -> AuthSession | None:
    if not token:
        return None
    found = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
    if found is None:
        return None
    if found.expires_at <= datetime.now(UTC):
        db.delete(found)
        db.commit()
        return None
    return found


def current_user_optional(db: DbSession, mga_session: Annotated[str | None, Cookie()] = None) -> User | None:
    session = _session_for(db, mga_session)
    return session.user if session else None


def current_user(user: Annotated[User | None, Depends(current_user_optional)]) -> User:
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in.")
    return user


def require_admin(user: Annotated[User, Depends(current_user)]) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the admin can do this.")
    return user


@router.post("/signup", status_code=status.HTTP_201_CREATED)
def sign_up(body: SignUpIn, request: Request, response: Response, db: DbSession) -> UserOut:
    if db.scalar(select(User.id).where(User.email == body.email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists. Please sign in instead.")
    db.commit()  # gives the database connection back while the password is hashed (slow on purpose)
    user = User(email=body.email, display_name=body.name, password_hash=hash_password(body.password), role="user")
    db.add(user)
    try:
        db.flush()
    except IntegrityError:  # two sign-ups with the same email at the same moment
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists. Please sign in instead.") from None
    _start_session(db, user, request, response)
    return UserOut.of(user)


@router.post("/signin")
def sign_in(body: SignInIn, request: Request, response: Response, db: DbSession) -> UserOut:
    keys = (f"email:{body.email}", f"addr:{_client_address(request)}")
    if signin_limiter.blocked(*keys):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many sign-in attempts. Please wait a few minutes and try again.")
    user = db.scalar(select(User).where(User.email == body.email))
    db.commit()  # gives the database connection back while the password is checked (slow on purpose)
    if not verify_password(user.password_hash if user else None, body.password) or user is None:
        signin_limiter.record_failure(*keys)
        # The same message for an unknown email and a wrong password, so accounts cannot be discovered here.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect.")
    signin_limiter.clear(f"email:{body.email}")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    _start_session(db, user, request, response)
    return UserOut.of(user)


@router.post("/signout", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(response: Response, db: DbSession, mga_session: Annotated[str | None, Cookie()] = None) -> Response:
    if mga_session:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == hash_token(mga_session)))
        db.commit()
    response.status_code = status.HTTP_204_NO_CONTENT
    response.delete_cookie(COOKIE_NAME, path="/api", secure=_settings.cookie_secure, httponly=True, samesite="lax")
    return response


@router.get("/me")
def me(user: Annotated[User, Depends(current_user)]) -> UserOut:
    return UserOut.of(user)


FORGOT_ANSWER = "If an account uses this email, a link to choose a new password is on its way."
BAD_LINK = "This link has expired or was already used. Please ask for a new one."


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(body: ForgotPasswordIn, request: Request, background: BackgroundTasks, db: DbSession) -> dict[str, str]:
    """Emails a reset link. The answer is the same whether or not the email has an account."""
    if not _settings.email_ready:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Password reset by email is not ready yet. Please ask the admin for help.")
    address = f"addr:{_client_address(request)}"
    if reset_limiter.blocked(address):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests. Please wait a while and try again.")
    reset_limiter.record_failure(address)
    user = db.scalar(select(User).where(User.email == body.email))
    if user is None:
        return {"detail": FORGOT_ANSWER}
    hour_ago = datetime.now(UTC) - timedelta(hours=1)
    recent = db.scalar(select(func.count()).select_from(PasswordReset).where(PasswordReset.user_id == user.id, PasswordReset.created_at > hour_ago))
    if recent >= _settings.reset_per_hour:  # quietly: the answer must not differ
        return {"detail": FORGOT_ANSWER}
    token = new_session_token()
    db.add(PasswordReset(user_id=user.id, token_hash=hash_token(token), expires_at=datetime.now(UTC) + timedelta(minutes=_settings.reset_minutes)))
    db.commit()
    link = f"{_settings.app_url.rstrip('/')}/reset-password#{token}"
    # Sent after answering, so the answer takes as long for an unknown email.
    background.add_task(send_password_reset, user.email, user.display_name, link, _settings.reset_minutes)
    return {"detail": FORGOT_ANSWER}


def _usable_reset(db: Session, token: str) -> PasswordReset | None:
    found = db.scalar(select(PasswordReset).where(PasswordReset.token_hash == hash_token(token)))
    if found is None or found.used_at is not None or found.expires_at <= datetime.now(UTC):
        return None
    return found


@router.post("/reset-password/check")
def check_reset_link(body: ResetLinkIn, db: DbSession) -> dict[str, str]:
    """Before showing the form: is the link still good? Answers with the account's email."""
    found = _usable_reset(db, body.token)
    if found is None:
        raise HTTPException(status.HTTP_410_GONE, BAD_LINK)
    return {"email": found.user.email}


@router.post("/reset-password")
def reset_password(body: ResetPasswordIn, request: Request, response: Response, db: DbSession) -> UserOut:
    """Sets the new password, signs out every other browser, and signs this one in."""
    found = _usable_reset(db, body.token)
    if found is None:
        raise HTTPException(status.HTTP_410_GONE, BAD_LINK)
    user = found.user
    db.commit()  # gives the database connection back while the password is hashed
    new_hash = hash_password(body.password)
    if _usable_reset(db, body.token) is None:  # the same link used twice at the same moment
        raise HTTPException(status.HTTP_410_GONE, BAD_LINK)
    now = datetime.now(UTC)
    user.password_hash = new_hash
    db.execute(update(PasswordReset).where(PasswordReset.user_id == user.id, PasswordReset.used_at.is_(None)).values(used_at=now))
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    signin_limiter.clear(f"email:{user.email}")
    _start_session(db, user, request, response)
    return UserOut.of(user)
