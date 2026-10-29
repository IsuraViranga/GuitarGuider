"""The API server. Run locally: uvicorn app.main:app --reload (from the backend folder)."""

import asyncio
import logging
import os
from functools import lru_cache

from alembic.script import ScriptDirectory
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .auth import router as auth_router
from .dataset import router as dataset_router
from .progress import router as progress_router
from .string_setup import router as string_setup_router
from .sharing import router as sharing_router
from .songs import router as songs_router
from .db import MAX_CONNECTIONS, engine

# The app's own messages (e.g. "Brevo refused the email … because …") in Render's Logs tab.
_app_log = logging.getLogger("app")
if not _app_log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    _app_log.addHandler(_handler)
    _app_log.setLevel(logging.INFO)
    _app_log.propagate = False

app = FastAPI(title="Melantha Guitar Academy API", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)

CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def require_app_header(request: Request, call_next):
    """Changes must come from the app itself: other websites cannot add this header without
    permission (CORS is not enabled), so they cannot act for a signed-in user."""
    if request.method in CHANGING_METHODS and request.url.path.startswith("/api/") and request.headers.get("x-requested-with") != "fetch":
        return JSONResponse({"detail": "This request did not come from the app."}, status_code=403)
    return await call_next(request)


@app.middleware("http")
async def never_store(request: Request, call_next):
    """Song lists, sign-in state and requests change all the time: no browser or Netlify edge copy,
    so a song shared or changed a moment ago always shows without refreshing."""
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


# Requests beyond the database's connections wait here, before they take a worker thread. Without
# this, under load every worker thread could be waiting for a connection while the requests that
# hold one wait for a free thread to finish, and everything stalls (found by loadtest/load_test.py).
_database_turns = asyncio.Semaphore(MAX_CONNECTIONS)


@app.middleware("http")
async def one_turn_per_connection(request: Request, call_next):
    if not request.url.path.startswith("/api/") or request.url.path in ("/api/health", "/api/health/live"):
        return await call_next(request)
    async with _database_turns:
        return await call_next(request)


@app.exception_handler(RequestValidationError)
async def friendly_validation_errors(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """{"detail": first message, "fields": {field: message}}, with Pydantic's prefixes removed."""
    fields: dict[str, str] = {}
    for error in exc.errors():
        field = str(error["loc"][-1]) if error.get("loc") else "body"
        message = str(error.get("msg", "Please check this field."))
        if message.startswith("Value error, "):
            message = message[len("Value error, "):]
        elif error.get("type") == "missing":
            message = "This field is required."
        fields.setdefault(field, message)
    first = next(iter(fields.values()), "Please check the form.")
    return JSONResponse({"detail": first, "fields": fields}, status_code=422)


@app.get("/api/health")
def health() -> dict[str, str]:
    """For the hosting service's health check. Does not touch the database, so the database can sleep."""
    return {"status": "ok"}


@app.get("/api/health/live")
def liveness() -> dict[str, str]:
    """Liveness: the server is running and answering. Never touches the database, so checking it
    often (the 5-minute check on Netlify) does not keep the database awake."""
    return {"status": "alive"}


@lru_cache
def _latest_migration() -> str | None:
    folder = os.path.join(os.path.dirname(__file__), "..", "alembic")
    return ScriptDirectory(folder).get_current_head()


@app.get("/api/health/ready")
def readiness() -> JSONResponse:
    """Readiness: the server can do real work: the database answers and has every table change
    (migration) this version needs. 503 if not, with the reason. Wakes the database if it sleeps."""
    try:
        with engine.connect() as connection:
            current = connection.execute(text("select version_num from alembic_version")).scalar()
    except Exception:  # noqa: BLE001 - any database problem means "not ready"
        logging.getLogger("app.health").exception("Readiness check: the database did not answer")
        return JSONResponse({"status": "not ready", "database": "unreachable"}, status_code=503)
    latest = _latest_migration()
    if current != latest:
        return JSONResponse({"status": "not ready", "database": "ok", "migration": current, "expected": latest}, status_code=503)
    return JSONResponse({"status": "ready", "database": "ok", "migration": current})


@app.get("/api/health/db")
def health_db() -> dict[str, str]:
    with engine.connect() as connection:
        connection.execute(text("select 1"))
    return {"status": "ok"}


app.include_router(auth_router)
app.include_router(songs_router)
app.include_router(sharing_router)
app.include_router(progress_router)
app.include_router(string_setup_router)
# Admin-only dataset collector (self-contained: removing this line and app/dataset*.py removes it).
app.include_router(dataset_router)
