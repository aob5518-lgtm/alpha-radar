from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from alpha_radar.assets.models import json_type, uuid_type
from alpha_radar.db.base import Base
from alpha_radar.market_data.models import financial_numeric


class EventContractDecision(Base):
    """Immutable decision inputs, with separately appendable proxy observation fields."""

    __tablename__ = "event_contract_decisions"
    __table_args__ = (
        UniqueConstraint(
            "market_instrument_id",
            "horizon_minutes",
            "version",
            "confirmed_at",
            name="uq_event_contract_decision_identity",
        ),
        UniqueConstraint(
            "market_instrument_id",
            "horizon_minutes",
            "version",
            "episode_key",
            name="uq_event_contract_episode",
        ),
        CheckConstraint("horizon_minutes IN (10, 30)", name="ck_ec_horizon"),
        CheckConstraint("direction IN ('up','down','wait','unavailable')", name="ck_ec_direction"),
        CheckConstraint(
            "outcome IN ('not_applicable','pending','up','down','tie','missing')",
            name="ck_ec_outcome",
        ),
        Index(
            "ix_ec_instrument_horizon_time",
            "market_instrument_id",
            "horizon_minutes",
            "confirmed_at",
        ),
        Index("ix_ec_pending", "outcome", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    asset_id: Mapped[UUID] = mapped_column(uuid_type, ForeignKey("assets.id"), nullable=False)
    market_instrument_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("market_instruments.id"), nullable=False
    )
    horizon_minutes: Mapped[int] = mapped_column(nullable=False)
    version: Mapped[str] = mapped_column(String(80), nullable=False)
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    valid_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    direction: Mapped[str] = mapped_column(String(20), nullable=False)
    assessment: Mapped[dict[str, Any]] = mapped_column(json_type, nullable=False)
    episode_key: Mapped[str | None] = mapped_column(String(128))
    # Proxy observation starts at the NEXT whole minute after publication, never retroactively.
    entry_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    entry_price: Mapped[Decimal | None] = mapped_column(financial_numeric)
    settlement_price: Mapped[Decimal | None] = mapped_column(financial_numeric)
    outcome: Mapped[str] = mapped_column(String(20), nullable=False)
    observed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
