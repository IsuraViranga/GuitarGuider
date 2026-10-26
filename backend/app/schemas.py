"""What the API accepts and returns. Error messages are written for students, not developers."""

import uuid
from typing import Literal

from email_validator import EmailNotValidError, validate_email
from pydantic import BaseModel, ConfigDict, field_validator

MIN_PASSWORD = 8
MAX_PASSWORD = 128


def _clean_email(value: str) -> str:
    try:
        # No internet check here: a mistyped address simply gets no emails (e.g. no password reset link).
        return validate_email(value.strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError:
        raise ValueError("Please enter a valid email address, like name@example.com.") from None


def _check_password(value: str) -> str:
    if len(value) < MIN_PASSWORD:
        raise ValueError(f"Please use at least {MIN_PASSWORD} characters for your password.")
    if len(value) > MAX_PASSWORD:
        raise ValueError(f"Please use a password of {MAX_PASSWORD} characters or less.")
    if not value.strip():
        raise ValueError("A password cannot be only spaces.")
    return value


class SignUpIn(BaseModel):
    name: str
    email: str
    password: str

    @field_validator("name")
    @classmethod
    def name_ok(cls, value: str) -> str:
        name = " ".join(value.split())
        if not name:
            raise ValueError("Please enter your name.")
        if len(name) > 60:
            raise ValueError("Please use a name of 60 characters or less.")
        return name

    @field_validator("email")
    @classmethod
    def email_ok(cls, value: str) -> str:
        return _clean_email(value)

    @field_validator("password")
    @classmethod
    def password_ok(cls, value: str) -> str:
        return _check_password(value)


class SignInIn(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_ok(cls, value: str) -> str:
        return _clean_email(value)


class ForgotPasswordIn(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def email_ok(cls, value: str) -> str:
        return _clean_email(value)


class ResetLinkIn(BaseModel):
    token: str


class ResetPasswordIn(ResetLinkIn):
    password: str

    @field_validator("password")
    @classmethod
    def password_ok(cls, value: str) -> str:
        return _check_password(value)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    role: Literal["user", "admin"]

    @classmethod
    def of(cls, user) -> "UserOut":
        return cls(id=user.id, name=user.display_name, email=user.email, role=user.role)
