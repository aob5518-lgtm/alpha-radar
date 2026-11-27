"""Causal replay and stored shadow analytics using the frozen Event Signal V1 rules."""

import argparse
import asyncio
import csv
import gzip
import hashlib
import json
from collections import Counter
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import partial
from pathlib import Path
from uuid import UUID

from sqlalchemy import select

from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.event_contracts.shadow_analytics import Observation, grouped, summarize
from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_repository import (
    ShadowRepository,
    macro_bounds,
    major_macro_query,
)
from alpha_radar.event_contracts.shadow_rules import (
    HORIZONS,
    MACRO_WINDOW,
    PROXY,
    RSI_HIGH,
    RSI_LOW,
    RULES,
    SETTLEMENT_VERSION,
    SYMBOLS,
    VERSION,
    WINDOW,
    Direction,
    Regime,
)
from alpha_radar.event_contracts.shadow_schemas import ShadowAssessment, ShadowObservation
from alpha_radar.event_contracts.shadow_strategy import (
    Candle,
    Series,
    evaluate,
    proxy_result,
    rsi_series,
)
from alpha_radar.event_contracts.strategy import Horizon, utc
from alpha_radar.events.models import Event
from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.models import MarketCandle


def load_bars(path: Path) -> tuple[list[Candle], str]:
    digest = hashlib.sha256()
    with gzip.open(path, "rt", newline="") as data:
        rows: list[Candle] = []
        for raw in data:
            digest.update(raw.encode())
            opened, closed, opening, high, low, close, volume = next(csv.reader([raw]))
            rows.append(
                Candle(
                    datetime.fromisoformat(opened),
                    datetime.fromisoformat(closed),
                    float(opening),
                    float(high),
                    float(low),
                    float(close),
                    float(volume) if volume else None,
                )
            )
    rows.sort(key=lambda bar: bar.opened)
    if len({bar.opened for bar in rows}) != len(rows):
        raise ValueError(f"Duplicate historical candle in {path.name}")
    return rows, digest.hexdigest()


