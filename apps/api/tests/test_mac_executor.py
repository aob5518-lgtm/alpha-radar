from hashlib import sha256
from secrets import token_hex

import pytest
from fastapi.testclient import TestClient

from alpha_radar.config import get_settings
from alpha_radar.main import app

PATH = "/api/v1/event-semi-auto/mac-executor/observation"


def test_device_access_is_opt_in_read_only_and_separate_from_operator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token, operator, replacement = (token_hex(32) for _ in range(3))
    monkeypatch.setenv("EVENT_SEMI_AUTO_AVAILABLE", "true")
    monkeypatch.setenv("EVENT_SIGNAL_SHADOW_ENABLED", "true")
    monkeypatch.setenv("EVENT_SEMI_AUTO_OPERATOR_TOKEN", operator)
    monkeypatch.setenv("MAC_EXECUTOR_OBSERVE_ENABLED", "false")
    monkeypatch.setenv("MAC_EXECUTOR_DEVICE_TOKEN_SHA256", sha256(token.encode()).hexdigest())
    client = TestClient(app)
    get_settings.cache_clear()
    try:
        auth = {"Authorization": f"Bearer {token}"}
        response = client.get(PATH, headers=auth)
        assert response.status_code == 404
        assert response.headers["cache-control"] == "private, no-store"

        monkeypatch.setenv("MAC_EXECUTOR_OBSERVE_ENABLED", "true")
        get_settings.cache_clear()
        assert client.get(PATH).status_code == 401
        assert client.get(PATH, headers={"Authorization": f"Bearer {operator}"}).status_code == 401
        assert client.get("/api/v1/event-semi-auto", headers=auth).status_code == 401
        assert client.post(PATH, headers=auth).status_code == 405

        monkeypatch.setenv(
            "MAC_EXECUTOR_DEVICE_TOKEN_SHA256", sha256(replacement.encode()).hexdigest()
        )
        get_settings.cache_clear()
        response = client.get(PATH, headers=auth)
        assert response.status_code == 401
        assert response.headers["cache-control"] == "private, no-store"
    finally:
        get_settings.cache_clear()
