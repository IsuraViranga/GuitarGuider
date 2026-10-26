from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.auth import COOKIE_NAME
from app.cli import create_admin, main as cli_main
from app.db import engine, SessionLocal
from app.main import app
from app.models import AuthSession, User

ISURA = {"name": "Isura Perera", "email": "Isura@Example.com", "password": "guitar-123"}


def sign_up(client, **overrides):
    return client.post("/api/auth/signup", json={**ISURA, **overrides})


# ---------- sign up ----------


def test_sign_up_creates_the_account_and_signs_in(client):
    response = sign_up(client)
    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Isura Perera"
    assert body["email"] == "isura@example.com"  # stored in lower case
    assert body["role"] == "user"
    assert "password" not in str(body).lower()
    assert client.get("/api/auth/me").json()["email"] == "isura@example.com"


def test_the_password_is_stored_only_as_an_argon2_hash(client):
    sign_up(client)
    with SessionLocal() as db:
        user = db.scalar(select(User))
        assert user.password_hash.startswith("$argon2")
        assert "guitar-123" not in user.password_hash


def test_an_email_can_only_be_used_once_whatever_the_capitals(client):
    assert sign_up(client).status_code == 201
    again = TestClient(app, headers={"X-Requested-With": "fetch"})
    response = again.post("/api/auth/signup", json={**ISURA, "email": "  isura@EXAMPLE.com "})
    assert response.status_code == 409
    assert response.json()["detail"] == "An account with this email already exists. Please sign in instead."


def test_sign_up_explains_each_problem_in_plain_words(client):
    response = client.post("/api/auth/signup", json={"name": "  ", "email": "not-an-email", "password": "short"})
    assert response.status_code == 422
    fields = response.json()["fields"]
    assert fields["name"] == "Please enter your name."
    assert fields["email"] == "Please enter a valid email address, like name@example.com."
    assert fields["password"] == "Please use at least 8 characters for your password."
    missing = client.post("/api/auth/signup", json={"email": "a@b.co"})
    assert missing.json()["fields"]["name"] == "This field is required."


def test_names_are_tidied_and_sinhala_names_work(client):
    response = sign_up(client, name="  ඉසුරු   පෙරේරා ")
    assert response.json()["name"] == "ඉසුරු පෙරේරා"


def test_nobody_can_sign_up_as_admin(client):
    response = client.post("/api/auth/signup", json={**ISURA, "role": "admin"})
    assert response.status_code == 201
    assert response.json()["role"] == "user"


# ---------- sign in / sign out ----------


def test_sign_in_with_the_right_password_and_any_capitals_in_the_email(client):
    sign_up(client)
    client.post("/api/auth/signout")
    response = client.post("/api/auth/signin", json={"email": "ISURA@example.com", "password": "guitar-123"})
    assert response.status_code == 200
    assert response.json()["name"] == "Isura Perera"
    assert client.get("/api/auth/me").status_code == 200


def test_a_wrong_password_and_an_unknown_email_get_the_same_answer(client):
    sign_up(client)
    client.post("/api/auth/signout")
    wrong = client.post("/api/auth/signin", json={"email": ISURA["email"], "password": "wrong-pass"})
    unknown = client.post("/api/auth/signin", json={"email": "nobody@example.com", "password": "guitar-123"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Email or password is incorrect."}


def test_too_many_wrong_passwords_are_stopped_for_a_while(client):
    sign_up(client)
    client.post("/api/auth/signout")
    for _ in range(10):
        assert client.post("/api/auth/signin", json={"email": ISURA["email"], "password": "wrong-pass"}).status_code == 401
    blocked = client.post("/api/auth/signin", json={"email": ISURA["email"], "password": "guitar-123"})
    assert blocked.status_code == 429
    assert "Too many sign-in attempts" in blocked.json()["detail"]


def test_sign_out_ends_the_session_on_the_server_too(client):
    sign_up(client)
    token = client.cookies.get(COOKIE_NAME)
    assert client.post("/api/auth/signout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    # The old cookie no longer works, even if someone kept a copy.
    copy = TestClient(app, headers={"X-Requested-With": "fetch"}, cookies={COOKIE_NAME: token})
    assert copy.get("/api/auth/me").status_code == 401


def test_the_cookie_is_http_only_and_lax(client):
    response = sign_up(client)
    cookie = response.headers["set-cookie"].lower()
    assert f"{COOKIE_NAME}=" in cookie and "httponly" in cookie and "samesite=lax" in cookie and "path=/api" in cookie


def test_only_a_hash_of_the_session_key_is_stored(client):
    sign_up(client)
    token = client.cookies.get(COOKIE_NAME)
    with SessionLocal() as db:
        stored = db.scalar(select(AuthSession))
        assert stored.token_hash != token and len(stored.token_hash) == 64


def test_an_expired_session_is_signed_out(client):
    sign_up(client)
    with engine.begin() as connection:
        connection.execute(text("update auth_sessions set expires_at = :past"), {"past": datetime.now(UTC) - timedelta(minutes=1)})
    assert client.get("/api/auth/me").status_code == 401


def test_not_signed_in_gets_a_clear_message(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "Please sign in."


# ---------- protection ----------


def test_changes_without_the_app_header_are_refused():
    plain = TestClient(app)
    response = plain.post("/api/auth/signup", json=ISURA)
    assert response.status_code == 403
    with SessionLocal() as db:
        assert db.scalar(select(User)) is None


def test_health_checks():
    plain = TestClient(app)
    assert plain.get("/api/health").json() == {"status": "ok"}
    assert plain.get("/api/health/db").json() == {"status": "ok"}


# ---------- admin accounts (command line only) ----------


def test_create_admin_makes_a_new_admin_who_can_sign_in(client):
    assert create_admin("Melantha@Example.com", "Melantha", "stage-lights-1") == "Created admin account melantha@example.com."
    response = client.post("/api/auth/signin", json={"email": "melantha@example.com", "password": "stage-lights-1"})
    assert response.json()["role"] == "admin"


def test_create_admin_can_promote_an_existing_account_keeping_its_password(client):
    sign_up(client)
    assert create_admin(ISURA["email"], "Isura Perera", None) == "isura@example.com is now an admin."
    client.post("/api/auth/signout")
    response = client.post("/api/auth/signin", json={"email": ISURA["email"], "password": "guitar-123"})
    assert response.json()["role"] == "admin"


def test_the_admin_command_checks_the_password_like_sign_up(monkeypatch, capsys):
    monkeypatch.setenv("ADMIN_PW", "short")
    assert cli_main(["create-admin", "--email", "a@example.com", "--name", "A", "--password-env", "ADMIN_PW"]) == 1
    assert "at least 8 characters" in capsys.readouterr().err
    monkeypatch.setenv("ADMIN_PW", "long-enough-pw")
    assert cli_main(["create-admin", "--email", "a@example.com", "--name", "A", "--password-env", "ADMIN_PW"]) == 0


def test_on_the_live_site_the_cookie_is_https_only(client, monkeypatch):
    from app import auth

    monkeypatch.setattr(auth._settings, "cookie_secure", True)
    cookie = sign_up(client).headers["set-cookie"].lower()
    assert "secure" in cookie
