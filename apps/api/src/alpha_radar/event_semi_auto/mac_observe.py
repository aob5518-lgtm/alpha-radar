from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import select

from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_rules import VERSION as SIGNAL_VERSION
from alpha_radar.event_contracts.shadow_rules import Direction
from alpha_radar.event_contracts.strategy import Horizon, utc
from alpha_radar.event_semi_auto.alerts import current_block, reviewable
from alpha_radar.event_semi_auto.execution_lifecycle import PRE_EXECUTION
from alpha_radar.event_semi_auto.models import LiveIntent
from alpha_radar.event_semi_auto.repository import Repository
from alpha_radar.event_semi_auto.rules import PENDING
from alpha_radar.event_semi_auto.schemas import VERSION, Payout, Premium, Price, RiskSettings
from alpha_radar.event_simulator.schemas import Market


class ObservedIntent(BaseModel):
    id: UUID
    event_signal_id: UUID
    signal_version: Literal["event-signal-v1"]
    strategy_version: Literal["event-semi-auto-v1"]
    market_instrument_id: UUID
    symbol: Market
    horizon_minutes: Horizon
    direction: Direction
    signal_score: int = Field(ge=0, le=100)
    signal_reference_price: Price
    suggested_stake: Premium
    minimum_payout: Payout
    settings_snapshot: RiskSettings
    generated_at: AwareDatetime
    created_at: AwareDatetime
    execution_deadline: AwareDatetime


class Observation(BaseModel):
    status: Literal["stopped", "waiting", "review"]
    server_time: AwareDatetime
    intent: ObservedIntent | None = None


async def observe(repo: Repository, now: datetime) -> Observation:
    state = await repo.configuration()
    if not state or not state.enabled or state.killed:
        return Observation(status="stopped", server_time=now)
    rows = await repo.db.execute(
        select(LiveIntent, EventShadowSignal)
        .join(EventShadowSignal, LiveIntent.event_signal_id == EventShadowSignal.id)
        .where(
            LiveIntent.status.in_(PENDING),
            LiveIntent.execution_status.in_(PRE_EXECUTION),
            LiveIntent.execution_deadline > now,
            LiveIntent.settings_revision == state.revision,
        )
        .order_by(LiveIntent.created_at.desc(), LiveIntent.id)
        .limit(8)
    )
    for intent, signal in rows.tuples():
        deadline = intent.execution_deadline
        if not deadline or not reviewable(intent, state, now):
            continue
        if (
            intent.signal_version != SIGNAL_VERSION
            or signal.version != SIGNAL_VERSION
            or intent.strategy_version != VERSION
            or intent.market_instrument_id != signal.market_instrument_id
            or intent.symbol != signal.symbol
            or intent.horizon_minutes != signal.horizon_minutes
            or intent.direction != signal.direction
            or intent.signal_score != signal.score
            or intent.signal_reference_price != signal.reference_price
            or utc(intent.generated_at) != utc(signal.generated_at)
            or utc(deadline) > utc(signal.expires_at)
        ):
            continue
        if await repo.unresolved(intent.id) or await current_block(repo, intent, state, now):
            continue
        return Observation(
            status="review",
            server_time=now,
            intent=ObservedIntent.model_validate(intent, from_attributes=True),
        )
    return Observation(status="waiting", server_time=now)
