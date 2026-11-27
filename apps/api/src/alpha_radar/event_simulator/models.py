from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from alpha_radar.assets.models import json_type, uuid_type
from alpha_radar.db.base import Base
from alpha_radar.event_contracts.shadow_rules import Direction, State
from alpha_radar.event_simulator.schemas import BetStatus, DecisionReason, Market, SessionStatus
from alpha_radar.market_data.models import financial_numeric

cash = Numeric(28, 2)
ratio = Numeric(20, 10)


class SimulationSession(Base):
    __tablename__ = "event_simulation_sessions"
    __table_args__ = (
        CheckConstraint("status IN ('running','paused','archived')", name="ck_sim_status"),
        CheckConstraint("current_bankroll >= 0", name="ck_sim_bankroll"),
        Index(
            "uq_sim_current",
            text("(1)"),
            unique=True,
            postgresql_where=text("status <> 'archived'"),
        ),
        Index("ix_sim_created", "created_at", "id"),
    )

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accept_after: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[SessionStatus] = mapped_column(String(12))
    starting_bankroll: Mapped[Decimal] = mapped_column(cash)
    current_bankroll: Mapped[Decimal] = mapped_column(cash)
    max_bankroll: Mapped[Decimal] = mapped_column(cash)
    max_drawdown: Mapped[Decimal] = mapped_column(ratio)
    day: Mapped[date]
    day_start_bankroll: Mapped[Decimal] = mapped_column(cash)
    risk_loss_count: Mapped[int]
    cooldown_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    strategy_version: Mapped[str] = mapped_column(String(32))
    signal_version: Mapped[str] = mapped_column(String(32))
    settlement_version: Mapped[str] = mapped_column(String(32))
    settings_snapshot: Mapped[dict[str, object]] = mapped_column(json_type)
    stats: Mapped[dict[str, object]] = mapped_column(json_type)
    total_bets: Mapped[int]
    settled_bets: Mapped[int]


class SimulationBet(Base):
    __tablename__ = "event_paper_bets"
    __table_args__ = (
        UniqueConstraint("simulation_session_id", "event_signal_id", name="uq_paper_signal"),
        CheckConstraint("status IN ('active','win','loss','void')", name="ck_paper_state"),
        CheckConstraint("horizon_minutes IN (10,30)", name="ck_paper_horizon"),
        CheckConstraint("virtual_stake > 0 AND payout_multiplier > 1", name="ck_paper_stake"),
        Index(
            "uq_paper_active_exposure",
            "simulation_session_id",
            "market_instrument_id",
            "horizon_minutes",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
        Index("ix_paper_history", "simulation_session_id", "bet_created_at", "id"),
        Index("ix_paper_equity", "simulation_session_id", "settlement_sequence"),
        Index("ix_paper_due", "expiry_at", postgresql_where=text("status = 'active'")),
    )

    id: Mapped[UUID] = mapped_column(uuid_type, primary_key=True, default=uuid4)
    simulation_session_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("event_simulation_sessions.id")
    )
    event_signal_id: Mapped[UUID] = mapped_column(uuid_type, ForeignKey("event_shadow_signals.id"))
    market_instrument_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("market_instruments.id")
    )
    symbol: Mapped[Market] = mapped_column(String(16))
    horizon_minutes: Mapped[int]
    direction: Mapped[Direction] = mapped_column(String(12))
    signal_state: Mapped[State] = mapped_column(String(16))
    signal_score: Mapped[int]
    signal_version: Mapped[str] = mapped_column(String(32))
    signal_generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    bet_created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reference_price: Mapped[Decimal] = mapped_column(financial_numeric)
    reference_source: Mapped[str] = mapped_column(String(64))
    expiry_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    virtual_stake: Mapped[Decimal] = mapped_column(cash)
    payout_multiplier: Mapped[Decimal] = mapped_column(ratio)
    payout_source: Mapped[str] = mapped_column(String(32))
    breakeven_probability: Mapped[Decimal] = mapped_column(ratio)
    assessment: Mapped[dict[str, object]] = mapped_column(json_type)
    settings_snapshot: Mapped[dict[str, object]] = mapped_column(json_type)
    status: Mapped[BetStatus] = mapped_column(String(12))
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    settlement_sequence: Mapped[int | None]
    settlement_price: Mapped[Decimal | None] = mapped_column(financial_numeric)
    settlement_source: Mapped[str] = mapped_column(String(64))
    gross_return: Mapped[Decimal | None] = mapped_column(cash)
    net_pnl: Mapped[Decimal | None] = mapped_column(cash)
    bankroll_before: Mapped[Decimal | None] = mapped_column(cash)
    bankroll_after: Mapped[Decimal | None] = mapped_column(cash)


class SimulationDecision(Base):
    __tablename__ = "event_simulation_decisions"
    __table_args__ = (Index("ix_sim_decision_time", "simulation_session_id", "decided_at"),)

    simulation_session_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("event_simulation_sessions.id"), primary_key=True
    )
    event_signal_id: Mapped[UUID] = mapped_column(
        uuid_type, ForeignKey("event_shadow_signals.id"), primary_key=True
    )
    symbol: Mapped[Market] = mapped_column(String(16))
    horizon_minutes: Mapped[int]
    reason: Mapped[DecisionReason] = mapped_column(String(32))
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
