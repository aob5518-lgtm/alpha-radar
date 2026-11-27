from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.seed import seed_assets
from alpha_radar.event_contracts.repository import ResearchRepository
from alpha_radar.event_contracts.service import ingest_bars, seed_indices
from alpha_radar.event_contracts.shadow_audit import replay
from alpha_radar.event_contracts.shadow_repository import ShadowRepository
from alpha_radar.event_contracts.shadow_rules import RULES, WINDOW, Direction
from alpha_radar.event_contracts.shadow_schemas import ShadowAssessment, ShadowResponse
from alpha_radar.event_contracts.shadow_strategy import (
    Candle,
    Series,
    assess,
    evaluate,
    proxy_result,
)
from alpha_radar.event_contracts.strategy import Bar, Horizon
from alpha_radar.market_data.seed import seed_market_instruments

AT = datetime(2026, 11, 1, 12, tzinfo=UTC)
INSTRUMENT = UUID("8f3ded59-0872-4847-9f22-383274d2cf4f")


def series(
    horizon: Horizon,
    *,
    mirrored: bool = False,
    continuing: bool = False,
    rejection: bool = True,
    climax: bool = True,
    strong: bool = False,
) -> tuple[Series, Series]:
    rule = RULES[horizon]

    def make(values: list[float], minutes: int, span: float) -> list[Candle]:
        start = AT - timedelta(minutes=len(values) * minutes)
        return [
            Candle(
                start + timedelta(minutes=index * minutes),
                start + timedelta(minutes=(index + 1) * minutes),
                price,
                price + span,
                price - span,
                price,
                100,
            )
            for index, price in enumerate(values)
        ]

    values = [100 + (i % 3 - 1) * 0.3 for i in range(WINDOW - 5)]
    values.extend([100.5, 101.1, 101.85, 103.05, 104.4 if continuing else 101.0])
    triggers = make(values, rule.trigger_minutes, 0.25)
    triggers[-2] = replace(triggers[-2], volume=300 if climax else 100)
    if rejection and not continuing:
        triggers[-1] = replace(triggers[-1], opening=103.05, high=105.5, low=100.7, volume=90)
    if strong:
        contexts = make([61 + i * 0.55 for i in range(WINDOW)], rule.context_minutes, 0.5)
    else:
        contexts = make(
            [104.75 + (i % 3 - 1) * 0.15 for i in range(WINDOW)], rule.context_minutes, 0.8
        )
    if mirrored:

        def flip(candle: Candle) -> Candle:
            return replace(
                candle,
                opening=300 - candle.opening,
                close=300 - candle.close,
                high=300 - candle.low,
                low=300 - candle.high,
            )

        triggers = [flip(bar) for bar in triggers]
        contexts = [flip(bar) for bar in contexts]
    return Series(INSTRUMENT, rule.trigger, triggers), Series(INSTRUMENT, rule.context, contexts)


@pytest.mark.parametrize("horizon", [10, 30])
@pytest.mark.parametrize("mirrored", [False, True])
def test_exhaustion_rejection_and_context_are_symmetric(horizon: Horizon, mirrored: bool) -> None:
    trigger, context = series(horizon, mirrored=mirrored)
    actual = evaluate(trigger, context, horizon, instrument_id=INSTRUMENT, now=AT)
    assert actual.state == ("STRONG_HIGHER" if mirrored else "STRONG_LOWER")
    assert actual.score is not None and 85 <= actual.score <= 100
    assert sum(actual.points.values()) == actual.score
    assert actual.episode_at
    no_rejection, _ = series(horizon, mirrored=mirrored, rejection=False)
    assert (
        evaluate(no_rejection, context, horizon, instrument_id=INSTRUMENT, now=AT).state == "WAIT"
    )
    raw_extreme, _ = series(horizon, mirrored=mirrored, continuing=True)
    assert evaluate(raw_extreme, context, horizon, instrument_id=INSTRUMENT, now=AT).state == "WAIT"
    _, strong_context = series(horizon, mirrored=mirrored, strong=True)
    conflict = evaluate(raw_extreme, strong_context, horizon, instrument_id=INSTRUMENT, now=AT)
    assert conflict.state == "WAIT" and conflict.reason == "trend_conflict"


@pytest.mark.parametrize("horizon", [10, 30])
def test_gates_and_causal_replay(horizon: Horizon) -> None:
    trigger, context = series(horizon)
    base = evaluate(trigger, context, horizon, instrument_id=INSTRUMENT, now=AT)
    future = replace(trigger.candles[-1], opened=AT, closed=AT + timedelta(minutes=5), high=1e8)
    partial = replace(trigger.candles[-1], confirmed=False, high=1e9)
    future_htf = replace(
        context.candles[-1], opened=AT, closed=AT + timedelta(minutes=15), low=0.01
    )
    altered = replace(trigger, candles=[*trigger.candles, partial, future])
    altered_context = replace(context, candles=[*context.candles, future_htf])
    assert evaluate(altered, altered_context, horizon, instrument_id=INSTRUMENT, now=AT) == base
    assert evaluate(trigger, context, horizon, instrument_id=INSTRUMENT, now=AT) == base
    assert (
        evaluate(trigger, context, horizon, instrument_id=uuid4(), now=AT).reason
        == "identity_mismatch"
    )
    assert (
        evaluate(
            trigger, context, horizon, instrument_id=INSTRUMENT, now=AT + timedelta(seconds=91)
        ).reason
        == "stale_data"
    )
    assert (
        evaluate(
            trigger, context, horizon, instrument_id=INSTRUMENT, now=AT, macro_blocked=True
        ).reason
        == "macro_event"
    )
    assert (
        evaluate(
            trigger, context, horizon, instrument_id=INSTRUMENT, now=AT, reference_available=False
        ).reason
        == "reference_unavailable"
    )
    gap = replace(
        trigger, candles=[*trigger.candles[:-2], trigger.candles[-3], trigger.candles[-1]]
    )
    assert evaluate(gap, context, horizon, instrument_id=INSTRUMENT, now=AT).reason == "history_gap"
    assert (
        evaluate(
            replace(trigger, candles=[*trigger.candles[:-1], partial]),
            context,
            horizon,
            instrument_id=INSTRUMENT,
            now=AT,
        ).state
        == "WAIT"
    )


