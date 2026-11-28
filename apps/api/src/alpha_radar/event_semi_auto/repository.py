from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_rules import FRESHNESS, RULES, VERSION
from alpha_radar.event_contracts.strategy import Horizon, utc
from alpha_radar.event_semi_auto.models import ExecutionAudit, LiveIntent, RealBet, SemiAutoSettings
from alpha_radar.event_semi_auto.rules import PENDING
from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.models import MarketCandle

PAGE_SIZE = 25
RECOVERABLE_HANDOFF = ("APPROVED_BY_USER", "EXPIRED", "CANCELLED_BY_RISK")


class Repository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def lock(self) -> None:
        await self.db.execute(text("SELECT pg_advisory_xact_lock(7852512917)"))

    async def configuration(self) -> SemiAutoSettings | None:
        return await self.db.get(SemiAutoSettings, 1)

    async def pending(self) -> list[LiveIntent]:
        return list(await self.db.scalars(select(LiveIntent).where(LiveIntent.status.in_(PENDING))))

    async def active(self) -> list[RealBet]:
        return list(await self.db.scalars(select(RealBet).where(RealBet.status == "OPEN")))

    async def handoffs(self) -> list[LiveIntent]:
        return list(
            await self.db.scalars(
                select(LiveIntent)
                .where(
                    LiveIntent.handoff_started_at.is_not(None),
                    LiveIntent.status.in_(RECOVERABLE_HANDOFF),
                )
                .order_by(LiveIntent.handoff_started_at.desc(), LiveIntent.id)
                .limit(PAGE_SIZE)
            )
        )

    async def daily_pnl(self, now: datetime) -> Decimal:
        start = datetime.combine(now.date(), datetime.min.time(), tzinfo=UTC)
        return await self.db.scalar(
            select(func.sum(RealBet.net_pnl)).where(RealBet.settled_at.between(start, now))
        ) or Decimal(0)

    async def candidates(self, start: datetime, now: datetime) -> list[EventShadowSignal]:
        processed = select(LiveIntent.id).where(LiveIntent.event_signal_id == EventShadowSignal.id)
        return list(
            await self.db.scalars(
                select(EventShadowSignal)
                .where(
                    EventShadowSignal.version == VERSION,
                    EventShadowSignal.symbol.in_(("BTCUSDT", "ETHUSDT")),
                    EventShadowSignal.generated_at <= now,
                    EventShadowSignal.confirmed_at >= max(start, now - FRESHNESS),
                    ~processed.exists(),
                )
                .order_by(EventShadowSignal.generated_at, EventShadowSignal.id)
                .limit(100)
            )
        )

    async def atr(self, signal: EventShadowSignal, horizon: Horizon) -> Decimal | None:
        rules = RULES[horizon]
        bars = list(
            await self.db.scalars(
                select(MarketCandle)
                .where(
                    MarketCandle.provider == "bybit",
                    MarketCandle.asset_id == signal.asset_id,
                    MarketCandle.market_instrument_id == signal.market_instrument_id,
                    MarketCandle.interval == rules.trigger,
                    MarketCandle.open_time
                    >= utc(signal.confirmed_at) - timedelta(minutes=15 * rules.trigger_minutes),
                    MarketCandle.close_time <= signal.confirmed_at,
                    MarketCandle.is_closed.is_(True),
                )
                .order_by(MarketCandle.open_time)
            )
        )
        span = timedelta(minutes=rules.trigger_minutes)
        cutoff = utc(signal.confirmed_at)
        if len(bars) != 15 or any(
            utc(bar.open_time) != cutoff - span * (15 - index)
            or utc(bar.close_time) != cutoff - span * (14 - index)
            for index, bar in enumerate(bars)
        ):
            return None
        value = (
            sum(
                (
                    max(
                        bar.high - bar.low,
                        abs(bar.high - previous.close),
                        abs(bar.low - previous.close),
                    )
                    for previous, bar in zip(bars, bars[1:], strict=False)
                ),
                Decimal(0),
            )
            / 14
        )
        return value if value > 0 else None

    async def index_price(self, ref: UUID, now: datetime) -> Decimal | None:
        return await self.db.scalar(
            select(MarketCandle.close)
            .where(
                MarketCandle.provider == "binance_index",
                MarketCandle.market_instrument_id == ref,
                MarketCandle.interval == MarketInterval.ONE_MINUTE,
                MarketCandle.is_closed.is_(True),
                MarketCandle.open_time >= now - FRESHNESS - timedelta(minutes=1),
                MarketCandle.close_time.between(now - FRESHNESS, now),
            )
            .order_by(MarketCandle.open_time.desc())
            .limit(1)
        )

    def audit(
        self, event: str, now: datetime, intent: LiveIntent | None = None, reason: str | None = None
    ) -> None:
        self.db.add(
            ExecutionAudit(
                event=event,
                created_at=now,
                intent_id=intent.id if intent else None,
                event_signal_id=intent.event_signal_id if intent else None,
                reason=reason,
            )
        )

    async def page[Row: (LiveIntent, RealBet)](
        self,
        model: type[Row],
        before: UUID | None,
    ) -> tuple[list[Row], UUID | None]:
        query = select(model)
        if model is RealBet:
            query = query.where(RealBet.status != "OPEN")
        if before:
            cursor = await self.db.get(model, before)
            if cursor is None:
                return [], None
            query = query.where(
                or_(
                    model.created_at < cursor.created_at,
                    and_(model.created_at == cursor.created_at, model.id < cursor.id),
                )
            )
        rows = list(
            await self.db.scalars(
                query.order_by(model.created_at.desc(), model.id.desc()).limit(PAGE_SIZE + 1)
            )
        )
        return rows[:PAGE_SIZE], rows[PAGE_SIZE - 1].id if len(rows) > PAGE_SIZE else None
