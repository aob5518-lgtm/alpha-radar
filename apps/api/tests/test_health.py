from datetime import datetime

from fastapi.testclient import TestClient

from alpha_radar.config import Settings
from alpha_radar.health import (
    DependencyStatus,
    MarketOperationalStatus,
    bybit_operational_status,
    operationally_ready,
)
from alpha_radar.main import app
from alpha_radar.market_data.constants import MarketInterval


def test_health_returns_ok() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-request-id"]


def test_production_readiness_rejects_mock_or_disabled_market_data() -> None:
    dependencies = DependencyStatus(database=True, redis=True)
    history: dict[str, datetime | None] = {
        interval: None for interval in ("1m", "5m", "15m", "1h", "4h", "1d", "1w")
    }
    mock = MarketOperationalStatus("mock", False, history, False)
    production = Settings(app_env="production")
    development = Settings(app_env="development")

    assert operationally_ready(dependencies, mock, development)
    assert not operationally_ready(dependencies, mock, production)

    real = MarketOperationalStatus("coinbase", True, history, True)
    assert operationally_ready(dependencies, real, production)


def test_bybit_readiness_requires_three_core_contracts_across_all_intervals() -> None:
    now = datetime(2026, 10, 3, 12, 0).astimezone()
    settings = Settings(
        app_env="production",
        market_data_provider="bybit",
        market_data_ingestion_enabled=True,
    )
    rows = [
        (symbol, interval, now)
        for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT")
        for interval in MarketInterval
    ]
    ready = bybit_operational_status(settings, rows, now=now)
    missing_one = bybit_operational_status(settings, rows[:-1], now=now)

    assert ready.history_current is True
    assert len(ready.history_latest) == 21
    assert missing_one.history_current is False
