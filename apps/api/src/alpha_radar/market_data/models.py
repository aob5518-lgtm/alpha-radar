from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from alpha_radar.assets.models import Asset, TimestampMixin, enum_values, json_type, uuid_type
from alpha_radar.db.base import Base
from alpha_radar.market_data.constants import MarketInterval


class InstrumentType(str, enum.Enum):
    SPOT = "spot"
    INDEX = "index"
    PERPETUAL = "perpetual"
    FUTURE = "future"
    OPTION = "option"


class InstrumentStatus(str, enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    DELISTED = "delisted"


financial_numeric = Numeric(38, 18)


class MarketInstrument(TimestampMixin, Base):
    __tablename__ = "market_instruments"
    __table_args__ = (
        CheckConstraint("provider = lower(provider)", name="ck_market_instruments_provider_lower"),
        CheckConstraint(
            "base_currency = upper(base_currency)", name="ck_market_instruments_base_upper"
        ),
        CheckConstraint(
            "quote_currency = upper(quote_currency)", name="ck_market_instruments_quote_upper"
        ),
        UniqueConstraint(
            "provider", "provider_instrument_id", name="uq_market_instrument_provider_identity"
        ),
        Index("ix_market_instruments_asset_id", "asset_id"),
        Index("ix_market_instruments_status", "status"),
    )

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    asset_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_instrument_id: Mapped[str] = mapped_column(String(255), nullable=False)
    instrument_type: Mapped[InstrumentType] = mapped_column(
        Enum(InstrumentType, name="market_instrument_type", values_callable=enum_values),
        nullable=False,
    )
    base_currency: Mapped[str] = mapped_column(String(32), nullable=False)
    quote_currency: Mapped[str] = mapped_column(String(32), nullable=False)
    venue: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[InstrumentStatus] = mapped_column(
        Enum(InstrumentStatus, name="market_instrument_status", values_callable=enum_values),
        nullable=False,
        default=InstrumentStatus.ACTIVE,
        server_default=InstrumentStatus.ACTIVE.value,
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", json_type, nullable=False, default=dict, server_default="{}"
    )

    asset: Mapped[Asset] = relationship(lazy="raise")


class MarketQuote(Base):
    __tablename__ = "market_quotes"
    __table_args__ = (
        CheckConstraint("provider = lower(provider)", name="ck_market_quotes_provider_lower"),
        CheckConstraint("base_currency = upper(base_currency)", name="ck_market_quotes_base_upper"),
        CheckConstraint(
            "quote_currency = upper(quote_currency)", name="ck_market_quotes_quote_upper"
        ),
        CheckConstraint("price > 0", name="ck_market_quotes_positive_price"),
        CheckConstraint("bid IS NULL OR bid > 0", name="ck_market_quotes_positive_bid"),
        CheckConstraint("ask IS NULL OR ask > 0", name="ck_market_quotes_positive_ask"),
        CheckConstraint("bid_size IS NULL OR bid_size >= 0", name="ck_market_quotes_bid_size"),
        CheckConstraint("ask_size IS NULL OR ask_size >= 0", name="ck_market_quotes_ask_size"),
        Index("ix_market_quotes_asset_observed", "asset_id", "observed_at"),
        Index("ix_market_quotes_instrument_observed", "market_instrument_id", "observed_at"),
    )

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    asset_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False
    )
    market_instrument_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("market_instruments.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    price: Mapped[Decimal] = mapped_column(financial_numeric, nullable=False)
    bid: Mapped[Decimal | None] = mapped_column(financial_numeric)
    ask: Mapped[Decimal | None] = mapped_column(financial_numeric)
    bid_size: Mapped[Decimal | None] = mapped_column(financial_numeric)
    ask_size: Mapped[Decimal | None] = mapped_column(financial_numeric)
    base_currency: Mapped[str] = mapped_column(String(32), nullable=False)
    quote_currency: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    quality_flags: Mapped[list[str]] = mapped_column(
        json_type, nullable=False, default=list, server_default="[]"
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", json_type, nullable=False, default=dict, server_default="{}"
    )


class MarketCandle(Base):
    __tablename__ = "market_candles"
    __table_args__ = (
        CheckConstraint("provider = lower(provider)", name="ck_market_candles_provider_lower"),
        CheckConstraint("close_time > open_time", name="ck_market_candles_time_order"),
        CheckConstraint(
            "open > 0 AND high > 0 AND low > 0 AND close > 0",
            name="ck_market_candles_positive_prices",
        ),
        CheckConstraint(
            "high >= open AND high >= close AND low <= open AND low <= close AND high >= low",
            name="ck_market_candles_ohlc_bounds",
        ),
        CheckConstraint("volume IS NULL OR volume >= 0", name="ck_market_candles_volume"),
        CheckConstraint(
            "quote_volume IS NULL OR quote_volume >= 0", name="ck_market_candles_quote_volume"
        ),
        Index("ix_market_candles_asset_open", "asset_id", "open_time"),
    )

    provider: Mapped[str] = mapped_column(String(64), primary_key=True)
    market_instrument_id: Mapped[UUID] = mapped_column(
        uuid_type,
        ForeignKey("market_instruments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    interval: Mapped[MarketInterval] = mapped_column(
        Enum(MarketInterval, name="market_interval", values_callable=enum_values), primary_key=True
    )
    open_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    asset_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False
    )
    close_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    open: Mapped[Decimal] = mapped_column(financial_numeric, nullable=False)
    high: Mapped[Decimal] = mapped_column(financial_numeric, nullable=False)
    low: Mapped[Decimal] = mapped_column(financial_numeric, nullable=False)
    close: Mapped[Decimal] = mapped_column(financial_numeric, nullable=False)
    volume: Mapped[Decimal | None] = mapped_column(financial_numeric)
    quote_volume: Mapped[Decimal | None] = mapped_column(financial_numeric)
    is_closed: Mapped[bool] = mapped_column(nullable=False)
    provider_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    quality_flags: Mapped[list[str]] = mapped_column(
        json_type, nullable=False, default=list, server_default="[]"
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", json_type, nullable=False, default=dict, server_default="{}"
    )
