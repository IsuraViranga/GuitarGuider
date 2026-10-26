from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

import app.auth as auth
from app.db import SessionLocal
from app.main import app
from app.models import AuthSession, PasswordReset, User
from tests.conftest import HEADERS

ISURA = {"name": "Isura Perera", "email": "isura@example.com", "password": "guitar-123"}
ANSWER = "If an account uses this email, a link to choose a new password is on its way."


@pytest.fixture
def outbox(monkeypatch):
    """Reset emails, captured instead of sent: (to, name, link, minutes)."""
    sent: list[tuple[str, str, str, int]] = []
    monkeypatch.setattr(auth, "send_password_reset", lambda *args: sent.append(args))
    return sent


def ask(client, email="isura@example.com"):
    return client.post("/api/auth/forgot-password", json={"email": email})


def token_of(link: str) -> str:
    assert link.startswith("http://localhost:5173/reset-password#")
    return link.split("#", 1)[1]


def test_a_reset_link_is_emailed_and_the_answer_is_the_same_for_unknown_emails(client, outbox):
    client.post("/api/auth/signup", json=ISURA)
    known = ask(client, "  Isura@Example.com ")
    unknown = ask(client, "nobody@example.com")
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json() == {"detail": ANSWER}
    assert len(outbox) == 1
    to, name, link, minutes = outbox[0]
    assert (to, name, minutes) == ("isura@example.com", "Isura Perera", 30)
    with SessionLocal() as db:  # only a hash of the key is stored
        stored = db.scalar(select(PasswordReset))
        assert stored.token_hash != token_of(link) and len(stored.token_hash) == 64


def test_the_link_sets_a_new_password_signs_out_everywhere_and_signs_in(client, outbox):
    client.post("/api/auth/signup", json=ISURA)  # this browser is signed in
    with TestClient(app, headers=HEADERS) as phone:
        ask(phone)
        token = token_of(outbox[0][2])
        assert phone.post("/api/auth/reset-password/check", json={"token": token}).json() == {"email": "isura@example.com"}
        done = phone.post("/api/auth/reset-password", json={"token": token, "password": "new-guitar-1"})
        assert done.status_code == 200 and done.json()["name"] == "Isura Perera"
        assert phone.get("/api/auth/me").status_code == 200  # signed in with the new password
    assert client.get("/api/auth/me").status_code == 401  # the other browser was signed out
    assert client.post("/api/auth/signin", json={"email": ISURA["email"], "password": "guitar-123"}).status_code == 401
    assert client.post("/api/auth/signin", json={"email": ISURA["email"], "password": "new-guitar-1"}).status_code == 200
    with SessionLocal() as db:
        assert db.scalar(select(AuthSession).where(AuthSession.user_id == db.scalar(select(User.id)))) is not None


def test_a_link_works_once_and_a_newer_reset_ends_older_links(client, outbox):
    client.post("/api/auth/signup", json=ISURA)
    ask(client)
    ask(client)
    first, second = token_of(outbox[0][2]), token_of(outbox[1][2])
    assert client.post("/api/auth/reset-password", json={"token": second, "password": "new-guitar-1"}).status_code == 200
    again = client.post("/api/auth/reset-password", json={"token": second, "password": "new-guitar-2"})
    assert again.status_code == 410
    assert again.json()["detail"] == "This link has expired or was already used. Please ask for a new one."
    assert client.post("/api/auth/reset-password", json={"token": first, "password": "new-guitar-2"}).status_code == 410


def test_an_expired_or_made_up_link_does_not_work(client, outbox):
    client.post("/api/auth/signup", json=ISURA)
    ask(client)
    token = token_of(outbox[0][2])
    with SessionLocal() as db:
        db.execute(update(PasswordReset).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        db.commit()
    assert client.post("/api/auth/reset-password/check", json={"token": token}).status_code == 410
    assert client.post("/api/auth/reset-password", json={"token": token, "password": "new-guitar-1"}).status_code == 410
    assert client.post("/api/auth/reset-password", json={"token": "made-up", "password": "new-guitar-1"}).status_code == 410


def test_the_new_password_follows_the_usual_rules(client, outbox):
    client.post("/api/auth/signup", json=ISURA)
    ask(client)
    short = client.post("/api/auth/reset-password", json={"token": token_of(outbox[0][2]), "password": "short"})
    assert short.status_code == 422
    assert short.json()["fields"]["password"] == "Please use at least 8 characters for your password."


def test_at_most_three_emails_per_account_per_hour_quietly(client, outbox):
    client.post("/api/auth/signup", json=ISURA)
    answers = [ask(client).json() for _ in range(5)]
    assert answers == [{"detail": ANSWER}] * 5
    assert len(outbox) == 3


def test_too_many_requests_from_one_address_are_slowed_down(client, outbox):
    for n in range(10):
        assert ask(client, f"someone{n}@example.com").status_code == 202
    blocked = ask(client, "someone-else@example.com")
    assert blocked.status_code == 429


def test_without_an_email_service_it_says_so(client, outbox, monkeypatch):
    monkeypatch.setattr(auth._settings, "email_log_links", False)
    response = ask(client)
    assert response.status_code == 503
    assert response.json()["detail"] == "Password reset by email is not ready yet. Please ask the admin for help."


def test_the_email_goes_to_brevo_with_the_link_and_the_key(monkeypatch):
    import json

    import app.email as email
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "email_api_key", "test-key")
    monkeypatch.setattr(settings, "email_from", "academy@example.com")
    requests = []

    class Answer:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return b"{}"

    monkeypatch.setattr(email.urllib.request, "urlopen", lambda request, timeout: requests.append(request) or Answer())
    email.send_password_reset("isura@example.com", "Isura <b>", "https://site/reset-password#abc", 30)
    (request,) = requests
    assert request.full_url == "https://api.brevo.com/v3/smtp/email"
    assert request.get_header("Api-key") == "test-key"
    body = json.loads(request.data)
    assert body["sender"] == {"name": "Melantha Guitar Academy", "email": "academy@example.com"}
    assert body["to"] == [{"email": "isura@example.com", "name": "Isura <b>"}]
    assert "https://site/reset-password#abc" in body["textContent"]
    assert 'href="https://site/reset-password#abc"' in body["htmlContent"]
    assert "Isura &lt;b&gt;" in body["htmlContent"]  # names are escaped in the HTML
