from __future__ import annotations

from datetime import datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import Table, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.models import Asset
from alpha_radar.event_contracts.models import EventContractDecision
from alpha_radar.event_contracts.strategy import VERSION, Bar, Horizon, utc
from alpha_radar.events.models import Event
from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.models import MarketCandle, MarketInstrument
from alpha_radar.market_data.repository import MarketDataRepository


class ResearchRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.market = MarketDataRepository(session)

    async def asset(self, asset_id: UUID) -> Asset | None:
        return await self.session.get(Asset, asset_id)

    async def history(self, instrument: MarketInstrument, limit: int = 1200) -> list[Bar]:
        candles = await self.market.list_candles(
            asset_id=instrument.asset_id,
            market_instrument_id=instrument.id,
            interval=MarketInterval.ONE_MINUTE,
            start=None,
            end=None,
            limit=limit,
        )
        return [
            Bar(
                open_time=utc(bar.open_time),
                close_time=utc(bar.close_time),
                open=bar.open,
                high=bar.high,
                low=bar.low,
                close=bar.close,
                is_closed=bar.is_closed,
            )
            for bar in candles
        ]

    async def insert_decision(self, row: EventContractDecision) -> bool:
        table = cast(Table, EventContractDecision.__table__)
        factory = (
            pg_insert if self.session.get_bind().dialect.name == "postgresql" else sqlite_insert
        )
        values: dict[str, Any] = {
            column.name: getattr(row, column.name) for column in table.columns
        }
        statement = factory(table).values(values).on_conflict_do_nothing().returning(table.c.id)
        inserted = (await self.session.execute(statement)).scalar_one_or_none()
        await self.session.commit()
        return inserted is not None

    async def latest(self, instrument_id: UUID, horizon: Horizon) -> EventContractDecision | None:
        return await self.session.scalar(
            select(EventContractDecision)
            .where(
                EventContractDecision.market_instrument_id == instrument_id,
                EventContractDecision.horizon_minutes == horizon,
                EventContractDecision.version == VERSION,
            )
            .order_by(EventContractDecision.confirmed_at.desc())
            .limit(1)
        )

    async def recent(
        self,
        instrument_id: UUID,
        horizon: Horizon,
        limit: int = 20,
        *,
        since: datetime | None = None,
    ) -> list[EventContractDecision]:
        statement = select(EventContractDecision).where(
            EventContractDecision.market_instrument_id == instrument_id,
            EventContractDecision.horizon_minutes == horizon,
            EventContractDecision.version == VERSION,
            EventContractDecision.direction.in_(("up", "down")),
        )
        if since is not None:
            statement = statement.where(EventContractDecision.generated_at >= since)
        return list(
            (
                await self.session.scalars(
                    statement.order_by(EventContractDecision.generated_at.desc()).limit(limit)
                )
            ).all()
        )

    async def pending(self, instrument_id: UUID) -> list[EventContractDecision]:
        return list(
            (
                await self.session.scalars(
                    select(EventContractDecision)
                    .where(
                        EventContractDecision.market_instrument_id == instrument_id,
                        EventContractDecision.outcome == "pending",
                    )
                    .order_by(EventContractDecision.expires_at)
                    .limit(100)
                )
            ).all()
        )

    async def episode_seen(self, instrument_id: UUID, horizon: Horizon, episode: str) -> bool:
        return (
            await self.session.scalar(
                select(EventContractDecision.id)
                .where(
                    EventContractDecision.market_instrument_id == instrument_id,
                    EventContractDecision.horizon_minutes == horizon,
                    EventContractDecision.version == VERSION,
                    EventContractDecision.episode_key == episode,
                )
                .limit(1)
            )
            is not None
        )

    async def candle_at(self, instrument_id: UUID, at: datetime) -> MarketCandle | None:
        return await self.session.scalar(
            select(MarketCandle).where(
                MarketCandle.provider == "binance_index",
                MarketCandle.market_instrument_id == instrument_id,
                MarketCandle.interval == MarketInterval.ONE_MINUTE,
                MarketCandle.open_time == at,
                MarketCandle.is_closed.is_(True),
            )
        )

    async def macro_blocks(self, start: datetime, end: datetime) -> tuple[bool, bool]:
        # Exact official times block the contract horizon. Unknown time-of-day blocks the UTC date.
        events = list(
            (
                await self.session.scalars(
                    select(Event).where(
                        Event.category == "macro",
                        Event.importance.in_(("critical", "high")),
                        Event.status.notin_(("cancelled", "superseded", "completed")),
                        or_(
                            Event.scheduled_at.between(start, end),
                            Event.scheduled_date.between(start.date(), end.date()),
                        ),
                    )
                )
            ).all()
        )
        return (
            any(
                event.scheduled_at is not None and start <= utc(event.scheduled_at) <= end
                for event in events
            ),
            any(
                event.scheduled_at is None and event.scheduled_date is not None for event in events
            ),
        )
