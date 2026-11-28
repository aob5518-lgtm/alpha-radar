from datetime import datetime
from typing import Literal
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from alpha_radar.db.base import Base

DeliveryStatus = Literal["queued", "sending", "accepted", "failed", "expired", "cancelled"]
timestamp = sa.DateTime(timezone=True)


class IntentAlert(Base):
    __tablename__ = "event_intent_alerts"

    # The intent UUID is also the stable notification ID.
    intent_id: Mapped[UUID] = mapped_column(
        sa.ForeignKey("event_live_bet_intents.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(timestamp, index=True)
    opened_at: Mapped[datetime | None] = mapped_column(timestamp)


class PushDevice(Base):
    __tablename__ = "event_push_devices"

    id: Mapped[UUID] = mapped_column(primary_key=True)
    endpoint: Mapped[str] = mapped_column(sa.String(2048), unique=True)
    p256dh: Mapped[str] = mapped_column(sa.String(87))
    auth: Mapped[str] = mapped_column(sa.String(22))
    label: Mapped[str] = mapped_column(sa.String(60))
    locale: Mapped[str] = mapped_column(sa.String(5))
    detailed: Mapped[bool]
    enabled: Mapped[bool]
    created_at: Mapped[datetime] = mapped_column(timestamp)
    last_success_at: Mapped[datetime | None] = mapped_column(timestamp)
    last_test_at: Mapped[datetime | None] = mapped_column(timestamp)


class PushDelivery(Base):
    __tablename__ = "event_push_deliveries"
    __table_args__ = (sa.Index("ix_event_push_pending", "status", "retry_at"),)

    intent_id: Mapped[UUID] = mapped_column(
        sa.ForeignKey("event_intent_alerts.intent_id", ondelete="CASCADE"), primary_key=True
    )
    device_id: Mapped[UUID] = mapped_column(
        sa.ForeignKey("event_push_devices.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[DeliveryStatus] = mapped_column(sa.String(12))
    attempt_count: Mapped[int]
    retry_at: Mapped[datetime] = mapped_column(timestamp)
    attempted_at: Mapped[datetime | None] = mapped_column(timestamp)
    accepted_at: Mapped[datetime | None] = mapped_column(timestamp)
    failure_code: Mapped[str | None] = mapped_column(sa.String(32))
