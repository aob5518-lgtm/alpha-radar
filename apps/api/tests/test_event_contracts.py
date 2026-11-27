from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.seed import seed_assets
from alpha_radar.config import Settings
from alpha_radar.db.session import get_db_session
from alpha_radar.event_contracts.audit import replay
from alpha_radar.event_contracts.models import EventContractDecision
from alpha_radar.event_contracts.provider import BinanceIndexProvider
from alpha_radar.event_contracts.repository import ResearchRepository
from alpha_radar.event_contracts.service import (
    ingest_bars,
    observe,
    publish,
    read_research,
    seed_indices,
)
from alpha_radar.event_contracts.strategy import (
    Bar,
    Horizon,
    aggregate,
    break_even_probability,
    classify,
    utc,
)
from alpha_radar.events.models import Event
from alpha_radar.main import create_app
from alpha_radar.market_data.seed import seed_market_instruments


def history(*, reverse: bool = False, extra: int = 0, horizon: Horizon = 10) -> list[Bar]:
    start = datetime(2026, 11, 1, tzinfo=UTC)
    bars: list[Bar] = []
    for index in range(1200 + extra):
        close = Decimal(100) + Decimal(index) * Decimal(".02")
        bars.append(
            Bar(
                open_time=start + timedelta(minutes=index),
                close_time=start + timedelta(minutes=index + 1),
                open=close - Decimal(".01"),
                high=close + Decimal(".1"),
                low=close - Decimal(".1"),
                close=close,
            )
        )
    for index, values in (
        (1198, ("123.8", "123.84", "123.70", "123.78")),
        (1199, ("123.78", "123.96", "123.76", "123.94")),
    ):
        bars[index] = bars[index].model_copy(
            update=dict(zip(("open", "high", "low", "close"), map(Decimal, values), strict=True))
        )
    if horizon == 30:
        for index in range(1190, 1195):
            bars[index] = bars[index].model_copy(
                update={
                    "open": Decimal("122.90"),
                    "high": Decimal("123.05"),
                    "low": Decimal("122.80"),
                    "close": Decimal("122.90"),
                }
            )
        for index in range(1195, 1200):
            close = Decimal("123.02") + Decimal(index - 1195) * Decimal(".03")
            bars[index] = bars[index].model_copy(
                update={
                    "open": Decimal("122.90"),
                    "high": close + Decimal(".02"),
                    "low": Decimal("122.84"),
                    "close": close,
                }
            )
    if reverse:
        bars = [
            bar.model_copy(
                update={
                    "open": 300 - bar.open,
                    "close": 300 - bar.close,
                    "high": 300 - bar.low,
                    "low": 300 - bar.high,
                }
            )
            for bar in bars
        ]
    return bars


@pytest.mark.parametrize("reverse,direction", [(False, "up"), (True, "down")])
@pytest.mark.parametrize("horizon", [10, 30])
def test_trend_pullback_produces_symmetric_deterministic_candidate(
    reverse: bool,
    direction: str,
    horizon: Horizon,
) -> None:
    bars = history(reverse=reverse, horizon=horizon)
    actual = classify(bars, horizon, as_of=bars[-1].close_time)
    assert actual.direction == direction
    assert actual.reasons == ["trend_pullback_confirmed"]
    assert actual.input_sha256 and actual.episode_key
    assert actual == classify(bars, horizon, as_of=bars[-1].close_time)


@pytest.mark.parametrize("horizon", [10, 30])
def test_partial_future_and_prepared_replay_do_not_change_confirmed_assessment(
    horizon: Horizon,
) -> None:
    bars = history(extra=40)
    at = bars[1199].close_time
    expected = classify(bars[:1200], horizon, as_of=at)
    partial = bars[1200].model_copy(update={"is_closed": False, "high": Decimal("100000")})
    assert classify(bars + [partial], horizon, as_of=at) == expected
    assert (
        classify(
            bars,
            horizon,
            as_of=at,
            prepared=(
                aggregate(bars, 1 if horizon == 10 else 5),
                aggregate(bars, 5 if horizon == 10 else 15),
            ),
        )
        == expected
    )