def continuity(
    bars: list[Candle],
    minutes: int,
    start: datetime,
    end: datetime,
) -> dict[str, int | str | None]:
    step = timedelta(minutes=minutes)
    eligible = [bar for bar in bars if start < bar.closed <= end]
    expected = int((end - start) // step)
    return {
        "bars": len(eligible),
        "first_close": eligible[0].closed.isoformat() if eligible else None,
        "last_close": eligible[-1].closed.isoformat() if eligible else None,
        "missing_bars": expected - len(eligible),
        "internal_gaps": sum(
            right.opened != left.closed for left, right in zip(eligible, eligible[1:], strict=False)
        ),
        "missing_volume": sum(bar.volume is None for bar in eligible),
    }


def observe(
    symbol: str,
    horizon: Horizon,
    at: datetime,
    strike: Decimal,
    ending: Decimal | None,
    direction: Direction,
    score: int | None = None,
    regime: Regime | None = None,
) -> Observation:
    return Observation(
        symbol,
        horizon,
        at,
        direction,
        proxy_result(direction, strike, ending) if ending is not None else "missing",
        score,
        regime,
        ending == strike,
    )


def replay(
    symbol: str,
    instrument_id: UUID,
    horizon: Horizon,
    bars: list[Candle],
    context: list[Candle],
    index: dict[datetime, Decimal],
    macro: list[tuple[datetime, datetime, datetime]],
    start: datetime,
    end: datetime,
) -> dict[str, object]:
    rules = RULES[horizon]
    higher = 0
    reasons: Counter[str] = Counter()
    states: Counter[str] = Counter()
    episodes: set[tuple[Direction, datetime]] = set()
    previous_rsi: Direction | None = None
    observations: list[Observation] = []
    baseline: list[Observation] = []
    same_timestamps: list[Observation] = []
    records: list[dict[str, object]] = []
    for i, candidate in enumerate(bars):
        at = candidate.closed
        if not start < at <= end - timedelta(minutes=horizon):
            continue
        while higher < len(context) and context[higher].closed <= at:
            higher += 1
        trigger = bars[max(0, i - WINDOW + 1) : i + 1]
        environment = context[max(0, higher - WINDOW) : higher]
        strike = index.get(at)
        excluded = any(
            known <= at and first - MACRO_WINDOW <= at <= last + MACRO_WINDOW
            for first, last, known in macro
        )
        result = evaluate(
            Series(instrument_id, rules.trigger, trigger),
            Series(instrument_id, rules.context, environment),
            horizon,
            instrument_id=instrument_id,
            now=at,
            macro_blocked=excluded,
            reference_available=strike is not None,
        )
        if result.reason in (
            "insufficient_history",
            "history_gap",
            "stale_data",
            "macro_event",
            "reference_unavailable",
            "identity_mismatch",
            "volume_unavailable",
        ):
            previous_rsi = None
            reasons[result.reason] += 1
            states["WAIT"] += 1
            continue
        assert strike is not None
        expiry = at + timedelta(minutes=horizon)
        ending = index.get(expiry)
        rsi = rsi_series(trigger)[-1]
        naive: Direction | None = (
            "lower" if rsi >= RSI_HIGH else "higher" if rsi <= RSI_LOW else None
        )

        sample = partial(observe, symbol, horizon, at, strike, ending)
        if naive is not None and naive != previous_rsi:
            baseline.append(sample(naive))
        previous_rsi = naive
        if result.state != "WAIT" and result.direction and result.episode_at:
            setup = (result.direction, result.episode_at)
            if setup in episodes:
                reasons["episode_already_seen"] += 1
                states["WAIT"] += 1
                continue
            episodes.add(setup)
            observed = sample(result.direction, result.score, result.regime)
            observations.append(observed)
            if naive is not None:
                same_timestamps.append(sample(naive))
            records.append(
                {
                    "at": at.isoformat(),
                    "expiry": expiry.isoformat(),
                    "reference_price": str(strike),
                    "settled_price": str(ending) if ending is not None else None,
                    "result": observed.result,
                    "assessment": ShadowAssessment.model_validate(result).model_dump(mode="json"),
                }
            )
        reasons[result.reason] += 1
        states[result.state] += 1
    return {
        "symbol": symbol,
        "market_instrument_id": str(instrument_id),
        "horizon": horizon,
        "state_counts": dict(states),
        "reason_counts": dict(reasons),
        "strategy": grouped(observations),
        "rsi_only": summarize(baseline),
        "rsi_on_same_timestamps_when_extreme": summarize(same_timestamps),
        "observations": records,
    }


async def audit(directory: Path, end: datetime, days: int) -> dict[str, object]:
    start = end - timedelta(days=days)
    reports: list[dict[str, object]] = []
    datasets: dict[str, object] = {}
    async with async_session_factory() as session:
        repository = ShadowRepository(session)
        events = (
            await session.scalars(
                major_macro_query().where(
                    Event.updated_at <= end,
                )
            )
        ).all()
        macro: list[tuple[datetime, datetime, datetime]] = []
        for event in events:
            known = max(utc(event.detected_at), utc(event.updated_at), utc(event.created_at))
            bounds = macro_bounds(event, known)
            if (
                bounds
                and known <= end
                and bounds[0] <= end + MACRO_WINDOW
                and bounds[1] >= start - MACRO_WINDOW
            ):
                macro.append((*bounds, known))
        for symbol in SYMBOLS:
            instrument = await repository.instrument(symbol=symbol)
            reference = await repository.reference_instrument(instrument) if instrument else None
            if instrument is None or reference is None:
                raise RuntimeError(f"Missing canonical instruments for {symbol}")
            snapshot = await session.stream(
                select(MarketCandle.close_time, MarketCandle.close)
                .where(
                    MarketCandle.provider == "binance_index",
                    MarketCandle.market_instrument_id == reference.id,
                    MarketCandle.interval == MarketInterval.ONE_MINUTE,
                    MarketCandle.is_closed.is_(True),
                    MarketCandle.open_time >= start - timedelta(minutes=1),
                    MarketCandle.open_time < end,
                    MarketCandle.close_time <= end,
                )
                .order_by(MarketCandle.open_time)
                .execution_options(yield_per=5000)
            )
            index: dict[datetime, Decimal] = {}
            digest = hashlib.sha256()
            async for at, price in snapshot.tuples():
                at = utc(at)
                index[at] = price
                digest.update(f"{at.isoformat()},{price}\n".encode())
            histories: dict[MarketInterval, list[Candle]] = {}
            sources: dict[str, object] = {}
            for interval, minutes in (
                (MarketInterval.ONE_MINUTE, 1),
                (MarketInterval.FIVE_MINUTES, 5),
                (MarketInterval.FIFTEEN_MINUTES, 15),
            ):
                rows, checksum = load_bars(directory / f"{symbol}-{interval.value}.csv.gz")
                histories[interval] = rows
                sources[interval.value] = {
                    **continuity(rows, minutes, start, end),
                    "sha256": checksum,
                }
            sources["binance_index"] = {
                "bars": len(index),
                "missing_minutes": days * 1440 + 1 - len(index),
                "sha256": digest.hexdigest(),
            }
            datasets[symbol] = sources
            for horizon in HORIZONS:
                rule = RULES[horizon]
                print(f"Replaying {symbol} {horizon}m", flush=True)
                reports.append(
                    replay(
                        symbol,
                        instrument.id,
                        horizon,
                        histories[rule.trigger],
                        histories[rule.context],
                        index,
                        macro,
                        start,
                        end,
                    )
                )
    return {
        "version": VERSION,
        "settlement_version": SETTLEMENT_VERSION,
        "reference_source": PROXY,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days": days,
        "macro_eligible_records": len(macro),
        "datasets": datasets,
        "reports": reports,
    }


async def live(days: int) -> dict[str, object]:
    async with async_session_factory() as session:
        rows = (
            await session.scalars(
                select(EventShadowSignal).where(
                    EventShadowSignal.version == VERSION,
                    EventShadowSignal.settlement_version == SETTLEMENT_VERSION,
                    EventShadowSignal.generated_at >= datetime.now(UTC) - timedelta(days=days),
                )
            )
        ).all()
        observations: list[Observation] = []
        for row in rows:
            entry = ShadowObservation.model_validate(row)
            assessment = ShadowAssessment.model_validate(row.assessment)
            horizon: Horizon = 10 if row.horizon_minutes == 10 else 30
            observations.append(
                Observation(
                    row.symbol,
                    horizon,
                    utc(row.generated_at),
                    entry.direction,
                    entry.result,
                    row.score,
                    assessment.regime,
                    entry.settled_price == entry.reference_price,
                )
            )
    return {"days": days, "version": VERSION, "reference_source": PROXY, **grouped(observations)}


async def run(args: argparse.Namespace) -> None:
    try:
        if args.command == "live":
            result = await live(args.days)
        else:
            result = await audit(args.directory, args.end.astimezone(UTC), args.days)
        payload = json.dumps(result, indent=2) + "\n"
        if args.output:
            args.output.write_text(payload)
        else:
            print(payload)
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("replay", "live"))
    parser.add_argument("--end", type=datetime.fromisoformat)
    parser.add_argument("--directory", type=Path)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 1 <= args.days <= 90:
        parser.error("Choose 1–90 days")
    if args.command == "replay" and (
        args.directory is None or args.end is None or args.end.tzinfo is None
    ):
        parser.error("Replay requires --directory and an aware --end")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
