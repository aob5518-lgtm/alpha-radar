from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, text, update

from alpha_radar.api.v1.event_semi_auto import Database, PrivateRoute, operator
from alpha_radar.event_semi_auto.alert_models import IntentAlert, PushDevice
from alpha_radar.event_semi_auto.alerts import (
    MAX_DEVICES,
    AlertView,
    alert_feed,
    alerts_enabled,
    current_block,
    push_payload,
    reviewable,
)
from alpha_radar.event_semi_auto.push import public_key, push_destination, send_push, validate_keys
from alpha_radar.event_semi_auto.repository import Repository
from alpha_radar.event_semi_auto.schemas import IntentView
from alpha_radar.event_semi_auto.service import get_intent, problem
from alpha_radar.event_semi_auto.views import intent_view


def require_alerts() -> None:
    if not alerts_enabled():
        raise problem("alerts_unavailable", status=404)


router = APIRouter(
    prefix="/event-semi-auto/alerts",
    tags=["event-alerts"],
    dependencies=[Depends(operator), Depends(require_alerts)],
    route_class=PrivateRoute,
)


class Configuration(BaseModel):
    vapid_public_key: str | None


class Subscription(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(min_length=1, max_length=2048)
    p256dh: str = Field(min_length=87, max_length=87)
    auth: str = Field(min_length=22, max_length=22)
    label: str = Field(min_length=1, max_length=60)
    locale: Literal["en", "zh-CN"]
    detailed: bool = False


class DeviceView(BaseModel):
    id: UUID
    label: str
    detailed: bool
    enabled: bool
    last_success_at: datetime | None


class TestResult(BaseModel):
    provider_accepted: bool


def device_view(device: PushDevice) -> DeviceView:
    return DeviceView(
        id=device.id,
        label=device.label,
        detailed=device.detailed,
        enabled=device.enabled,
        last_success_at=device.last_success_at,
    )


@router.get("/config")
async def config() -> Configuration:
    return Configuration(vapid_public_key=public_key())


@router.get("")
async def feed(db: Database, history: bool = False) -> list[AlertView]:
    return await alert_feed(Repository(db), datetime.now(UTC), history)


@router.get("/intents/{intent_id}")
async def detail(intent_id: UUID, db: Database) -> IntentView:
    repo = Repository(db)
    intent = await get_intent(repo, intent_id)
    now = datetime.now(UTC)
    view = await intent_view(repo, intent, now)
    state = await repo.configuration()
    if state and reviewable(intent, state, now):
        reason = await current_block(repo, intent, state, now)
        if reason:
            view = view.model_copy(update={"risk_reason": reason})
    return view


@router.post("/intents/{intent_id}/opened", status_code=204)
async def record_open(intent_id: UUID, db: Database) -> None:
    await db.execute(
        update(IntentAlert)
        .where(IntentAlert.intent_id == intent_id, IntentAlert.opened_at.is_(None))
        .values(opened_at=datetime.now(UTC))
    )
    await db.commit()


@router.get("/devices")
async def devices(db: Database) -> list[DeviceView]:
    rows = await db.scalars(select(PushDevice).order_by(PushDevice.created_at.desc()))
    return [device_view(device) for device in rows]


@router.post("/devices")
async def subscribe(payload: Subscription, db: Database) -> DeviceView:
    if not public_key():
        raise problem("push_unavailable", status=503)
    try:
        endpoint = str(push_destination(payload.endpoint))
        validate_keys(payload.p256dh, payload.auth)
    except Exception:
        raise problem("invalid_subscription", status=422) from None
    await db.execute(text("SELECT pg_advisory_xact_lock(7852512918)"))
    device = await db.scalar(select(PushDevice).where(PushDevice.endpoint == endpoint))
    if device is None:
        if (await db.scalar(select(func.count()).select_from(PushDevice)) or 0) >= MAX_DEVICES:
            raise problem("device_limit")
        device = PushDevice(id=uuid4(), endpoint=endpoint, created_at=datetime.now(UTC))
        db.add(device)
    device.p256dh = payload.p256dh
    device.auth = payload.auth
    device.label = payload.label.strip() or "Browser"
    device.locale = payload.locale
    device.detailed = payload.detailed
    device.enabled = True
    await db.commit()
    return device_view(device)


@router.delete("/devices/{device_id}", status_code=204)
async def unsubscribe(device_id: UUID, db: Database) -> None:
    device = await db.get(PushDevice, device_id)
    if device:
        await db.delete(device)
        await db.commit()


@router.post("/devices/{device_id}/test")
async def test_notice(device_id: UUID, db: Database) -> TestResult:
    if not public_key():
        raise problem("push_unavailable", status=503)
    device = await db.get(PushDevice, device_id, with_for_update=True)
    now = datetime.now(UTC)
    if not device or not device.enabled:
        raise problem("push_device_unavailable", status=404)
    if device.last_test_at and device.last_test_at > now - timedelta(seconds=15):
        raise problem("push_test_rate_limited", status=429)
    device.last_test_at = now
    await db.commit()
    result = await send_push(
        device, push_payload(device, None), now + timedelta(seconds=25), "test"
    )
    if result in ("accepted", "invalid"):
        if result == "accepted":
            device.last_success_at = datetime.now(UTC)
        else:
            device.enabled = False
        await db.commit()
    return TestResult(provider_accepted=result == "accepted")
