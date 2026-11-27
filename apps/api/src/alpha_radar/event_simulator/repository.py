from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_rules import RULES, SYMBOLS, VERSION
from alpha_radar.event_contracts.strategy import utc
from alpha_radar.event_simulator.models import SimulationBet, SimulationDecision, SimulationSession
from alpha_radar.market_data.models import MarketCandle, MarketInstrument

PAGE_SIZE = 25
SIMULATOR_LOCK = 7_852_512_916


class SimulatorRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def lock(self) -> None:
        await self.session.execute(
            text("SELECT pg_advisory_xact_lock(:key)"), {"key": SIMULATOR_LOCK}
        )

    async def current(self) -> SimulationSession | None:
        return await self.session.scalar(
            select(SimulationSession).where(SimulationSession.status != "archived")
        )

    async def sessions_page(
        self, before: UUID | None
    ) -> tuple[list[SimulationSession], UUID | None]:
        query = select(SimulationSession)
        if before is not None:
            cursor = await self.session.get(SimulationSession, before)
            if cursor is None:
                return [], None
            query = query.where(
                or_(
                    SimulationSession.created_at < cursor.created_at,
                    and_(
                        SimulationSession.created_at == cursor.created_at,
                        SimulationSession.id < cursor.id,
                    ),
                )
            )
        rows = list(
            (
                await self.session.scalars(
                    query.order_by(
                        SimulationSession.created_at.desc(), SimulationSession.id.desc()
                    ).limit(PAGE_SIZE + 1)
                )
            ).all()
        )
        return rows[:PAGE_SIZE], rows[PAGE_SIZE - 1].id if len(rows) > PAGE_SIZE else None

    async def active(self, run_id: UUID) -> list[SimulationBet]:
        return list(
            (
                await self.session.scalars(
                    select(SimulationBet)
                    .where(
                        SimulationBet.simulation_session_id == run_id,
                        SimulationBet.status == "active",
                    )
                    .order_by(SimulationBet.expiry_at, SimulationBet.id)
                )
            ).all()
        )

    async def due(self, now: datetime) -> list[tuple[SimulationBet, EventShadowSignal]]:
        result = await self.session.execute(
            select(SimulationBet, EventShadowSignal)
            .join(EventShadowSignal, EventShadowSignal.id == SimulationBet.event_signal_id)
            .where(
                SimulationBet.status == "active",
                SimulationBet.expiry_at <= now,
                EventShadowSignal.result.in_(("win", "loss", "missing")),
                EventShadowSignal.settled_at <= now,
            )
            .order_by(SimulationBet.expiry_at, SimulationBet.id)
            .limit(100)
        )
        return [(bet, signal) for bet, signal in result.tuples().all()]

    async def undecided(self, run: SimulationSession, now: datetime) -> list[EventShadowSignal]:
        # A decision is final for its session. Even expired signals get an audit outcome.
        decided = select(SimulationDecision.event_signal_id).where(
            SimulationDecision.simulation_session_id == run.id,
            SimulationDecision.event_signal_id == EventShadowSignal.id,
        )
        return list(
            (
                await self.session.scalars(
                    select(EventShadowSignal)
                    .where(
                        EventShadowSignal.version == VERSION,
                        EventShadowSignal.symbol.in_(SYMBOLS),
                        EventShadowSignal.confirmed_at >= run.created_at,
                        EventShadowSignal.generated_at <= now,
                        ~decided.exists(),
                    )
                    .order_by(EventShadowSignal.generated_at, EventShadowSignal.id)
                    .limit(100)
                )
            ).all()
        )

    async def has_closed_trigger(self, signal: EventShadowSignal) -> bool:
        if signal.horizon_minutes not in (10, 30):
            return False
        rules = RULES[signal.horizon_minutes]
        return bool(
            await self.session.scalar(
                select(MarketCandle.is_closed)
                .join(MarketInstrument, MarketInstrument.id == MarketCandle.market_instrument_id)
                .where(
                    MarketInstrument.provider == "bybit",
                    MarketInstrument.provider_instrument_id == signal.symbol,
                    MarketCandle.provider == "bybit",
                    MarketCandle.asset_id == signal.asset_id,
                    MarketCandle.market_instrument_id == signal.market_instrument_id,
                    MarketCandle.interval == rules.trigger,
                    MarketCandle.open_time
                    == utc(signal.confirmed_at) - timedelta(minutes=rules.trigger_minutes),
                    MarketCandle.close_time == signal.confirmed_at,
                    MarketCandle.is_closed.is_(True),
                )
            )
        )

    async def history(
        self, run_id: UUID, before: UUID | None
    ) -> tuple[list[SimulationBet], UUID | None]:
        query = select(SimulationBet).where(
            SimulationBet.simulation_session_id == run_id,
            SimulationBet.status != "active",
        )
        if before is not None:
            cursor = await self.session.get(SimulationBet, before)
            if cursor is None or cursor.simulation_session_id != run_id:
                return [], None
            query = query.where(
                or_(
                    SimulationBet.bet_created_at < cursor.bet_created_at,
                    and_(
                        SimulationBet.bet_created_at == cursor.bet_created_at,
                        SimulationBet.id < cursor.id,
                    ),
                )
            )
        rows = list(
            (
                await self.session.scalars(
                    query.order_by(
                        SimulationBet.bet_created_at.desc(), SimulationBet.id.desc()
                    ).limit(PAGE_SIZE + 1)
                )
            ).all()
        )
        return rows[:PAGE_SIZE], rows[PAGE_SIZE - 1].id if len(rows) > PAGE_SIZE else None

    async def equity(self, run: SimulationSession) -> list[SimulationBet]:
        # Sample the complete sequence, always preserving the last closure.
        step = max(1, (run.settled_bets + 118) // 119)
        return list(
            (
                await self.session.scalars(
                    select(SimulationBet)
                    .where(
                        SimulationBet.simulation_session_id == run.id,
                        or_(
                            func.mod(SimulationBet.settlement_sequence, step) == 0,
                            SimulationBet.settlement_sequence == run.settled_bets,
                        ),
                    )
                    .order_by(SimulationBet.settlement_sequence)
                )
            ).all()
        )

    async def decisions(self, run_id: UUID) -> list[SimulationDecision]:
        return list(
            (
                await self.session.scalars(
                    select(SimulationDecision)
                    .where(SimulationDecision.simulation_session_id == run_id)
                    .order_by(
                        SimulationDecision.decided_at.desc(),
                        SimulationDecision.event_signal_id.desc(),
                    )
                    .limit(12)
                )
            ).all()
        )
