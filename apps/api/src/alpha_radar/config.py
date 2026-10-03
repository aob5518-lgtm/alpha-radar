from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Alpha Radar API"
    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"
    database_url: str = Field(
        default="postgresql+asyncpg://alpha_radar:alpha_radar_local@localhost:5432/alpha_radar"
    )
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"
    market_data_provider: Literal["mock", "coinbase", "bybit"] = "mock"
    market_data_ingestion_enabled: bool = False
    market_data_quote_freshness_seconds: int = Field(default=90, ge=1)
    market_data_future_tolerance_seconds: int = Field(default=30, ge=0)
    coinbase_exchange_api_url: str = "https://api.exchange.coinbase.com"
    coinbase_websocket_url: str = "wss://ws-feed.exchange.coinbase.com"
    market_stream_per_client_limit: int = Field(default=2, ge=1, le=20)
    market_stream_global_limit: int = Field(default=100, ge=1, le=5000)
    market_stream_idle_timeout_seconds: int = Field(default=90, ge=10, le=600)
    coinbase_public_requests_per_second: float = Field(default=8, gt=0, le=10)
    bybit_api_url: str = "https://api.bybit.com"
    bybit_websocket_url: str = "wss://stream.bybit.com/v5/public/linear"
    bybit_public_requests_per_second: float = Field(default=8, gt=0, le=10)
    market_data_http_timeout_seconds: float = Field(default=10.0, gt=0)
    source_ingestion_enabled: bool = False
    sec_source_enabled: bool = False
    fed_source_enabled: bool = False
    source_contact_identity: str = ""
    sec_ciks: list[str] = Field(default_factory=list)
    source_poll_interval_seconds: int = Field(default=900, ge=300)
    sec_requests_per_second: float = Field(default=2, gt=0, le=5)
    fed_requests_per_second: float = Field(default=1, gt=0, le=2)
    source_minimum_interval_seconds: float = Field(default=1, ge=0.2)
    source_http_timeout_seconds: float = Field(default=15, gt=0, le=60)
    event_sync_enabled: bool = False
    event_sync_interval_seconds: int = Field(default=900, ge=300, le=86400)


@lru_cache
def get_settings() -> Settings:
    return Settings()
