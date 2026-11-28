"""Exercise the private ledger on the disposable Compose stack."""

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.errors import AppError
from alpha_radar.event_contracts.shadow_repository import ShadowRepository
from alpha_radar.event_contracts.shadow_rules import RULES
from alpha_radar.event_contracts.strategy import Horizon
from alpha_radar.event_semi_auto.models import ExecutionAudit, LiveIntent, RealBet
from alpha_radar.event_semi_auto.repository import Repository
from alpha_radar.event_semi_auto.schemas import Confirm, Control, IntentAction, RiskSettings, Settle
from alpha_radar.event_semi_auto.service import confirm, control, decide, settle, tick
from alpha_radar.event_simulator.integration_verify import candle, freeze
from alpha_radar.event_simulator.models import SimulationBet
from alpha_radar.event_simulator.schemas import Market
from alpha_radar.market_data.constants import MarketInterval

AT = datetime(2026, 11, 16, 20, 0, tzinfo=UTC)


async def histories(db: AsyncSession, symbol: Market, horizon: Horizon, at: datetime) -> None:
    shadow = ShadowRepository(db)
    instrument = await shadow.instrument(symbol=symbol)
    assert instrument is not None
    reference = await shadow.reference_instrument(instrument)
    assert reference is not None
    trigger = RULES[horizon]
    span = timedelta(minutes=trigger.trigger_minutes)
    for n in range(2, 16):
        row = candle(
            instrument,
            trigger.trigger,
            at - span * n,
            at - span * (n - 1),
            Decimal(100),
            closed=True,
        )
        row.high, row.low = Decimal(102), Decimal(98)
        db.add(row)
    if horizon == 10:
        db.add(
            candle(
                reference,
                MarketInterval.ONE_MINUTE,
                at - timedelta(minutes=1),
                at,
                Decimal(100),
                closed=True,
            )
        )


async def tick_at(now: datetime) -> dict[str, int]:
    async with async_session_factory() as db:
        return await tick(Repository(db), now)


async def duplicate_confirm(intent_id: UUID, data: Confirm, now: datetime) -> RealBet:
    async with async_session_factory() as db:
        return await confirm(Repository(db), intent_id, data, now)


async def duplicate_settle(bet_id: UUID, data: Settle, now: datetime) -> RealBet:
    async with async_session_factory() as db:
        return await settle(Repository(db), bet_id, data, now)


