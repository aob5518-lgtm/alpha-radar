from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.models import Asset
from alpha_radar.errors import AppError
from alpha_radar.event_contracts.models import EventContractDecision
from alpha_radar.event_contracts.provider import PROVIDER
from alpha_radar.event_contracts.repository import ResearchRepository
from alpha_radar.event_contracts.schemas import Observation, ResearchResponse
from alpha_radar.event_contracts.strategy import (
    RULES,
    Assessment,
    Bar,
    Horizon,
    Reason,
    classify,
    utc,
)
from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.models import InstrumentType, MarketInstrument
from alpha_radar.market_data.seed import InstrumentSeed

INDEX_SEEDS = (
    InstrumentSeed(
        "bitcoin", PROVIDER, "BTCUSDT", "BTC", "USDT", "Binance Index", InstrumentType.INDEX
    ),
    InstrumentSeed(
        "ethereum", PROVIDER, "ETHUSDT", "ETH", "USDT", "Binance Index", InstrumentType.INDEX
    ),
)


async def seed_indices(session: AsyncSession) -> list[MarketInstrument]:
    repository = ResearchRepository(session)
    result: list[MarketInstrument] = []
    for seed in INDEX_SEEDS:
        instrument = await repository.market.get_instrument_by_provider_identity(
            seed.provider, seed.provider_instrument_id
        )
        if instrument is None:
            asset = await session.scalar(select(Asset).where(Asset.slug == seed.asset_slug))
            if asset is None:
                raise ValueError("Canonical assets must be seeded before index research")
            instrument = MarketInstrument(
                id=seed.id,
                asset_id=asset.id,
                provider=PROVIDER,
                provider_instrument_id=seed.provider_instrument_id,
                instrument_type=InstrumentType.INDEX,
                base_currency=seed.base_currency,
                quote_currency="USDT",
                venue="Binance Index",
                metadata_={
                    "purpose": "event_contract_research",
                    "settlement_basis_verified": False,
                },
            )
            session.add(instrument)
            await session.flush()
        result.append(instrument)
    await session.commit()
    return result


async def ingest_bars(
    repository: ResearchRepository, instrument: MarketInstrument, bars: list[Bar]
) -> int:
    if instrument.provider != PROVIDER or instrument.instrument_type != InstrumentType.INDEX:
        raise ValueError("Research candles require the canonical Binance index instrument")
    rows: list[dict[str, object]] = []
    for bar in bars:
        if not bar.is_closed:
            continue
        rows.append(
            {
                "provider": PROVIDER,
                "market_instrument_id": instrument.id,
                "asset_id": instrument.asset_id,
                "interval": MarketInterval.ONE_MINUTE,
                "open_time": bar.open_time,
                "close_time": bar.close_time,
                "open": bar.open,
                "high": bar.high,
                "low": bar.low,
                "close": bar.close,
                "volume": None,
                "quote_volume": None,
                "is_closed": True,
                "provider_timestamp": None,
                "ingested_at": datetime.now(UTC),
                "quality_flags": [],
                "metadata": {
                    "source": "https://fapi.binance.com/fapi/v1/indexPriceKlines",
                    "settlement_basis_verified": False,
                },
            }
        )
    await repository.market.upsert_candles(rows)
    await repository.session.commit()
    return len(rows)


def unavailable(horizon: Horizon, reason: Reason) -> Assessment:
    return Assessment(
        horizon_minutes=horizon,
        direction="unavailable",
        reasons=[reason],
        environment_interval="5m" if horizon == 10 else "15m",
        trigger_interval="1m" if horizon == 10 else "5m",
    )


