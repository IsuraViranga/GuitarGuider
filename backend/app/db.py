"""Database connection. One small pool per server process; Neon's pooler handles many users."""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


_settings = get_settings()

# At most this many requests use the database at the same moment (app/main.py waits the others).
MAX_CONNECTIONS = _settings.db_pool_size + _settings.db_max_overflow

# Taken while the tables are updated (alembic/env.py) and while built-in songs are added
# (app/seed.py), so two servers starting at the same moment never do it twice at once.
PREPARE_LOCK_ID = 7_202_611

engine = create_engine(
    _settings.sqlalchemy_url,
    pool_size=_settings.db_pool_size,
    max_overflow=_settings.db_max_overflow,
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
