from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import cast
from uuid import UUID, uuid4

from sqlalchemy import Select, Table, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_rules import (
    MACRO_WINDOW,
    MISSING_AFTER,
    PROXY,
    SETTLEMENT_VERSION,
    SYMBOLS,
    VERSION,
    WINDOW,
    Result,
)
from alpha_radar.event_contracts.shadow_schemas import ShadowAssessment
from alpha_radar.event_contracts.shadow_strategy import Candle, Series, proxy_result
from alpha_radar.event_contracts.strategy import Horizon, utc
from alpha_radar.events.models import Event
from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.models import (
    InstrumentStatus,
    InstrumentType,
    MarketCandle,
    MarketInstrument,
)


def macro_bounds(event: Event, known_at: datetime) -> tuple[datetime, datetime] | None:
    if event.actual_release_at and utc(event.actual_release_at) <= known_at:
        actual = utc(event.actual_release_at)
        return actual, actual
    if event.scheduled_at:
        scheduled = utc(event.scheduled_at)
        return scheduled, scheduled
    if event.scheduled_date:
        start = datetime.combine(event.scheduled_date, datetime.min.time(), tzinfo=UTC)
        return start, start + timedelta(days=1)
    return None


def major_macro_query() -> Select[tuple[Event]]:
    return select(Event).where(
        Event.category == "macro",
        Event.importance.in_(("critical", "high")),
        Event.status.notin_(("cancelled", "superseded", "rumored")),
    )


class ShadowRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def instrument(
        self, *, asset_id: UUID | None = None, symbol: str | None = None
    ) -> MarketInstrument | None:
        if asset_id is None and symbol is None:
            raise ValueError("Supply the canonical asset or a supported symbol")
        query = select(MarketInstrument).where(
            MarketInstrument.provider == "bybit",
            MarketInstrument.instrument_type == InstrumentType.PERPETUAL,
            MarketInstrument.status == InstrumentStatus.ACTIVE,
            MarketInstrument.provider_instrument_id.in_(SYMBOLS),
        )
        if asset_id is not None:
            query = query.where(MarketInstrument.asset_id == asset_id)
        if symbol is not None:
            query = query.where(MarketInstrument.provider_instrument_id == symbol)
        return await self.session.scalar(query)

    async def reference_instrument(self, instrument: MarketInstrument) -> MarketInstrument | None:
        return await self.session.scalar(
            select(MarketInstrument).where(
                MarketInstrument.asset_id == instrument.asset_id,
                MarketInstrument.provider == "binance_index",
                MarketInstrument.instrument_type == InstrumentType.INDEX,
                MarketInstrument.status == InstrumentStatus.ACTIVE,
                MarketInstrument.provider_instrument_id == instrument.provider_instrument_id,
            )
        )

    async def series(
        self, instrument: MarketInstrument, interval: MarketInterval, at: datetime
    ) -> Series:
        query = (
            select(MarketCandle)
            .where(
                MarketCandle.provider == instrument.provider,
                MarketCandle.asset_id == instrument.asset_id,
                MarketCandle.market_instrument_id == instrument.id,
                MarketCandle.interval == interval,
                MarketCandle.open_time < at,
                MarketCandle.close_time <= at,
                MarketCandle.is_closed.is_(True),
            )
            .order_by(MarketCandle.open_time.desc())
            .limit(WINDOW)
        )
        rows = (await self.session.scalars(query)).all()
        return Series(
            instrument.id,
            interval,
            [
                Candle(
                    utc(row.open_time),
                    utc(row.close_time),
                    float(row.open),
                    float(row.high),
                    float(row.low),
                    float(row.close),
                    float(row.volume) if row.volume is not None else None,
                )
                for row in reversed(rows)
            ],
        )

    async def index_close(self, ref_id: UUID, at: datetime) -> Decimal | None:
        return await self.session.scalar(
            select(MarketCandle.close).where(
                MarketCandle.provider == "binance_index",
                MarketCandle.market_instrument_id == ref_id,
                MarketCandle.interval == MarketInterval.ONE_MINUTE,
                MarketCandle.open_time == at - timedelta(minutes=1),
                MarketCandle.close_time == at,
                MarketCandle.is_closed.is_(True),
            )
        )

    async def macro_blocked(self, at: datetime, *, known_at: datetime) -> bool:
        start, end = at - MACRO_WINDOW, at + MACRO_WINDOW
        query = major_macro_query().where(
            Event.detected_at <= known_at,
            or_(
                Event.scheduled_at.between(start, end),
                Event.actual_release_at.between(start, end),
                Event.scheduled_date.between((start - timedelta(days=1)).date(), end.date()),
            ),
        )
        for event in (await self.session.scalars(query)).all():
            bounds = macro_bounds(event, known_at)
            if bounds and bounds[0] <= end and bounds[1] >= start:
                return True
        return False

    async def record(
        self,
        *,
        instrument: MarketInstrument,
        reference: MarketInstrument,
        horizon: Horizon,
        assessment: ShadowAssessment,
        strike: Decimal,
        now: datetime,
    ) -> EventShadowSignal | None:
        at, episode = assessment.as_of, assessment.episode_at
        if (
            assessment.state == "WAIT"
            or at is None
            or episode is None
            or assessment.direction is None
        ):
            raise ValueError("Only a valid, anchored candidate can be frozen")
        table = cast(Table, EventShadowSignal.__table__)
        factory = (
            pg_insert if self.session.get_bind().dialect.name == "postgresql" else sqlite_insert
        )
        statement = (
            factory(table)
            .values(
                id=uuid4(),
                asset_id=instrument.asset_id,
                market_instrument_id=instrument.id,
                reference_instrument_id=reference.id,
                symbol=instrument.provider_instrument_id,
                horizon_minutes=horizon,
                version=VERSION,
                settlement_version=SETTLEMENT_VERSION,
                direction=assessment.direction,
                score=assessment.score,
                episode_at=episode,
                confirmed_at=at,
                generated_at=now,
                expires_at=at + timedelta(minutes=horizon),
                reference_price=strike,
                reference_source=PROXY,
                settlement_source=PROXY,
                assessment=assessment.model_dump(mode="json"),
                result="pending",
            )
            .on_conflict_do_nothing()
        )
        await self.session.execute(statement)
        return await self.session.scalar(
            select(EventShadowSignal).where(
                EventShadowSignal.market_instrument_id == instrument.id,
                EventShadowSignal.horizon_minutes == horizon,
                EventShadowSignal.version == VERSION,
                EventShadowSignal.confirmed_at == at,
            )
        )

    async def settle(self, ref_id: UUID, now: datetime) -> int:
        rows = (
            await self.session.scalars(
                select(EventShadowSignal)
                .where(
                    EventShadowSignal.reference_instrument_id == ref_id,
                    EventShadowSignal.version == VERSION,
                    EventShadowSignal.settlement_version == SETTLEMENT_VERSION,
                    EventShadowSignal.result == "pending",
                    EventShadowSignal.expires_at <= now,
                )
                .order_by(EventShadowSignal.expires_at)
                .limit(100)
            )
        ).all()
        resolved = 0
        for row in rows:
            expiry = utc(row.expires_at)
            price = await self.index_close(ref_id, expiry)
            result: Result = "missing"
            if price is not None:
                if row.direction not in ("higher", "lower"):
                    raise ValueError("Unknown frozen direction")
                result = proxy_result(row.direction, row.reference_price, price)
            elif now - expiry < MISSING_AFTER:
                continue
            await self.session.execute(
                update(EventShadowSignal)
                .where(EventShadowSignal.id == row.id, EventShadowSignal.result == "pending")
                .values(result=result, settled_at=now, settled_price=price)
            )
            resolved += 1
        return resolved

    async def recent(self, instrument_id: UUID, horizon: Horizon) -> list[EventShadowSignal]:
        return list(
            (
                await self.session.scalars(
                    select(EventShadowSignal)
                    .where(
                        EventShadowSignal.market_instrument_id == instrument_id,
                        EventShadowSignal.horizon_minutes == horizon,
                        EventShadowSignal.version == VERSION,
                    )
                    .order_by(EventShadowSignal.confirmed_at.desc())
                    .limit(5)
                )
            ).all()
        )
