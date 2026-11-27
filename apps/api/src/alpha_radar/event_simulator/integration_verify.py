"""Exercise the real PostgreSQL ledger with fixtures on the disposable Compose stack."""

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_repository import ShadowRepository
from alpha_radar.event_contracts.shadow_rules import RULES, Direction, State
from alpha_radar.event_contracts.shadow_schemas import ShadowAssessment
from alpha_radar.event_contracts.strategy import Horizon
from alpha_radar.event_simulator.models import SimulationBet, SimulationSession
from alpha_radar.event_simulator.repository import SimulatorRepository
from alpha_radar.event_simulator.rules import SimulationStats
from alpha_radar.event_simulator.schemas import Market, SimulationSettings
from alpha_radar.event_simulator.service import control_run, new_run, process_tick
from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.models import MarketCandle, MarketInstrument

AT = datetime(2026, 11, 14, 13, 30, tzinfo=UTC)


def candle(
    instrument: MarketInstrument,
    interval: MarketInterval,
    open_at: datetime,
    close_at: datetime,
    price: Decimal,
    *,
    closed: bool,
) -> MarketCandle:
    return MarketCandle(
        provider=instrument.provider,
        asset_id=instrument.asset_id,
        market_instrument_id=instrument.id,
        interval=interval,
        open_time=open_at,
        close_time=close_at,
        is_closed=closed,
        open=price,
        high=price,
        low=price,
        close=price,
        volume=Decimal(1),
    )


async def freeze(
    db: AsyncSession,
    symbol: Market,
    horizon: Horizon,
    direction: Direction,
    at: datetime,
    *,
    closed: bool = True,
    strong: bool = True,
) -> EventShadowSignal:
    repo = ShadowRepository(db)
    bybit = await repo.instrument(symbol=symbol)
    assert bybit is not None
    reference = await repo.reference_instrument(bybit)
    assert reference is not None
    trigger = RULES[horizon]
    db.add(
        candle(
            bybit,
            trigger.trigger,
            at - timedelta(minutes=trigger.trigger_minutes),
            at,
            Decimal(100),
            closed=closed,
        )
    )
    state: State
    if direction == "higher":
        state = "STRONG_HIGHER" if strong else "HIGHER"
    else:
        state = "STRONG_LOWER" if strong else "LOWER"
    row = await repo.record(
        instrument=bybit,
        reference=reference,
        horizon=horizon,
        strike=Decimal(100),
        now=at,
        assessment=ShadowAssessment(
            state=state,
            direction=direction,
            score=89 if strong else 81,
            as_of=at,
            episode_at=at - timedelta(minutes=5),
            reason="signal_recorded",
        ),
    )
    assert row is not None
    return row


async def tick(at: datetime) -> dict[str, int]:
    async with async_session_factory() as db:
        return await process_tick(db, at=at)


async def verify() -> None:
    settings = get_settings()
    if settings.app_env == "production" or settings.market_data_provider != "mock":
        raise RuntimeError("Fixtures may only run on the disposable mock-provider stack")
    try:
        async with async_session_factory() as db:
            assert await SimulatorRepository(db).current() is None
            await freeze(db, "ETHUSDT", 30, "higher", AT - timedelta(minutes=5))
            await db.commit()
            first = await new_run(db, SimulationSettings(), None, at=AT - timedelta(seconds=1))
            btc = await freeze(db, "BTCUSDT", 10, "higher", AT)
            eth = await freeze(db, "ETHUSDT", 10, "lower", AT)
            await freeze(db, "BTCUSDT", 30, "lower", AT, closed=False)
            await freeze(db, "ETHUSDT", 30, "lower", AT, strong=False)
            await db.commit()
        opened = await asyncio.gather(tick(AT), tick(AT))
        assert sum(item["opened"] for item in opened) == 2, opened
        assert sum(item["skipped"] for item in opened) == 2, opened
        async with async_session_factory() as db:
            repo = SimulatorRepository(db)
            active = await repo.active(first.id)
            assert {(item.symbol, item.horizon_minutes) for item in active} == {
                ("BTCUSDT", 10),
                ("ETHUSDT", 10),
            }
            assert all(item.virtual_stake == Decimal(100) for item in active)
            assert {item.reason for item in await repo.decisions(first.id)} == {
                "opened",
                "invalid_signal",
                "signal_not_strong",
            }
            minute = AT + timedelta(minutes=1)
            await freeze(db, "BTCUSDT", 10, "higher", minute)
            await db.commit()
            assert (await process_tick(db, at=minute))["skipped"] == 1
            assert any(
                item.reason == "existing_active_bet" for item in await repo.decisions(first.id)
            )
            await control_run(db, first.id, running=False, at=minute + timedelta(seconds=1))
            current = await new_run(
                db,
                SimulationSettings(starting_bankroll=Decimal(2000)),
                first.id,
                at=minute + timedelta(seconds=2),
            )
            expiry = AT + timedelta(minutes=10)
            for signal in (btc, eth):
                reference = await db.get(MarketInstrument, signal.reference_instrument_id)
                assert reference is not None
                db.add(
                    candle(
                        reference,
                        MarketInterval.ONE_MINUTE,
                        expiry - timedelta(minutes=1),
                        expiry,
                        Decimal(101),
                        closed=True,
                    )
                )
                await db.flush()
                await ShadowRepository(db).settle(reference.id, expiry)
            await db.commit()
        closed = await asyncio.gather(tick(expiry), tick(expiry))
        assert sum(item["settled"] for item in closed) == 2, closed
        assert not any(item["opened"] for item in closed)
        async with async_session_factory() as db:
            archived = await db.get(SimulationSession, first.id)
            fresh = await db.get(SimulationSession, current.id)
            assert (
                archived
                and archived.status == "archived"
                and archived.current_bankroll == Decimal(9980)
            )
            assert fresh and fresh.current_bankroll == Decimal(2000) and fresh.total_bets == 0
            assert archived.total_bets == archived.settled_bets == 2
            stats = SimulationStats.model_validate(archived.stats).overall
            assert (stats.wins, stats.losses) == (1, 1)
            ledger = list(
                (
                    await db.scalars(
                        select(SimulationBet)
                        .where(SimulationBet.simulation_session_id == first.id)
                        .order_by(SimulationBet.settlement_sequence)
                    )
                ).all()
            )
            assert len(ledger) == 2
            assert ledger[0].bankroll_before == Decimal(10000)
            assert ledger[0].bankroll_after == ledger[1].bankroll_before
            assert ledger[1].bankroll_after == Decimal(9980)
        print("PostgreSQL simulator concurrency, idempotency and archived settlement passed.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(verify())