def test_wait_filters_missing_stale_gap_macro_noise_and_uncertain_date() -> None:
    bars = history()
    at = bars[-1].close_time
    assert classify([], 10, as_of=at).direction == "unavailable"
    assert classify(bars, 10, as_of=at + timedelta(seconds=91)).reasons == ["stale_data"]
    assert classify(bars[:500] + bars[501:], 10, as_of=at).reasons == ["history_gap"]
    assert classify(bars, 10, as_of=at, macro_blocked=True).reasons == ["macro_event"]
    assert classify(bars, 10, as_of=at, macro_date_uncertain=True).reasons == [
        "macro_date_uncertain"
    ]
    quiet = [
        bar.model_copy(
            update={
                "open": Decimal(100),
                "high": Decimal(101),
                "low": Decimal(99),
                "close": Decimal(100),
            }
        )
        for bar in bars
    ]
    assert classify(quiet, 10, as_of=at).reasons == ["mixed_trend"]


def test_complete_utc_aggregation_rejects_missing_duplicate_or_incomplete_minutes() -> None:
    bars = history()
    assert len(aggregate(bars, 5)) == 240
    assert len(aggregate(bars, 15)) == 80
    assert len(aggregate(bars[:-1], 5)) == 239
    assert len(aggregate(bars[:2] + bars[3:], 5)) == 239
    assert len(aggregate([*bars[:3], bars[2], *bars[3:]], 5)) == 239


@pytest.mark.parametrize(
    "payout", [Decimal("0"), Decimal("-1"), Decimal("NaN"), Decimal("Infinity")]
)
def test_invalid_payout_is_rejected(payout: Decimal) -> None:
    with pytest.raises(ValueError):
        break_even_probability(payout)


def test_payout_is_net_profit_not_total_return() -> None:
    assert abs(
        break_even_probability(Decimal(".8")) - Decimal(".5555555555555555555555555556")
    ) < Decimal("1e-25")


async def test_index_adapter_uses_official_index_endpoint_and_excludes_open_candle() -> None:
    at = datetime(2026, 11, 1, 0, 1, tzinfo=UTC)
    ms = int((at - timedelta(minutes=1)).timestamp() * 1000)

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "fapi.binance.com"
        assert request.url.path == "/fapi/v1/indexPriceKlines"
        assert request.url.params["pair"] == "BTCUSDT"
        return httpx.Response(
            200,
            json=[
                [ms, "100.1", "102", "99", "101", "0", ms + 59999],
                [ms + 60000, "101", "102", "100", "102", "0", ms + 119999],
            ],
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
        actual = await BinanceIndexProvider(client).fetch("BTCUSDT", end=at)
    assert len(actual) == 1
    assert actual[0].close_time == at
    assert actual[0].open == Decimal("100.1")


@pytest.mark.parametrize(
    "row",
    [
        [1],
        [0, "100", "99", "98", "101", 0, 59999],
        [0, "100", "102", "98", "101", 0, 60000],
    ],
)
async def test_malformed_provider_data_is_rejected(row: list[str | int]) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=[row]))
    ) as client:
        with pytest.raises((ValueError, ValidationError)):
            await BinanceIndexProvider(client).fetch("BTCUSDT", end=datetime.now(UTC))


async def test_signal_is_immutable_idempotent_identity_bound_and_observation_is_not_a_fill(
    session: AsyncSession,
) -> None:
    await seed_assets(session)
    instruments = await seed_indices(session)
    assert [item.id for item in await seed_indices(session)] == [item.id for item in instruments]
    instrument = instruments[0]
    repository = ResearchRepository(session)
    bars = history()
    at = bars[-1].close_time + timedelta(seconds=7)
    await ingest_bars(repository, instrument, bars)
    first = await publish(repository, instrument, 10, now=at)
    assert first.direction == "up"
    await publish(repository, instrument, 10, now=at + timedelta(seconds=1))
    assert await session.scalar(select(func.count()).select_from(EventContractDecision)) == 1
    row = await repository.latest(instrument.id, 10)
    assert row is not None
    original = row.assessment.copy()
    assert utc(row.entry_at) > at
    assert row.entry_price is None
    assert utc(row.expires_at) - utc(row.entry_at) == timedelta(minutes=10)
    # Future observation is append-only and never changes the recorded signal evidence.
    extended = history(extra=30)
    await ingest_bars(repository, instrument, extended[1200:])
    assert await observe(repository, instrument, now=at + timedelta(minutes=20)) == 1
    assert row.outcome == "up" and row.entry_price is not None
    assert row.assessment == original
    assert await observe(repository, instrument, now=at + timedelta(minutes=21)) == 0
    result = await read_research(repository, instrument.asset_id, 10, enabled=True, now=at)
    assert result.probability is None and result.expected_value is None
    assert result.settlement_basis_verified is False
    assert result.observations[0].matched_direction is True
    assert (
        await read_research(repository, instruments[1].asset_id, 10, enabled=True, now=at)
    ).observations == []
    stale = await read_research(
        repository, instrument.asset_id, 10, enabled=True, now=at + timedelta(minutes=2)
    )
    assert stale.availability == "stale" and stale.assessment.direction == "unavailable"


