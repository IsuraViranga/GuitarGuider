"""Database connection. One small pool per server process; Neon's pooler handles many users."""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


# At most this many requests use the database at the same moment (app/main.py waits the others).
MAX_CONNECTIONS = 20

engine = create_engine(
    get_settings().sqlalchemy_url,
    pool_size=10,
    max_overflow=MAX_CONNECTIONS - 10,
    pool_pre_ping=True,  # Neon closes idle connections; check before use
    pool_recycle=300,
    # Neon's pooled address shares connections between users (PgBouncer), where psycopg's
    # automatic prepared statements can fail; plain queries are safe and fast enough here.
    connect_args={"prepare_threshold": None},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
