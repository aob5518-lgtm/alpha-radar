from datetime import UTC, datetime, timedelta
from uuid import uuid4

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from alpha_radar.config import get_settings
from alpha_radar.event_semi_auto.alert_models import PushDevice
from alpha_radar.event_semi_auto.alerts import push_payload, reviewable
from alpha_radar.event_semi_auto.models import LiveIntent, SemiAutoSettings
from alpha_radar.event_semi_auto.push import key_string, push_destination
from alpha_radar.main import app

AT = datetime(2026, 11, 28, 12, tzinfo=UTC)


def identity() -> tuple[LiveIntent, SemiAutoSettings]:
    state = SemiAutoSettings(enabled=True, killed=False, revision=uuid4())
    intent = LiveIntent(
        id=uuid4(),
        symbol="BTCUSDT",
        horizon_minutes=10,
        direction="higher",
        status="PENDING_REVIEW",
        execution_status="RISK_APPROVED",
        signal_state="STRONG_HIGHER",
        signal_score=95,
        settings_revision=state.revision,
        expires_at=AT + timedelta(seconds=60),
    )
    return intent, state


def test_reviewable_follows_intent_status_and_current_config() -> None:
    intent, state = identity()
    assert reviewable(intent, state, AT)
    assert not reviewable(intent, state, intent.expires_at)
    for state_name in ("WAIT", "HIGHER", "LOWER"):
        intent.signal_state = state_name
        assert not reviewable(intent, state, AT)
    intent.signal_state = "STRONG_HIGHER"
    intent.status = "CANCELLED_BY_RISK"
    assert not reviewable(intent, state, AT)
    intent.status = "PENDING_REVIEW"
    state.killed = True
    assert not reviewable(intent, state, AT)
    state.killed = False
    state.revision = uuid4()
    assert not reviewable(intent, state, AT)


@pytest.mark.parametrize(
    "url",
    [
        "http://fcm.googleapis.com/fcm/send/a",
        "https://fcm.googleapis.com.attacker.test/fcm/send/a",
        "https://fcm.googleapis.com@127.0.0.1/fcm/send/a",
        "https://x@fcm.googleapis.com/fcm/send/a",
        "https://fcm.googleapis.com:8443/fcm/send/a",
        "https://fcm.googleapis.com/fcm/send/../a",
        "https://fcm.googleapis.com/fcm/send/a?secret=x",
        "https://web.push.apple.com/",
    ],
)
def test_push_does_not_accept_arbitrary_destinations(url: str) -> None:
    with pytest.raises((ValueError, httpx.InvalidURL)):
        push_destination(url)


def test_payload_minimizes_lock_screen_details_and_test_has_no_intent() -> None:
    intent, _ = identity()
    device = PushDevice(locale="zh-CN", detailed=False)
    data = push_payload(device, intent)
    assert set(data) == {"title", "body", "intent", "expires"}
    assert data["intent"] == str(intent.id)
    assert "BTC" not in data["body"]
    device.detailed = True
    assert "BTCUSDT" in push_payload(device, intent)["body"]
    assert push_payload(device, None) == {
        "title": "ALPHA RADAR",
        "body": "测试提醒 · 非真实策略信号",
        "test": "true",
    }


def test_alert_routes_require_operator_and_only_return_public_vapid_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token = "disposable-token-for-alert-test-only"
    for name in (
        "EVENT_ALERTS_ENABLED",
        "EVENT_SEMI_AUTO_AVAILABLE",
        "EVENT_SIGNAL_SHADOW_ENABLED",
        "EVENT_PUSH_ENABLED",
    ):
        monkeypatch.setenv(name, "true")
    private = ec.generate_private_key(ec.SECP256R1())
    secret = key_string(private.private_numbers().private_value.to_bytes(32))
    public = key_string(
        private.public_key().public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
    )
    monkeypatch.setenv("EVENT_SEMI_AUTO_OPERATOR_TOKEN", token)
    monkeypatch.setenv("WEB_PUSH_VAPID_PRIVATE_KEY", secret)
    monkeypatch.setenv("WEB_PUSH_VAPID_PUBLIC_KEY", public)
    monkeypatch.setenv("WEB_PUSH_VAPID_SUBJECT", "https://alpha-radar.example")
    get_settings.cache_clear()
    try:
        client = TestClient(app)
        base = "/api/v1/event-semi-auto/alerts"
        assert client.get(base).status_code == 401
        assert client.get(base + "/devices").status_code == 401
        assert client.post(base + "/devices", json={}).status_code == 401
        assert client.delete(base + f"/devices/{uuid4()}").status_code == 401
        assert client.post(base + f"/devices/{uuid4()}/test", json={}).status_code == 401
        response = client.get(base + "/config", headers={"Authorization": f"Bearer {token}"})
        assert response.json() == {"vapid_public_key": public}
        assert response.headers["cache-control"] == "private, no-store"
        assert secret not in response.text and token not in response.text
    finally:
        get_settings.cache_clear()
