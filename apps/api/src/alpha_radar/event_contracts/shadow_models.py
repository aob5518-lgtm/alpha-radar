from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from alpha_radar.assets.models import json_type, uuid_type
from alpha_radar.db.base import Base
from alpha_radar.market_data.models import financial_numeric


class EventShadowSignal(Base):
    __tablename__ = "event_shadow_signals"
    __table_args__ = (
        UniqueConstraint(
            "market_instrument_id",
            "horizon_minutes",
            "version",
            "confirmed_at",
            name="uq_shadow_cutoff",
        ),
        UniqueConstraint(
            "market_instrument_id",
            "horizon_minutes",
            "version",
            "direction",
            "episode_at",
            name="uq_shadow_episode",
        ),
        CheckConstraint("horizon_minutes IN (10, 30)", name="ck_shadow_horizon"),
        CheckConstraint("score BETWEEN 75 AND 100", name="ck_shadow_score"),
        CheckConstraint("direction IN ('higher', 'lower')", name="ck_shadow_direction"),
        CheckConstraint("result IN ('pending', 'win', 'loss', 'missing')", name="ck_shadow_result"),
        CheckConstraint("reference_price > 0", name="ck_shadow_reference"),
        CheckConstraint(
            "confirmed_at <= generated_at AND generated_at < expires_at", name="ck_shadow_times"
        ),
        Index("ix_shadow_pending", "reference_instrument_id", "result", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    asset_id: Mapped[UUID] = mapped_column(uuid_type, ForeignKey("assets.id"))
    market_instrument_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("market_instruments.id")
    )
    reference_instrument_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("market_instruments.id")
    )
    symbol: Mapped[str] = mapped_column(String(16))
    horizon_minutes: Mapped[int]
    version: Mapped[str] = mapped_column(String(32))
    settlement_version: Mapped[str] = mapped_column(String(32))
    direction: Mapped[str] = mapped_column(String(12))
    score: Mapped[int]
    episode_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reference_price: Mapped[Decimal] = mapped_column(financial_numeric)
    reference_source: Mapped[str] = mapped_column(String(64))
    settlement_source: Mapped[str] = mapped_column(String(64))
    assessment: Mapped[dict[str, object]] = mapped_column(json_type)
    result: Mapped[str] = mapped_column(String(12), default="pending")
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    settled_price: Mapped[Decimal | None] = mapped_column(financial_numeric)
    payout_assumption: Mapped[Decimal | None] = mapped_column(financial_numeric)
