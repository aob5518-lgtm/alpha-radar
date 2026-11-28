from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.config import get_settings
from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_repository import ShadowRepository
from alpha_radar.event_contracts.strategy import utc
from alpha_radar.event_semi_auto.alert_models import IntentAlert, PushDelivery, PushDevice
from alpha_radar.event_semi_auto.execution_lifecycle import PRE_EXECUTION
from alpha_radar.event_semi_auto.models import LiveIntent, SemiAutoSettings
from alpha_radar.event_semi_auto.push import key_string, public_key
from alpha_radar.event_semi_auto.repository import Repository
from alpha_radar.event_semi_auto.rules import PENDING, risk_block
from alpha_radar.event_semi_auto.schemas import RiskSettings

ACTIVE_STATES = ("STRONG_HIGHER", "STRONG_LOWER")
MAX_DEVICES = 8
MAX_ATTEMPTS = 3
LEASE = timedelta(seconds=8)


def alerts_enabled() -> bool:
    settings = get_settings()
    return (
        settings.event_alerts_enabled
        and settings.event_semi_auto_available
        and settings.event_signal_shadow_enabled
    )


def reviewable(intent: LiveIntent, state: SemiAutoSettings | None, now: datetime) -> bool:
    # Execution enablement is a separate gate. A review can describe a
    # monitoring-only intent, but cannot unlock its execution.
    return bool(
        state
        and state.enabled
        and not state.killed
        and intent.settings_revision == state.revision
        and intent.status in PENDING
        and intent.execution_status in PRE_EXECUTION
        and intent.execution_started_at is None
        and intent.handoff_started_at is None
        and intent.execution_id is None
        and intent.risk_reason is None
        and intent.signal_state in ACTIVE_STATES
        and now < utc(intent.execution_deadline or intent.expires_at)
    )


async def current_block(
    repo: Repository, intent: LiveIntent, state: SemiAutoSettings, now: datetime
) -> str | None:
    reason = risk_block(
        state,
        RiskSettings.model_validate(intent.settings_snapshot),
        (intent.market_instrument_id, intent.horizon_minutes),
        await repo.active(),
        await repo.daily_pnl(now),
        intent.suggested_stake,
        now,
    )
    if reason is None and await ShadowRepository(repo.db).macro_blocked(now, known_at=now):
        return "macro_event"
    if reason is None:
        signal = await repo.db.get(EventShadowSignal, intent.event_signal_id)
        price = await repo.index_price(signal.reference_instrument_id, now) if signal else None
        if price is None:
            return "stale_data"
    return reason


async def queue_alert(
    db: AsyncSession, intent: LiveIntent, state: SemiAutoSettings, now: datetime
) -> None:
    if not alerts_enabled() or not reviewable(intent, state, now):
        return
    if await db.get(IntentAlert, intent.id) is not None:
        return
    queued = now
    if queued >= utc(intent.execution_deadline or intent.expires_at):
        return
    db.add(IntentAlert(intent_id=intent.id, created_at=queued))
    if not public_key():
        return
    devices = await db.scalars(
        select(PushDevice.id).where(PushDevice.enabled.is_(True)).limit(MAX_DEVICES)
    )
    await db.flush()
    db.add_all(
        [
            PushDelivery(
                intent_id=intent.id,
                device_id=device,
                status="queued",
                attempt_count=0,
                retry_at=queued,
            )
            for device in devices
        ]
    )


class AlertView(BaseModel):
    intent_id: UUID
    symbol: str
    horizon_minutes: int
    direction: str
    score: int
    created_at: datetime
    queued_at: datetime
    expires_at: datetime
    actionable: bool
    execution_enabled: bool
    push_status: Literal["none", "queued", "accepted", "failed", "expired", "cancelled"]
    opened_at: datetime | None
    dispatch_ms: int | None
    accepted_ms: int | None


async def alert_feed(repo: Repository, now: datetime, history: bool) -> list[AlertView]:
    state = await repo.configuration()
    if not history and (not state or not state.enabled or state.killed):
        return []
    query = select(IntentAlert, LiveIntent).join(LiveIntent, IntentAlert.intent_id == LiveIntent.id)
    if not history:
        query = query.where(
            LiveIntent.expires_at > now,
            LiveIntent.status.in_(PENDING),
            LiveIntent.settings_revision == (state.revision if state else None),
        )
    rows = (
        (await repo.db.execute(query.order_by(IntentAlert.created_at.desc()).limit(25)))
        .tuples()
        .all()
    )
    delivery_by_intent: dict[UUID, list[PushDelivery]] = {}
    if history and rows:
        for delivery in await repo.db.scalars(
            select(PushDelivery).where(PushDelivery.intent_id.in_([row[1].id for row in rows]))
        ):
            delivery_by_intent.setdefault(delivery.intent_id, []).append(delivery)
    result: list[AlertView] = []
    for alert, intent in rows:
        actionable = reviewable(intent, state, now)
        if actionable and state and not history:
            actionable = await current_block(repo, intent, state, now) is None
        if not history and not actionable:
            continue
        deliveries = delivery_by_intent.get(intent.id, [])
        attempts = [utc(item.attempted_at) for item in deliveries if item.attempted_at]
        accepted = [utc(item.accepted_at) for item in deliveries if item.accepted_at]
        deadline = utc(intent.execution_deadline or intent.expires_at)
        status: Literal["none", "queued", "accepted", "failed", "expired", "cancelled"] = "none"
        if accepted:
            status = "accepted"
        elif deliveries and deadline <= now:
            status = "expired"
        elif any(item.status in ("sending", "queued") for item in deliveries):
            status = "queued" if actionable else "cancelled"
        elif any(item.status == "failed" for item in deliveries):
            status = "failed"
        elif deliveries:
            status = "cancelled"
        result.append(
            AlertView(
                intent_id=intent.id,
                symbol=intent.symbol,
                horizon_minutes=intent.horizon_minutes,
                direction=intent.direction,
                score=intent.signal_score,
                created_at=utc(intent.created_at),
                queued_at=utc(alert.created_at),
                expires_at=deadline,
                actionable=actionable,
                execution_enabled=repo.execution_enabled,
                push_status=status,
                opened_at=utc(alert.opened_at) if alert.opened_at else None,
                dispatch_ms=int((min(attempts) - utc(intent.created_at)).total_seconds() * 1000)
                if attempts
                else None,
                accepted_ms=int((min(accepted) - utc(intent.created_at)).total_seconds() * 1000)
                if accepted
                else None,
            )
        )
    return result


def push_payload(device: PushDevice, intent: LiveIntent | None) -> dict[str, str]:
    zh = device.locale == "zh-CN"
    if intent is None:
        return {
            "title": "ALPHA RADAR",
            "body": "测试提醒 · 非真实策略信号" if zh else "Test alert · No strategy signal",
            "test": "true",
        }
    body = "新的事件合约信号 · 点击查看" if zh else "New Event Contract signal · Tap to review"
    if device.detailed:
        direction = intent.direction.upper()
        label = ("偏涨" if direction == "HIGHER" else "偏跌") if zh else ""
        score = "证据分" if zh else "Evidence score"
        body = (
            f"{intent.symbol} · {intent.horizon_minutes}m\n"
            f"{label} {direction} · {score} {intent.signal_score}"
        )
    return {
        "title": "ALPHA RADAR",
        "body": body,
        "intent": str(intent.id),
        "expires": utc(intent.execution_deadline or intent.expires_at).isoformat(),
    }


def push_topic(intent_id: UUID) -> str:
    return key_string(intent_id.bytes)