@pytest.mark.parametrize(
    "direction,ending,expected",
    [
        ("higher", "101", "win"),
        ("higher", "99", "loss"),
        ("higher", "100", "loss"),
        ("lower", "99", "win"),
        ("lower", "101", "loss"),
        ("lower", "100", "loss"),
    ],
)
def test_proxy_settlement(direction: Direction, ending: str, expected: str) -> None:
    assert proxy_result(direction, Decimal(100), Decimal(ending)) == expected


def test_rejection_without_exhaustion_cannot_be_strong() -> None:
    trigger, context = series(10)
    bars = [
        *trigger.candles[:-1],
        replace(trigger.candles[-1], close=100.05, low=99.8, volume=300),
    ]
    observed_rsi = [50.0] * (WINDOW - 2) + [76.0, 75.0]
    signal = assess(bars, context.candles, observed_rsi, WINDOW - 2, 1, RULES[10])
    assert signal.state == "LOWER"
    assert signal.points["exhaustion"] == 0


def test_replay_reads_future_settlement_only_for_outcome() -> None:
    trigger, context = series(10)
    expiry = AT + timedelta(minutes=10)
    won = replay(
        "BTCUSDT",
        INSTRUMENT,
        10,
        trigger.candles,
        context.candles,
        {AT: Decimal(100), expiry: Decimal(99)},
        [],
        AT - timedelta(minutes=1),
        expiry,
    )
    lost = replay(
        "BTCUSDT",
        INSTRUMENT,
        10,
        trigger.candles,
        context.candles,
        {AT: Decimal(100), expiry: Decimal(101)},
        [],
        AT - timedelta(minutes=1),
        expiry,
    )
    expected = cast(list[dict[str, object]], won["observations"])
    actual = cast(list[dict[str, object]], lost["observations"])
    assert len(expected) == len(actual) == 1
    assert expected[0]["assessment"] == actual[0]["assessment"]
    assert expected[0]["result"] == "win" and actual[0]["result"] == "loss"


async def check_frozen_storage(session: AsyncSession) -> None:
    repository = ShadowRepository(session)
    instrument = await repository.instrument(symbol="BTCUSDT")
    assert instrument
    reference = await repository.reference_instrument(instrument)
    assert reference and reference.id != instrument.id
    trigger, context = series(10)
    assessment = ShadowAssessment.model_validate(
        evaluate(
            replace(trigger, instrument_id=instrument.id),
            replace(context, instrument_id=instrument.id),
            10,
            instrument_id=instrument.id,
            now=AT,
        )
    )
    row = await repository.record(
        instrument=instrument,
        reference=reference,
        horizon=10,
        assessment=assessment,
        strike=Decimal(100),
        now=AT,
    )
    assert row and row.expires_at.replace(tzinfo=UTC) == AT + timedelta(minutes=10)
    assert assessment.episode_at is not None
    snapshot = dict(row.assessment)
    repeated = await repository.record(
        instrument=instrument,
        reference=reference,
        horizon=10,
        assessment=assessment.model_copy(update={"score": 75}),
        strike=Decimal(500),
        now=AT + timedelta(seconds=10),
    )
    assert repeated and repeated.id == row.id and repeated.reference_price == Decimal(100)
    later = AT + timedelta(minutes=1)
    same_episode = assessment.model_copy(update={"as_of": later})
    assert (
        await repository.record(
            instrument=instrument,
            reference=reference,
            horizon=10,
            assessment=same_episode,
            strike=Decimal(100),
            now=later,
        )
        is None
    )
    independent = await repository.record(
        instrument=instrument,
        reference=reference,
        horizon=10,
        assessment=same_episode.model_copy(update={"episode_at": later}),
        strike=Decimal(100),
        now=later,
    )
    assert independent and independent.id != row.id
    expiry = AT + timedelta(minutes=10)
    await ingest_bars(
        ResearchRepository(session),
        reference,
        [
            Bar(
                open_time=expiry - timedelta(minutes=1),
                close_time=expiry,
                open=Decimal(100),
                high=Decimal(100),
                low=Decimal(98),
                close=Decimal(99),
            ),
        ],
    )
    assert await repository.settle(reference.id, expiry - timedelta(seconds=1)) == 0
    assert await repository.settle(reference.id, expiry) == 1
    assert row.result == "win" and row.settled_price == Decimal(99)
    assert row.assessment == snapshot and row.reference_price == Decimal(100)
    assert (await repository.settle(reference.id, expiry)) == 0
    response = ShadowResponse(
        asset_id=instrument.asset_id,
        market_instrument_id=instrument.id,
        symbol="BTC",
        horizon_minutes=10,
        assessment=assessment,
    )
    assert response.probability is None and response.expected_value is None
    assert response.settlement_basis_verified is False


@pytest.mark.asyncio
async def test_postgres_compatible_frozen_identity_and_settlement(session: AsyncSession) -> None:
    await seed_assets(session)
    await seed_market_instruments(session)
    await seed_indices(session)
    await check_frozen_storage(session)
