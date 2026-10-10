from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SQLITE = f"sqlite:///{(ROOT / 'data' / 'iris_platform.db').as_posix()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env", "../../.env.local"), extra="ignore")

    iris_api_title: str = "IRIS Creator Platform API"
    database_url: str = DEFAULT_SQLITE
    jwt_secret: str = "change-me-iris-platform-dev-only"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12
    bootstrap_admin_email: str = "admin@iris.local"
    bootstrap_admin_password: str = "iris-admin-change-me"
    sandbox_timeout_seconds: int = 8
    allowed_models: str = "local-sim,openai:gpt-5.6-sol,anthropic:claude-sonnet-5"
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173"

    @property
    def model_allowlist(self) -> list[str]:
        return [item.strip() for item in self.allowed_models.split(",") if item.strip()]

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
