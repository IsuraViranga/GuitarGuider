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
    # The website's address, for links in emails (password reset).
    app_url: str = "http://localhost:5173"
    # Emails are sent with Brevo's HTTP API (Render's free plan blocks SMTP). Without a key, no email
    # can be sent; EMAIL_LOG_LINKS=true prints the link in the server log instead (own computer only).
    email_api_key: str = ""
    email_from: str = ""
    email_from_name: str = "Melantha Guitar Academy"
    email_log_links: bool = False
    reset_minutes: int = 30
    # Reset emails per account per hour (and requests per address per hour).
    reset_per_hour: int = 3
    reset_requests_per_address: int = 10

    @property
    def email_ready(self) -> bool:
        return bool(self.email_api_key and self.email_from) or self.email_log_links

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
