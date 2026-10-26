"""Tests run against a real PostgreSQL database (TEST_DATABASE_URL), never the production one."""

import os

os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgresql://postgres@localhost:55432/guitar_test")
os.environ["COOKIE_SECURE"] = "false"  # the test client talks plain http
os.environ["EMAIL_API_KEY"] = ""
os.environ["EMAIL_LOG_LINKS"] = "true"  # emails are captured by the tests, never sent

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.auth import reset_limiter, signin_limiter  # noqa: E402
from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402

HEADERS = {"X-Requested-With": "fetch"}


@pytest.fixture(scope="session", autouse=True)
def database():
    """Builds the tables with the real migrations (down and up again, so both directions work)."""
    config = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    config.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    config.attributes["configure_logger"] = False
    command.upgrade(config, "head")
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    yield


@pytest.fixture(autouse=True)
def clean_tables():
    with engine.begin() as connection:
        connection.execute(text("truncate password_resets, practice_saves, share_requests, seed_log, songs, auth_sessions, users cascade"))
    signin_limiter.reset()
    reset_limiter.reset()
    yield


@pytest.fixture
def client():
    with TestClient(app, headers=HEADERS) as test_client:
        yield test_client