async def publish(
    repository: ResearchRepository, instrument: MarketInstrument, horizon: Horizon, *, now: datetime
) -> Assessment:
    bars = await repository.history(instrument)
    # The next full minute is an explicit paper-entry assumption, not an exchange fill.
    entry = now.replace(second=0, microsecond=0) + timedelta(minutes=1)
    expires = entry + timedelta(minutes=horizon)
    macro, uncertain = await repository.macro_blocks(now, expires)
    assessment = classify(
        bars, horizon, as_of=now, macro_blocked=macro, macro_date_uncertain=uncertain
    )
    if assessment.confirmed_at is None:
        return assessment
    if assessment.direction in ("up", "down"):
        pending = await repository.pending(instrument.id)
        reason: Reason | None = None
        if any(row.horizon_minutes == horizon and utc(row.expires_at) >= now for row in pending):
            reason = "observation_in_progress"
        elif assessment.episode_key and await repository.episode_seen(
            instrument.id, horizon, assessment.episode_key
        ):
            reason = "episode_already_seen"
        if reason:
            assessment = assessment.model_copy(
                update={"direction": "wait", "reasons": [reason], "episode_key": None}
            )
    directional = assessment.direction in ("up", "down")
    confirmed_at = assessment.confirmed_at
    assert confirmed_at is not None
    row = EventContractDecision(
        id=uuid4(),
        asset_id=instrument.asset_id,
        market_instrument_id=instrument.id,
        horizon_minutes=horizon,
        version=assessment.version,
        confirmed_at=confirmed_at,
        generated_at=now,
        valid_until=min(
            now + timedelta(seconds=RULES.signal_ttl_seconds),
            confirmed_at + timedelta(seconds=RULES.freshness_seconds),
        ),
        direction=assessment.direction,
        assessment=assessment.model_dump(mode="json"),
        episode_key=assessment.episode_key if directional else None,
        entry_at=entry,
        expires_at=expires,
        outcome="pending" if directional else "not_applicable",
    )
    await repository.insert_decision(row)
    return assessment


async def observe(
    repository: ResearchRepository, instrument: MarketInstrument, *, now: datetime
) -> int:
    count = 0
    for row in await repository.pending(instrument.id):
        if utc(row.expires_at) + timedelta(minutes=1) > now:
            continue
        entry = await repository.candle_at(instrument.id, utc(row.entry_at))
        end = await repository.candle_at(instrument.id, utc(row.expires_at))
        if entry is not None and end is not None:
            row.entry_price = entry.open
            row.settlement_price = end.open
            row.outcome = (
                "up" if end.open > entry.open else "down" if end.open < entry.open else "tie"
            )
            row.observed_at = now
            count += 1
        elif now - utc(row.expires_at) > timedelta(hours=1):
            row.outcome = "missing"
            row.observed_at = now
            count += 1
    await repository.session.commit()
    return count


async def read_research(
    repository: ResearchRepository,
    asset_id: UUID,
    horizon: Horizon,
    *,
    enabled: bool,
    now: datetime,
) -> ResearchResponse:
    asset = await repository.asset(asset_id)
    if asset is None or asset.slug not in ("bitcoin", "ethereum"):
        raise AppError(
            code="unsupported_research_asset",
            message="BTC or ETH canonical UUID required",
            status_code=404,
        )
    seed = next(seed for seed in INDEX_SEEDS if seed.asset_slug == asset.slug)
    instrument = await repository.market.get_instrument_by_provider_identity(
        PROVIDER, seed.provider_instrument_id
    )
    assessment = unavailable(horizon, "disabled" if not enabled else "insufficient_history")
    availability = "disabled" if not enabled else "warming_up"
    updated: datetime | None = None
    valid: datetime | None = None
    observations: list[Observation] = []
    if enabled and instrument:
        latest = await repository.latest(instrument.id, horizon)
        if latest:
            assessment = Assessment.model_validate(latest.assessment)
            updated, valid = utc(latest.generated_at), utc(latest.valid_until)
            stale = now - utc(latest.confirmed_at) > timedelta(seconds=RULES.freshness_seconds)
            availability = (
                "stale"
                if stale
                else "unavailable"
                if assessment.direction == "unavailable"
                else "ready"
            )
            if stale or now > valid:
                assessment = assessment.model_copy(
                    update={
                        "direction": "unavailable" if stale else "wait",
                        "reasons": ["stale_data" if stale else "signal_expired"],
                    }
                )
        for row in await repository.recent(instrument.id, horizon):
            observations.append(
                Observation.model_validate(
                    {
                        "id": row.id,
                        "direction": row.direction,
                        "generated_at": utc(row.generated_at),
                        "entry_at": utc(row.entry_at),
                        "expires_at": utc(row.expires_at),
                        "entry_price": row.entry_price,
                        "settlement_price": row.settlement_price,
                        "outcome": row.outcome,
                        "matched_direction": row.direction == row.outcome
                        if row.outcome in ("up", "down")
                        else None,
                    }
                )
            )
    return ResearchResponse.model_validate(
        {
            "asset_id": asset.id,
            "symbol": asset.symbol,
            "market_instrument_id": instrument.id if instrument else None,
            "horizon_minutes": horizon,
            "availability": availability,
            "last_updated_at": updated,
            "valid_until": valid,
            "assessment": assessment,
            "observations": observations,
        }
    )
