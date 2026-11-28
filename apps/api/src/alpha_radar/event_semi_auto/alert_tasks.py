import asyncio
from datetime import UTC, datetime, timedelta
from uuid import UUID

import structlog
from sqlalchemy import select, update

from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.event_contracts.strategy import utc
from alpha_radar.event_semi_auto.alert_models import PushDelivery, PushDevice
from alpha_radar.event_semi_auto.alerts import (
    LEASE,
    MAX_ATTEMPTS,
    alerts_enabled,
    current_block,
    push_payload,
    push_topic,
    reviewable,
)
from alpha_radar.event_semi_auto.models import LiveIntent
from alpha_radar.event_semi_auto.push import public_key, send_push
from alpha_radar.event_semi_auto.repository import Repository
from alpha_radar.worker import app

log = structlog.get_logger()
TASK = "alpha_radar.event_alerts.dispatch"


async def dispatch(intent_id: UUID, device_id: UUID, at: datetime | None = None) -> None:
    async with async_session_factory() as db:
        delivery = await db.get(PushDelivery, (intent_id, device_id), with_for_update=True)
        now = at or datetime.now(UTC)
        if not delivery or delivery.status != "queued" or utc(delivery.retry_at) > now:
            return
        device = await db.get(PushDevice, device_id)
        intent = await db.get(LiveIntent, intent_id)
        repo = Repository(db)
        state = await repo.configuration()
        if not intent:
            return
        deadline = utc(intent.execution_deadline or intent.expires_at)
        if deadline <= now:
            delivery.status = "expired"
            await db.commit()
            return
        if not device or not device.enabled or not state or not reviewable(intent, state, now):
            delivery.status = "cancelled"
            await db.commit()
            return
        if await current_block(repo, intent, state, now):
            delivery.status = "cancelled"
            await db.commit()
            return
        now = at or datetime.now(UTC)
        if deadline <= now:
            delivery.status = "expired"
            await db.commit()
            return
        delivery.status = "sending"
        delivery.attempt_count += 1
        delivery.attempted_at = delivery.attempted_at or now
        delivery.retry_at = now + LEASE
        await db.commit()
        result = await send_push(
            device, push_payload(device, intent), deadline, push_topic(intent_id)
        )
        completed = at or datetime.now(UTC)
        await db.refresh(delivery, with_for_update=True)
        if delivery.status != "sending":
            return
        delivery.failure_code = None if result == "accepted" else result
        if result == "accepted":
            delivery.status = "accepted"
            delivery.accepted_at = completed
            device.last_success_at = completed
        elif result == "invalid":
            delivery.status = "failed"
            device.enabled = False
        elif result == "expired":
            delivery.status = "expired"
        elif (
            result == "retry"
            and delivery.attempt_count < MAX_ATTEMPTS
            and completed + timedelta(seconds=5) < deadline
        ):
            delivery.status = "queued"
            delivery.retry_at = completed + timedelta(seconds=2)
        else:
            delivery.status = "failed"
        await db.commit()
        log.info(
            "event_alert_push_attempt",
            intent_id=str(intent_id),
            attempt=delivery.attempt_count,
            result=result,
            dispatch_ms=int((now - utc(intent.created_at)).total_seconds() * 1000),
        )


async def run_dispatch() -> None:
    try:
        async with async_session_factory() as db:
            now = datetime.now(UTC)
            # A worker may die after the provider accepted the request. Never
            # resend an ambiguous in-flight attempt.
            await db.execute(
                update(PushDelivery)
                .where(PushDelivery.status == "sending", PushDelivery.retry_at <= now)
                .values(status="failed", failure_code="attempt_outcome_unknown")
            )
            rows = (
                (
                    await db.execute(
                        select(PushDelivery.intent_id, PushDelivery.device_id)
                        .where(PushDelivery.status == "queued", PushDelivery.retry_at <= now)
                        .order_by(PushDelivery.retry_at)
                        .limit(16)
                    )
                )
                .tuples()
                .all()
            )
            await db.commit()
        if rows:
            results = await asyncio.gather(
                *(dispatch(intent_id, device_id) for intent_id, device_id in rows),
                return_exceptions=True,
            )
            for result in results:
                if isinstance(result, BaseException):
                    log.warning("event_alert_dispatch_failed", error_type=type(result).__name__)
    finally:
        await engine.dispose()


@app.task(name=TASK, soft_time_limit=12, time_limit=14, ignore_result=True)  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
def dispatch_task() -> None:
    if alerts_enabled() and public_key():
        asyncio.run(run_dispatch())
