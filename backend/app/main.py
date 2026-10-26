"""The API server. Run locally: uvicorn app.main:app --reload (from the backend folder)."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .auth import router as auth_router
from .sharing import router as sharing_router
from .songs import router as songs_router
from .db import engine

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


@app.get("/api/health/db")
def health_db() -> dict[str, str]:
    with engine.connect() as connection:
        connection.execute(text("select 1"))
    return {"status": "ok"}


app.include_router(auth_router)
app.include_router(songs_router)
app.include_router(sharing_router)
