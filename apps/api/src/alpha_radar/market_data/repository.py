from __future__ import annotations

from datetime import datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import Table, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.models import (
    InstrumentStatus,
    MarketCandle,
    MarketInstrument,
    MarketQuote,
)


class MarketDataRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_instrument(self, instrument_id: UUID) -> MarketInstrument | None:
        return await self.session.get(MarketInstrument, instrument_id)

    async def get_instrument_by_provider_identity(
        self, provider: str, provider_instrument_id: str
    ) -> MarketInstrument | None:
        query = select(MarketInstrument).where(
            MarketInstrument.provider == provider,
            MarketInstrument.provider_instrument_id == provider_instrument_id,
        )
        return (await self.session.scalars(query)).one_or_none()

    async def list_active_instruments(self, provider: str) -> list[MarketInstrument]:
        query = (
            select(MarketInstrument)
            .where(
                MarketInstrument.provider == provider,
                MarketInstrument.status == InstrumentStatus.ACTIVE,
            )
            .order_by(MarketInstrument.provider_instrument_id.asc())
        )
        return list((await self.session.scalars(query)).all())

    async def get_preferred_instrument(self, asset_id: UUID) -> MarketInstrument | None:
        query = (
            select(MarketInstrument)
            .where(
                MarketInstrument.asset_id == asset_id,
                MarketInstrument.status == InstrumentStatus.ACTIVE,
            )
            .order_by(
                MarketInstrument.provider.asc(),
                MarketInstrument.provider_instrument_id.asc(),
            )
            .limit(1)
        )
        return (await self.session.scalars(query)).first()

    async def get_instrument_for_history(
        self, asset_id: UUID, interval: MarketInterval
    ) -> MarketInstrument | None:
        query = (
            select(MarketInstrument)
            .join(
                MarketCandle,
                MarketCandle.market_instrument_id == MarketInstrument.id,
            )
            .where(
                MarketInstrument.asset_id == asset_id,
                MarketInstrument.status == InstrumentStatus.ACTIVE,
                MarketCandle.interval == interval,
            )
            .order_by(MarketCandle.open_time.desc(), MarketInstrument.provider.asc())
            .limit(1)
        )
        return (await self.session.scalars(query)).first()

    async def add_quote(self, quote: MarketQuote) -> MarketQuote:
        self.session.add(quote)
        await self.session.commit()
        await self.session.refresh(quote)
        return quote

    async def latest_quote(self, asset_id: UUID) -> MarketQuote | None:
        query = (
            select(MarketQuote)
            .where(MarketQuote.asset_id == asset_id)
            .order_by(MarketQuote.observed_at.desc(), MarketQuote.ingested_at.desc())
            .limit(1)
        )
        return (await self.session.scalars(query)).first()

    async def latest_quote_for_instrument(self, instrument_id: UUID) -> MarketQuote | None:
        query = (
            select(MarketQuote)
            .where(MarketQuote.market_instrument_id == instrument_id)
            .order_by(MarketQuote.observed_at.desc(), MarketQuote.ingested_at.desc())
            .limit(1)
        )
        return (await self.session.scalars(query)).first()

    async def candle_exists(
        self,
        *,
        provider: str,
        market_instrument_id: UUID,
        interval: MarketInterval,
        open_time: datetime,
    ) -> bool:
        query = select(MarketCandle.provider).where(
            MarketCandle.provider == provider,
            MarketCandle.market_instrument_id == market_instrument_id,
            MarketCandle.interval == interval,
            MarketCandle.open_time == open_time,
        )
        return (await self.session.scalar(query)) is not None

    async def upsert_candle(self, values: dict[str, Any]) -> None:
        dialect_name = self.session.get_bind().dialect.name
        insert_factory = postgresql_insert if dialect_name == "postgresql" else sqlite_insert
        table = cast(Table, MarketCandle.__table__)
        statement = insert_factory(table).values(**values)
        identity = ["provider", "market_instrument_id", "interval", "open_time"]
        update_values = {key: value for key, value in values.items() if key not in set(identity)}
        statement = statement.on_conflict_do_update(
            index_elements=identity,
            set_=update_values,
        )
        await self.session.execute(statement)

    async def commit(self) -> None:
        await self.session.commit()

    async def list_candles(
        self,
        *,
        asset_id: UUID,
        market_instrument_id: UUID,
        interval: MarketInterval,
        start: datetime | None,
        end: datetime | None,
        limit: int,
    ) -> list[MarketCandle]:
        query = select(MarketCandle).where(
            MarketCandle.asset_id == asset_id,
            MarketCandle.market_instrument_id == market_instrument_id,
            MarketCandle.interval == interval,
        )
        if start is not None:
            query = query.where(MarketCandle.open_time >= start)
        if end is not None:
            query = query.where(MarketCandle.open_time < end)
        query = query.order_by(MarketCandle.open_time.desc()).limit(limit)
        newest_first = list((await self.session.scalars(query)).all())
        return list(reversed(newest_first))
