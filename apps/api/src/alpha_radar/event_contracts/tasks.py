from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import uuid4

import httpx
import structlog
from redis.asyncio import Redis

from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.event_contracts.provider import BinanceIndexProvider, IndexProvider
from alpha_radar.event_contracts.repository import ResearchRepository
from alpha_radar.event_contracts.service import ingest_bars, observe, publish, seed_indices
from alpha_radar.worker import app

logger = structlog.get_logger(__name__)
LOCK_KEY = "alpha-radar:event-contracts:lease"
STATUS_KEY = "alpha-radar:event-contracts:status"


async def sync(provider: IndexProvider, *, now: datetime | None = None) -> dict[str, object]:
    succeeded: list[str] = []
    failed: list[str] = []
    async with async_session_factory() as seed_session:
        instruments = await seed_indices(seed_session)
        identities = [(item.id, item.provider_instrument_id) for item in instruments]
    for instrument_id, symbol in identities:
        async with async_session_factory() as session:
            try:
                at = now or datetime.now(UTC)
                repository = ResearchRepository(session)
                instrument = await repository.market.get_instrument(instrument_id)
                if instrument is None:
                    raise ValueError("Missing canonical index instrument")
                history = await repository.history(instrument)
                missing = (
                    int((at - history[-1].close_time).total_seconds() / 60) if history else 2000
                )
                first = await provider.fetch(symbol, end=at, limit=min(1000, max(10, missing + 2)))
                await ingest_bars(repository, instrument, first)
                if len(history) + len(first) < 1200 and first:
                    older = await provider.fetch(symbol, end=first[0].open_time, limit=1000)
                    await ingest_bars(repository, instrument, older)
                # No network work occurs in an API handler. Each asset commits independently.
                await observe(repository, instrument, now=at)
                await publish(repository, instrument, 10, now=at)
                await publish(repository, instrument, 30, now=at)
                refreshed = await repository.history(instrument, limit=1)
                if not refreshed or at - refreshed[-1].close_time > timedelta(seconds=90):
                    raise ValueError("Stale Binance index response")
                succeeded.append(symbol)
            except Exception as error:
                await session.rollback()
                failed.append(symbol)
                await logger.aexception(
                    "event_contract_index_sync_failed",
                    symbol=symbol,
                    error_type=type(error).__name__,
                    timestamp=datetime.now(UTC).isoformat(),
                )
    return {
        "status": "degraded" if succeeded and failed else "failed" if failed else "healthy",
        "last_run": (now or datetime.now(UTC)).isoformat(),
        "succeeded": succeeded,
        "failed": failed,
    }


async def run_sync() -> dict[str, object]:
    settings = get_settings()
    if not settings.event_contracts_enabled:
        return {"status": "disabled"}
    redis = Redis.from_url(settings.redis_url, decode_responses=True)  # pyright: ignore[reportUnknownMemberType]
    token = str(uuid4())
    acquired = False
    try:
        acquired = bool(await redis.set(LOCK_KEY, token, nx=True, ex=180))
        if not acquired:
            return {"status": "already_running"}
        async with httpx.AsyncClient(
            timeout=10, headers={"User-Agent": "AlphaRadar/0.1"}
        ) as client:
            result = await sync(BinanceIndexProvider(client))
        await redis.set(STATUS_KEY, json.dumps(result), ex=3600)
        await logger.ainfo("event_contract_index_sync", **result)
        return result
    finally:
        if acquired:
            await cast(
                Awaitable[object],
                redis.eval(
                    "if redis.call('get', KEYS[1]) == ARGV[1] "
                    "then return redis.call('del', KEYS[1]) end",
                    1,
                    LOCK_KEY,
                    token,
                ),
            )
        await redis.aclose()
        await engine.dispose()


@app.task(name="alpha_radar.event_contracts.sync", soft_time_limit=120, time_limit=150)  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
def sync_event_contracts() -> dict[str, object]:
    return asyncio.run(run_sync())