async def verify() -> None:
    settings = get_settings()
    if settings.app_env == "production" or settings.market_data_provider != "mock":
        raise RuntimeError("Fixtures require a disposable mock-provider database")
    async with async_session_factory() as db:
        repo = Repository(db)
        assert await repo.configuration() is None
        before = await db.scalar(select(func.count()).select_from(SimulationBet))
        assert await tick(repo, AT) == {"opened": 0, "blocked": 0}
        try:
            await control(repo, Control(revision=None, action="enable"), AT - timedelta(seconds=10))
        except AppError as failure:
            assert failure.code == "acknowledgement_required"
            await db.rollback()
        else:
            raise AssertionError("Activation must require acknowledgment")
        await control(
            repo,
            Control(revision=None, action="enable", acknowledged=True),
            AT - timedelta(seconds=10),
        )
        for market in ("BTCUSDT", "ETHUSDT"):
            for horizon in (10, 30):
                await histories(db, market, horizon, AT)
        await freeze(db, "BTCUSDT", 10, "higher", AT)
        await freeze(db, "ETHUSDT", 30, "lower", AT)
        await freeze(db, "ETHUSDT", 10, "lower", AT, closed=False)
        await freeze(db, "BTCUSDT", 30, "lower", AT, strong=False)
        await db.commit()
    runs = await asyncio.gather(tick_at(AT), tick_at(AT))
    assert sum(run["opened"] for run in runs) == 2
    assert sum(run["blocked"] for run in runs) == 2

    async with async_session_factory() as db:
        repo = Repository(db)
        assert await db.scalar(select(func.count()).select_from(RealBet)) == 0
        rows = list(await db.scalars(select(LiveIntent)))
        assert {row.risk_reason for row in rows} == {None, "invalid_trigger", "signal_not_strong"}
        btc = next(row for row in rows if row.symbol == "BTCUSDT" and row.horizon_minutes == 10)
        eth = next(row for row in rows if row.symbol == "ETHUSDT" and row.horizon_minutes == 30)
        assert btc.expires_at == AT + timedelta(seconds=60)
        assert eth.expires_at == AT + timedelta(seconds=120)
        assert btc.signal_atr is not None and btc.signal_atr > 0
        try:
            await decide(
                repo,
                btc.id,
                IntentAction(
                    action="approve",
                    acknowledged=True,
                    payout=Decimal("1.79"),
                ),
                AT,
            )
        except AppError as failure:
            assert failure.code == "payout_low"
        else:
            raise AssertionError("Below-minimum payout passed")
        approval = IntentAction(action="approve", acknowledged=True, payout=Decimal("1.80"))
        await decide(repo, btc.id, IntentAction(action="handoff", acknowledged=True), AT)
        await decide(repo, btc.id, approval, AT)
        with_price = Confirm(
            acknowledged=True,
            direction="higher",
            horizon_minutes=10,
            actual_open_at=AT,
            actual_expiry_at=AT + timedelta(minutes=10),
            actual_open_price=Decimal("99.95"),
            actual_premium=Decimal(10),
            actual_payout=Decimal("1.80"),
            order_reference="fixture-1",
        )
        assert await db.scalar(select(func.count()).select_from(RealBet)) == 0

    bets = await asyncio.gather(
        duplicate_confirm(btc.id, with_price, AT), duplicate_confirm(btc.id, with_price, AT)
    )
    assert bets[0].id == bets[1].id
    assert bets[0].actual_open_price != bets[0].signal_reference_price
    assert bets[0].settlement_source == "UNKNOWN"

    async with async_session_factory() as db:
        repo = Repository(db)
        assert await repo.daily_pnl(AT) == 0
        try:
            await decide(repo, eth.id, approval, AT)
        except AppError as failure:
            assert failure.code == "max_active_bets"
        else:
            raise AssertionError("Existing real exposure was ignored")
        await decide(repo, eth.id, IntentAction(action="reject", reason="discretion"), AT)
        rejected = await db.get(LiveIntent, eth.id)
        assert rejected is not None and rejected.status == "REJECTED_BY_USER"
        config = await repo.configuration()
        assert config is not None
        await control(repo, Control(revision=config.revision, action="kill"), AT)
        assert await tick(repo, AT) == {"opened": 0, "blocked": 0}
        assert (await repo.active())[0].id == bets[0].id

    result = Settle(result="WIN", settlement_price=Decimal(101))
    expiry = AT + timedelta(minutes=10)
    settled = await asyncio.gather(
        duplicate_settle(bets[0].id, result, expiry), duplicate_settle(bets[0].id, result, expiry)
    )
    assert all(
        bet.net_pnl == 8 and bet.settlement_source == "MANUAL_CONFIRMATION" for bet in settled
    )
    async with async_session_factory() as db:
        repo = Repository(db)
        assert await repo.daily_pnl(expiry) == Decimal(8)
        assert await db.scalar(select(func.count()).select_from(RealBet)) == 1
        assert await db.scalar(select(func.count()).select_from(SimulationBet)) == before
        assert (
            await db.scalar(
                select(func.count())
                .select_from(ExecutionAudit)
                .where(ExecutionAudit.event == "settlement_confirmed")
            )
            == 1
        )
        config = await repo.configuration()
        assert config is not None and config.killed
        await control(
            repo,
            Control(revision=config.revision, action="disable", settings=RiskSettings()),
            expiry,
        )
        assert not config.enabled
        later = AT + timedelta(days=1)
        await control(repo, Control(revision=config.revision, action="enable"), later)
        await histories(db, "ETHUSDT", 10, later)
        await freeze(db, "ETHUSDT", 10, "lower", later)
        await db.commit()
        assert (await tick(repo, later))["opened"] == 1
        pending = (await repo.pending())[0]
        await decide(repo, pending.id, approval, later)
        data = with_price.model_copy(
            update={
                "direction": "lower",
                "order_reference": None,
                "actual_open_at": later,
                "actual_expiry_at": later + timedelta(minutes=10),
            }
        )
        try:
            await confirm(repo, pending.id, data, later + timedelta(seconds=60))
        except AppError as failure:
            assert failure.code == "signal_expired"
        else:
            raise AssertionError("Expired intent could record a bet")
        assert pending.status == "EXPIRED"
        assert await db.scalar(select(func.count()).select_from(RealBet)) == 1
    print("Semi-Auto PostgreSQL lifecycle, idempotency, risk and Paper isolation verified.")


async def main() -> None:
    try:
        await verify()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
