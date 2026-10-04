from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

CRYPTO_EVENT_TYPES = (
    "project_update",
    "protocol_upgrade",
    "mainnet_launch",
    "token_launch",
    "token_unlock",
    "exchange_listing",
    "exchange_delisting",
    "security_incident",
    "governance",
    "regulation_crypto",
    "etf_crypto",
    "influential_social",
    "meme_launch",
    "narrative_signal",
)


class CryptoEventFeedSettings(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,126}[a-z0-9]$")
    name: str = Field(min_length=1, max_length=255)
    source_type: Literal["company", "exchange", "protocol", "regulator"]
    base_url: str
    feed_url: str
    event_type: Literal[
        "project_update",
        "protocol_upgrade",
        "mainnet_launch",
        "token_launch",
        "token_unlock",
        "exchange_listing",
        "exchange_delisting",
        "security_incident",
        "governance",
        "regulation_crypto",
        "etf_crypto",
        "meme_launch",
        "narrative_signal",
    ]
    asset_symbols: list[str] = Field(default_factory=list, max_length=20)
    importance: Literal["critical", "high", "medium", "low"] = "medium"
    recommended_action: Literal[
        "watch", "research", "prepare", "wait_for_confirmation", "caution", "avoid"
    ] = "research"
    opportunity_signal: Literal["none", "watch", "research", "prepare", "wait", "avoid"] = (
        "research"
    )
    confidence: Literal["low", "medium", "high"] = "medium"

    @field_validator("base_url", "feed_url")
    @classmethod
    def https_url(cls, value: str) -> str:
        if not value.startswith("https://") or any(character in value for character in "\r\n"):
            raise ValueError("Crypto Event sources require an HTTPS URL")
        return value.rstrip("/")

    @field_validator("asset_symbols")
    @classmethod
    def symbols(cls, value: list[str]) -> list[str]:
        normalized = [symbol.strip().upper() for symbol in value]
        if any(not symbol or len(symbol) > 20 for symbol in normalized):
            raise ValueError("Asset symbols must be non-empty and at most 20 characters")
        return normalized


def _empty_crypto_event_feeds() -> list[CryptoEventFeedSettings]:
    return []


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
    crypto_event_sync_enabled: bool = False
    crypto_event_poll_interval_seconds: int = Field(default=900, ge=300, le=86400)
    crypto_event_feeds: list[CryptoEventFeedSettings] = Field(
        default_factory=_empty_crypto_event_feeds
    )
    crypto_social_provider: Literal["disabled"] = "disabled"
    ai_provider: Literal["disabled", "openai"] = "disabled"
    ai_model: str = ""
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"


@lru_cache
def get_settings() -> Settings:
    return Settings()
