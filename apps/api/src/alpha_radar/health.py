from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal, cast

from redis.asyncio import Redis
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine

from alpha_radar.config import Settings
from alpha_radar.market_data.constants import INTERVAL_DEFINITIONS, MarketInterval
from alpha_radar.market_data.models import MarketCandle, MarketInstrument

EVENT_SYNC_STATE_KEY = "alpha-radar:event-sync:status"


@dataclass(frozen=True)
class DependencyStatus:
    database: bool
    redis: bool

    @property
    def ready(self) -> bool:
        return self.database and self.redis


async def check_database(engine: AsyncEngine) -> bool:
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


async def check_redis(client: Redis) -> bool:
    try:
        return bool(await client.ping())  # pyright: ignore[reportUnknownMemberType]
    except Exception:
        return False


async def get_dependency_status(engine: AsyncEngine, client: Redis) -> DependencyStatus:
    database = await check_database(engine)
    redis = await check_redis(client)
    return DependencyStatus(database=database, redis=redis)


def readiness_label(status: DependencyStatus) -> Literal["ok", "not_ready"]:
    return "ok" if status.ready else "not_ready"


def operationally_ready(
    dependency_status: DependencyStatus,
    market_status: MarketOperationalStatus,
    settings: Settings,
) -> bool:
    return dependency_status.ready and (settings.app_env != "production" or market_status.ready)


@dataclass(frozen=True)
class MarketOperationalStatus:
    provider: str
    ingestion_enabled: bool
    history_latest: dict[str, datetime | None]
    history_current: bool

    @property
    def ready(self) -> bool:
        return self.provider != "mock" and self.ingestion_enabled and self.history_current


async def get_market_operational_status(
    engine: AsyncEngine, settings: Settings, *, now: datetime | None = None
) -> MarketOperationalStatus:
    try:
        async with engine.connect() as connection:
            if settings.market_data_provider == "bybit":
                raw_rows = (
                    await connection.execute(
                        select(
                            MarketInstrument.provider_instrument_id,
                            MarketCandle.interval,
                            func.max(MarketCandle.close_time),
                        )
                        .join(
                            MarketInstrument,
                            MarketInstrument.id == MarketCandle.market_instrument_id,
                        )
                        .where(
                            MarketCandle.is_closed.is_(True),
                            MarketInstrument.provider == "bybit",
                            MarketInstrument.provider_instrument_id.in_(
                                ("BTCUSDT", "ETHUSDT", "SOLUSDT")
                            ),
                        )
                        .group_by(
                            MarketInstrument.provider_instrument_id,
                            MarketCandle.interval,
                        )
                    )
                ).tuples()
                instrument_rows = cast(
                    list[tuple[str, MarketInterval, datetime | None]], list(raw_rows)
                )
                return bybit_operational_status(settings, instrument_rows, now=now)
            raw_rows = (
                await connection.execute(
                    select(MarketCandle.interval, func.max(MarketCandle.close_time))
                    .join(
                        MarketInstrument,
                        MarketInstrument.id == MarketCandle.market_instrument_id,
                    )
                    .where(
                        MarketCandle.is_closed.is_(True),
                        MarketInstrument.provider == settings.market_data_provider,
                    )
                    .group_by(MarketCandle.interval)
                )
            ).tuples()
            rows = cast(list[tuple[MarketInterval, datetime | None]], list(raw_rows))
    except Exception:
        if settings.market_data_provider == "bybit":
            return bybit_operational_status(settings, [], now=now)
        rows = []
    latest_by_interval: dict[MarketInterval, datetime] = {
        interval: _utc(close_time) for interval, close_time in rows if close_time is not None
    }
    reference = _utc(now or datetime.now(UTC))
    history_latest = {
        interval.value: latest_by_interval.get(interval) for interval in MarketInterval
    }
    history_current = all(
        timestamp is not None
        and reference - timestamp <= INTERVAL_DEFINITIONS[interval].duration * 2
        for interval, timestamp in (
            (interval, latest_by_interval.get(interval)) for interval in MarketInterval
        )
    )
    return MarketOperationalStatus(
        provider=settings.market_data_provider,
        ingestion_enabled=settings.market_data_ingestion_enabled,
        history_latest=history_latest,
        history_current=history_current,
    )


def bybit_operational_status(
    settings: Settings,
    rows: Sequence[tuple[str, MarketInterval, datetime | None]],
    *,
    now: datetime | None,
) -> MarketOperationalStatus:
    reference = _utc(now or datetime.now(UTC))
    latest = {
        (instrument, interval): _utc(close_time)
        for instrument, interval, close_time in rows
        if close_time is not None
    }
    required = [
        (instrument, interval)
        for instrument in ("BTCUSDT", "ETHUSDT", "SOLUSDT")
        for interval in MarketInterval
    ]
    history_latest = {
        f"{instrument}:{interval.value}": latest.get((instrument, interval))
        for instrument, interval in required
    }
    history_current = all(
        timestamp is not None
        and reference - timestamp <= INTERVAL_DEFINITIONS[interval].duration * 2
        for (_instrument, interval), timestamp in (
            ((instrument, interval), latest.get((instrument, interval)))
            for instrument, interval in required
        )
    )
    return MarketOperationalStatus(
        provider=settings.market_data_provider,
        ingestion_enabled=settings.market_data_ingestion_enabled,
        history_latest=history_latest,
        history_current=history_current,
    )


async def get_event_sync_status(client: Redis, settings: Settings) -> dict[str, object]:
    try:
        raw = await client.get(EVENT_SYNC_STATE_KEY)  # pyright: ignore[reportUnknownMemberType]
    except Exception:
        return {
            "enabled": settings.event_sync_enabled,
            "status": "unavailable",
            "last_success": None,
        }
    if not raw:
        return {"enabled": settings.event_sync_enabled, "status": "never", "last_success": None}
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"enabled": settings.event_sync_enabled, "status": "invalid", "last_success": None}
    return {
        "enabled": settings.event_sync_enabled,
        "status": str(payload.get("status", "unknown")),
        "last_success": payload.get("last_success"),
    }


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
