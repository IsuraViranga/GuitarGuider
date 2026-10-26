"""Settings from environment variables (or a local .env file). Nothing secret is stored in code."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Neon gives "postgresql://user:password@host/db?sslmode=require".
    database_url: str = "postgresql://postgres@localhost:55432/guitar_dev"
    # Cookies only over https. Set COOKIE_SECURE=false for plain http on your own computer.
    cookie_secure: bool = True
    session_days: int = 30
    # Sign-in attempts allowed per email (and per address) in the window below.
    signin_attempts: int = 10
    signin_window_seconds: int = 15 * 60

    @property
    def sqlalchemy_url(self) -> str:
        """The same address, with the driver name SQLAlchemy needs for psycopg 3."""
        url = self.database_url
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
