import asyncio
import json
from collections.abc import Awaitable
from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

import structlog
from redis.asyncio import Redis

from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.event_contracts.shadow_repository import ShadowRepository
from alpha_radar.event_contracts.shadow_rules import (
    FRESHNESS,
    HORIZONS,
    RULES,
    SYMBOLS,
    snapshot_key,
)
from alpha_radar.event_contracts.shadow_schemas import (
    ShadowAssessment,
    ShadowObservation,
    ShadowResponse,
)
from alpha_radar.event_contracts.shadow_strategy import evaluate
from alpha_radar.event_contracts.strategy import Horizon, utc
from alpha_radar.market_data.models import MarketInstrument
from alpha_radar.market_data.repository import MarketDataRepository
from alpha_radar.worker import app

logger = structlog.get_logger(__name__)
STATUS_KEY = "alpha-radar:event-signal-v1:status"
LOCK_KEY = "alpha-radar:event-signal-v1:lease"


async def assess_latest(
    repository: ShadowRepository,
    instrument: MarketInstrument,
    reference: MarketInstrument | None,
    horizon: Horizon,
    now: datetime,
) -> ShadowResponse:
    rules = RULES[horizon]
    trigger = await repository.series(instrument, rules.trigger, now)
    cutoff = trigger.candles[-1].closed if trigger.candles else now
    context = await repository.series(instrument, rules.context, cutoff)
    quote = await MarketDataRepository(repository.session).latest_quote_for_instrument(
        instrument.id
    )
    snapshot_ok = (
        quote is not None
        and quote.provider == "bybit"
        and quote.price > 0
        and (utc(quote.observed_at) <= now <= utc(quote.observed_at) + FRESHNESS)
        and (
            quote.provider_timestamp is None
            or utc(quote.provider_timestamp) <= now <= utc(quote.provider_timestamp) + FRESHNESS
        )
    )
    strike = await repository.index_close(reference.id, cutoff) if reference else None
    assessment = ShadowAssessment.model_validate(
        evaluate(
            trigger,
            context,
            horizon,
            instrument_id=instrument.id,
            now=now,
            macro_blocked=await repository.macro_blocked(cutoff, known_at=now),
            reference_available=strike is not None,
            snapshot_available=snapshot_ok,
        )
    )
    frozen = None
    if assessment.state != "WAIT" and strike is not None and reference is not None:
        assessment.features["bybit_snapshot_price"] = float(quote.price) if quote else 0.0
        frozen = await repository.record(
            instrument=instrument,
            reference=reference,
            horizon=horizon,
            assessment=assessment,
            strike=strike,
            now=now,
        )
        if frozen:
            assessment = ShadowAssessment.model_validate(frozen.assessment)
        else:
            assessment = assessment.model_copy(
                update={
                    "state": "WAIT",
                    "direction": None,
                    "reason": "episode_already_seen",
                }
            )
    return ShadowResponse(
        asset_id=instrument.asset_id,
        market_instrument_id=instrument.id,
        reference_instrument_id=reference.id if reference else None,
        symbol=instrument.base_currency,
        horizon_minutes=horizon,
        assessment=assessment,
        generated_at=utc(frozen.generated_at) if frozen else now,
        valid_until=(cutoff + FRESHNESS) if frozen else now + FRESHNESS,
        signal=ShadowObservation.model_validate(frozen) if frozen else None,
        observations=[
            ShadowObservation.model_validate(row)
            for row in await repository.recent(instrument.id, horizon)
        ],
    )


async def sync_shadow() -> dict[str, object]:
    settings = get_settings()
    if not settings.event_signal_shadow_enabled:
        return {"status": "disabled"}
    redis = Redis.from_url(settings.redis_url)  # pyright: ignore[reportUnknownMemberType]
    token = str(uuid4())
    acquired = False
    try:
        acquired = bool(await redis.set(LOCK_KEY, token, nx=True, ex=30))
        if not acquired:
            return {"status": "already_running"}
        succeeded: list[str] = []
        failed: list[str] = []
        assessments: dict[str, dict[int, str]] = {}
        settled = 0
        for symbol in SYMBOLS:
            try:
                async with async_session_factory() as session:
                    now = datetime.now(UTC)
                    repository = ShadowRepository(session)
                    instrument = await repository.instrument(symbol=symbol)
                    if instrument is None:
                        raise ValueError("Canonical Bybit instrument is unavailable")
                    reference = await repository.reference_instrument(instrument)
                    count = await repository.settle(reference.id, now) if reference else 0
                    snapshots = [
                        await assess_latest(repository, instrument, reference, horizon, now)
                        for horizon in HORIZONS
                    ]
                    await session.commit()
                for item in snapshots:
                    await redis.set(
                        snapshot_key(item.market_instrument_id, item.horizon_minutes),
                        item.model_dump_json(),
                        ex=90,
                    )
                settled += count
                succeeded.append(symbol)
                assessments[symbol] = {
                    item.horizon_minutes: item.assessment.reason for item in snapshots
                }
            except Exception as error:
                failed.append(symbol)
                await logger.aexception(
                    "event_shadow_symbol_failed", symbol=symbol, error_type=type(error).__name__
                )
        result: dict[str, object] = {
            "status": "degraded" if succeeded and failed else "failed" if failed else "healthy",
            "last_run": datetime.now(UTC).isoformat(),
            "succeeded": succeeded,
            "failed": failed,
            "settled": settled,
            "assessments": assessments,
        }
        await redis.set(STATUS_KEY, json.dumps(result), ex=180)
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


@app.task(name="alpha_radar.event_contracts.shadow", soft_time_limit=15, time_limit=20)  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
def shadow_task() -> dict[str, object]:
    return asyncio.run(sync_shadow())
