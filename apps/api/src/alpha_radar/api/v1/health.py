from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine

from alpha_radar.config import get_settings
from alpha_radar.db.session import engine
from alpha_radar.events.operations import (
    CryptoSyncOperations,
    SocialSyncOperations,
    get_crypto_sync_operations,
    get_social_sync_operations,
)
from alpha_radar.events.social import social_monitoring_enabled
from alpha_radar.health import (
    get_dependency_status,
    get_event_sync_status,
    get_market_operational_status,
    operationally_ready,
)

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class ReadinessChecks(BaseModel):
    database: bool
    redis: bool
    market: bool


class MarketOperations(BaseModel):
    provider: str
    ingestion_enabled: bool
    history_current: bool
    history_latest: dict[str, datetime | None]


class EventSyncOperations(BaseModel):
    enabled: bool
    status: str
    last_success: str | None


class OperationalMetadata(BaseModel):
    app_env: str
    market: MarketOperations
    event_sync: EventSyncOperations
    crypto_event_sync: CryptoSyncOperations
    crypto_social_sync: SocialSyncOperations
    ai_configured: Literal["reported_by_web"] = "reported_by_web"
    ai_rate_limiter: Literal["redis"] = "redis"
    streaming_enabled: bool


class ReadinessResponse(BaseModel):
    status: Literal["ok", "not_ready"]
    checks: ReadinessChecks
    operations: OperationalMetadata


def get_engine() -> AsyncEngine:
    return engine


def get_redis_client() -> Redis:
    return Redis.from_url(get_settings().redis_url)  # pyright: ignore[reportUnknownMemberType]


@router.get("", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@router.get("/ready", response_model=ReadinessResponse)
async def readiness(
    response: Response,
    database_engine: Annotated[AsyncEngine, Depends(get_engine)],
    redis_client: Annotated[Redis, Depends(get_redis_client)],
) -> ReadinessResponse:
    settings = get_settings()
    try:
        dependency_status = await get_dependency_status(database_engine, redis_client)
        market = await get_market_operational_status(database_engine, settings)
        event_sync = await get_event_sync_status(redis_client, settings)
        crypto_event_sync = await get_crypto_sync_operations(
            redis_client, enabled=settings.crypto_event_sync_enabled
        )
        crypto_social_sync = await get_social_sync_operations(
            redis_client, enabled=social_monitoring_enabled(settings)
        )
    finally:
        await redis_client.aclose()
    production_market_ready = settings.app_env != "production" or market.ready
    ready = operationally_ready(dependency_status, market, settings)
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadinessResponse(
        status="ok" if ready else "not_ready",
        checks=ReadinessChecks(
            database=dependency_status.database,
            redis=dependency_status.redis,
            market=production_market_ready,
        ),
        operations=OperationalMetadata(
            app_env=settings.app_env,
            market=MarketOperations(
                provider=market.provider,
                ingestion_enabled=market.ingestion_enabled,
                history_current=market.history_current,
                history_latest=market.history_latest,
            ),
            event_sync=EventSyncOperations.model_validate(event_sync),
            crypto_event_sync=crypto_event_sync,
            crypto_social_sync=crypto_social_sync,
            streaming_enabled=settings.market_data_provider in {"coinbase", "bybit"},
        ),
    )
