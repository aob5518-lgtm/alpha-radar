from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from alpha_radar.config import get_settings
from alpha_radar.event_contracts.shadow_rules import Direction
from alpha_radar.event_semi_auto.models import LiveIntent, RealBet, SemiAutoSettings
from alpha_radar.event_semi_auto.rules import (
    apply_loss,
    breakeven,
    drift,
    performance,
    returns,
    risk_block,
)
from alpha_radar.event_semi_auto.schemas import Confirm, Result, RiskSettings
from alpha_radar.main import app

AT = datetime(2026, 11, 28, 5, tzinfo=UTC)


@pytest.mark.parametrize("direction", ["higher", "lower"])
@pytest.mark.parametrize(("result", "net"), [("WIN", "8.01"), ("LOSS", "-10.01")])
def test_manual_pnl_for_both_directions(direction: Direction, result: Result, net: str) -> None:
    payload = Confirm(
        acknowledged=True,
        actual_open_at=AT,
        actual_open_price=Decimal(99),
        actual_expiry_at=AT + timedelta(minutes=10),
        actual_premium=Decimal("10.01"),
        actual_payout=Decimal("1.80"),
        direction=direction,
        horizon_minutes=10,
    )
    _, pnl = returns(payload.actual_premium, payload.actual_payout, result, None)
    assert pnl == Decimal(net)


def test_breakeven_explicit_tie_return_and_source_drift() -> None:
    assert breakeven(Decimal("1.80")) == Decimal(".5555555556")
    with pytest.raises(ValueError):
        returns(Decimal(10), Decimal("1.80"), "TIE", None)
    assert returns(Decimal(10), Decimal("1.80"), "TIE", Decimal(9)) == (Decimal(9), Decimal(-1))
    intent = LiveIntent(signal_reference_price=Decimal(100), signal_atr=Decimal(4))
    assert drift(intent, None) is None
    assert drift(intent, Decimal(101)) == Decimal(".25")
    assert drift(intent, Decimal("101.01")) == Decimal(".2525")


def test_real_risk_is_sign_sensitive_and_reserved() -> None:
    identity = uuid4()
    rules = RiskSettings(max_active_real_bets=2)
    state = SemiAutoSettings(enabled=True, killed=False, loss_count=0)
    assert (
        risk_block(state, rules, (identity, 10), [], Decimal(-41), Decimal(10), AT)
        == "daily_loss_limit"
    )
    assert risk_block(state, rules, (identity, 10), [], Decimal(-40), Decimal(10), AT) is None
    active = [
        RealBet(market_instrument_id=identity, horizon_minutes=10, actual_premium=Decimal(25))
    ]
    assert (
        risk_block(state, rules, (identity, 10), active, Decimal(0), Decimal(10), AT)
        == "existing_active_bet"
    )
    assert risk_block(state, rules, (identity, 30), active, Decimal(0), Decimal(10), AT) is None
    assert (
        risk_block(state, rules, (uuid4(), 10), active, Decimal(-20), Decimal(10), AT)
        == "daily_loss_limit"
    )
    assert risk_block(state, rules, (uuid4(), 10), [], Decimal(0), Decimal(26), AT) == "stake_limit"
    state.killed = True
    assert risk_block(state, rules, (identity, 10), [], Decimal(0), Decimal(10), AT) == "disabled"


def test_loss_cooldown_and_reported_performance() -> None:
    rules = RiskSettings()
    state = SemiAutoSettings(enabled=True, killed=False, loss_count=0)
    for status in ("LOSS", "TIE", "LOSS", "LOSS"):
        apply_loss(state, rules, status, AT)
    cooldown_end = AT + timedelta(minutes=120)
    assert state.cooldown_until == cooldown_end
    identity = (uuid4(), 30)
    assert risk_block(state, rules, identity, [], Decimal(0), Decimal(10), AT) == "cooldown"
    assert risk_block(state, rules, identity, [], Decimal(0), Decimal(10), cooldown_end) is None
    metrics = performance(
        [
            (status, Decimal(10), Decimal("1.8"), Decimal(pnl) if pnl else None)
            for status, pnl in [("WIN", "8"), ("LOSS", "-10"), ("LOSS", "-10"), ("OPEN", None)]
        ]
    )
    assert metrics.bets == 4
    assert metrics.win_rate == Decimal(".3333333333")
    assert metrics.net_pnl == Decimal(-12)
    assert metrics.return_on_premium == Decimal("-.4")
    assert metrics.max_drawdown == Decimal(20)
    assert metrics.max_losing_streak == 2


def test_bounds_and_private_read_and_write(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValidationError):
        RiskSettings(minimum_score=84)
    with pytest.raises(ValidationError):
        RiskSettings(fixed_stake=Decimal(30))
    token = "local-fixture-semi-operator-token-only"
    monkeypatch.setenv("EVENT_SEMI_AUTO_AVAILABLE", "true")
    monkeypatch.setenv("EVENT_SIGNAL_SHADOW_ENABLED", "true")
    monkeypatch.setenv("EVENT_SEMI_AUTO_OPERATOR_TOKEN", token)
    get_settings.cache_clear()
    try:
        client = TestClient(app)
        path = "/api/v1/event-semi-auto"
        assert client.get(path).status_code == 401
        assert (
            client.patch(path + "/settings", json={"action": "kill", "revision": None}).status_code
            == 401
        )
        bad = client.patch(
            path + "/settings",
            json={"action": "settings", "revision": None, "settings": {"fixed_stake": "30"}},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert bad.status_code == 422
        assert bad.json()["error"]["code"] == "invalid_request"
    finally:
        get_settings.cache_clear()