async def test_research_api_disabled_validation_and_unavailable_are_honest(
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await seed_assets(session)
    instrument = (await seed_indices(session))[0]
    app = create_app()

    async def override() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_db_session] = override
    monkeypatch.setattr(
        "alpha_radar.api.v1.event_contracts.get_settings",
        lambda: Settings(event_contracts_enabled=False),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        for horizon in (10, 30):
            response = await client.get(
                f"/api/v1/event-contracts/{instrument.asset_id}?horizon={horizon}"
            )
            assert response.status_code == 200
            assert response.json()["availability"] == "disabled"
            assert response.json()["probability"] is None
        assert (
            await client.get(f"/api/v1/event-contracts/{instrument.asset_id}?horizon=15")
        ).status_code == 422
        assert (await client.get("/api/v1/event-contracts/BTC")).status_code == 422


async def test_macro_gate_does_not_change_events_and_research_does_not_replace_chart_instruments(
    session: AsyncSession,
) -> None:
    await seed_assets(session)
    await seed_market_instruments(session)
    repository = ResearchRepository(session)
    instrument = (await seed_indices(session))[0]
    at = history()[-1].close_time
    session.add(
        Event(
            external_key="ec-test-cpi",
            title="CPI",
            event_type="cpi",
            category="macro",
            status="scheduled",
            scheduled_at=at + timedelta(minutes=3),
            detected_at=at,
            importance="high",
            summary="Official CPI",
            why_it_matters="Inflation",
            impact_analysis={},
            watch_next=[],
        )
    )
    await session.commit()
    await ingest_bars(repository, instrument, history())
    assert (await publish(repository, instrument, 10, now=at)).reasons == ["macro_event"]
    preferred = await repository.market.get_preferred_instrument(instrument.asset_id)
    assert preferred is not None and preferred.provider != "binance_index"
    assert len(await repository.market.list_active_instruments("bybit")) == 12


async def test_missing_proxy_candle_never_becomes_fabricated_settlement(
    session: AsyncSession,
) -> None:
    await seed_assets(session)
    instrument = (await seed_indices(session))[0]
    repository = ResearchRepository(session)
    bars = history()
    at = bars[-1].close_time
    await ingest_bars(repository, instrument, bars)
    await publish(repository, instrument, 10, now=at)
    await observe(repository, instrument, now=at + timedelta(hours=2))
    row = await repository.latest(instrument.id, 10)
    assert row is not None and row.outcome == "missing"
    assert row.entry_price is None and row.settlement_price is None


@pytest.mark.parametrize("failed_symbol", ["BTCUSDT", "ETHUSDT"])
async def test_asset_fetch_failures_are_isolated(
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    failed_symbol: str,
) -> None:
    from alpha_radar.event_contracts import tasks

    await seed_assets(session)
    monkeypatch.setattr(tasks, "async_session_factory", lambda: session)
    bars = history()
    provider = AsyncMock()

    async def fetch(symbol: str, *, end: datetime, limit: int = 1000) -> list[Bar]:
        del end, limit
        if symbol == failed_symbol:
            raise TimeoutError("provider timeout")
        return bars

    provider.fetch.side_effect = fetch
    result = await tasks.sync(provider, now=bars[-1].close_time)
    assert result["status"] == "degraded"
    assert result["failed"] == [failed_symbol]
    assert len(result["succeeded"]) == 1  # type: ignore[arg-type]
    assert await session.scalar(select(func.count()).select_from(EventContractDecision)) == 2


def test_historical_replay_is_purged_separate_and_never_claims_live_win_probability() -> None:
    bars = history(extra=1400)
    first = replay(bars, 10, macro_windows=[])
    assert first == replay(bars, 10, macro_windows=[])
    assert first["validation_status"] == "unvalidated"
    assert first["settlement_basis_verified"] is False
    assert first["payout_assumption"] is None
    assert first["entry_delay_seconds"] == 60
    assert set(first["chronological_cohorts"]) == {"development", "validation", "holdout"}
    assert "signals" in first
