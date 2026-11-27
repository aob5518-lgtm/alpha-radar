from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from alpha_radar.config import get_settings
from alpha_radar.event_contracts.shadow_models import EventShadowSignal
from alpha_radar.event_contracts.shadow_rules import (
    PROXY,
    SETTLEMENT_VERSION,
    VERSION,
    Direction,
    State,
)
from alpha_radar.event_contracts.shadow_schemas import ShadowAssessment
from alpha_radar.event_simulator.models import SimulationSession
from alpha_radar.event_simulator.rules import (
    SimulationStats,
    cash_result,
    eligibility,
    frozen_assessment,
    performance,
    roll_day,
    stake_for,
)
from alpha_radar.event_simulator.schemas import Market, SessionStatus, SimulationSettings
from alpha_radar.event_simulator.service import open_bet, settle_bet
from alpha_radar.main import app

AT = datetime(2026, 11, 20, 15, 30, tzinfo=UTC)


def run(settings: SimulationSettings, status: SessionStatus = "running") -> SimulationSession:
    return SimulationSession(
        id=uuid4(),
        status=status,
        current_bankroll=settings.starting_bankroll,
        starting_bankroll=settings.starting_bankroll,
        max_bankroll=settings.starting_bankroll,
        max_drawdown=Decimal(0),
        accept_after=AT - timedelta(hours=1),
        day=AT.date(),
        day_start_bankroll=settings.starting_bankroll,
        stats=SimulationStats().model_dump(mode="json"),
        total_bets=0,
        settled_bets=0,
        risk_loss_count=0,
        cooldown_until=None,
    )


def signal(
    direction: Direction = "higher",
    state: State = "STRONG_HIGHER",
    score: int = 88,
    *,
    market: Market = "BTCUSDT",
    horizon: int = 10,
    cutoff: datetime = AT,
) -> tuple[EventShadowSignal, ShadowAssessment]:
    assessment = ShadowAssessment(
        state=state,
        direction=direction,
        score=score,
        reason="signal_recorded",
        as_of=cutoff,
        episode_at=cutoff - timedelta(minutes=5),
    )
    row = EventShadowSignal(
        id=uuid4(),
        market_instrument_id=uuid4(),
        reference_instrument_id=uuid4(),
        symbol=market,
        horizon_minutes=horizon,
        direction=direction,
        score=score,
        version=VERSION,
        settlement_version=SETTLEMENT_VERSION,
        episode_at=assessment.episode_at,
        confirmed_at=cutoff,
        generated_at=cutoff,
        expires_at=cutoff + timedelta(minutes=horizon),
        reference_price=Decimal(100),
        reference_source=PROXY,
        settlement_source=PROXY,
        assessment=assessment.model_dump(mode="json"),
        result="pending",
    )
    return row, assessment


@pytest.mark.parametrize(
    ("direction", "state", "score", "expected"),
    [
        ("higher", "STRONG_HIGHER", 85, "opened"),
        ("lower", "STRONG_LOWER", 85, "opened"),
        ("higher", "HIGHER", 84, "signal_not_strong"),
        ("lower", "LOWER", 84, "signal_not_strong"),
        ("higher", "WAIT", 80, "signal_not_strong"),
        ("higher", "STRONG_HIGHER", 84, "score_below_threshold"),
    ],
)
def test_default_signal_gate(direction: Direction, state: State, score: int, expected: str) -> None:
    settings = SimulationSettings()
    row, assessment = signal(direction, state, score)
    assert eligibility(run(settings), settings, row, assessment, [], AT) == expected


def test_advanced_threshold_and_frozen_identity() -> None:
    settings = SimulationSettings(allow_regular_signals=True, minimum_score=79)
    row, assessment = signal(state="HIGHER", score=80)
    assert eligibility(run(settings), settings, row, assessment, [], AT) == "opened"
    assert frozen_assessment(row) == assessment
    row.generated_at = AT - timedelta(seconds=1)
    assert frozen_assessment(row) is None
    waiting, _ = signal(state="WAIT")
    assert frozen_assessment(waiting) is None


def test_exposure_paused_stale_and_filter_gates() -> None:
    settings = SimulationSettings(markets=("BTCUSDT",), horizons=(10,))
    current = run(settings)
    row, assessment = signal()
    active = open_bet(current, settings, row, assessment, AT)
    assert eligibility(current, settings, row, assessment, [active], AT) == "existing_active_bet"
    eth, eth_assessment = signal(market="ETHUSDT")
    assert eligibility(current, settings, eth, eth_assessment, [], AT) == "market_disabled"
    thirty, thirty_assessment = signal(horizon=30)
    assert eligibility(current, settings, thirty, thirty_assessment, [], AT) == "horizon_disabled"
    assert (
        eligibility(current, settings, row, assessment, [], AT + timedelta(seconds=90))
        == "signal_expired"
    )
    current.status = "paused"
    assert eligibility(current, settings, row, assessment, [], AT) == "simulation_paused"
    current.status, current.accept_after = "running", AT + timedelta(seconds=1)
    assert eligibility(current, settings, row, assessment, [], AT) == "simulation_paused"


def test_exposure_isolated_by_canonical_instrument_and_horizon() -> None:
    settings = SimulationSettings()
    current = run(settings)
    row, assessment = signal()
    active = open_bet(current, settings, row, assessment, AT)
    eth, eth_assessment = signal(market="ETHUSDT")
    thirty, thirty_assessment = signal(horizon=30)
    thirty.market_instrument_id = row.market_instrument_id
    assert eligibility(current, settings, eth, eth_assessment, [active], AT) == "opened"
    assert eligibility(current, settings, thirty, thirty_assessment, [active], AT) == "opened"


def test_daily_budget_and_loss_cooldown() -> None:
    settings = SimulationSettings(max_consecutive_losses=1)
    current = run(settings)
    current.current_bankroll = Decimal(9500)
    row, assessment = signal()
    assert eligibility(current, settings, row, assessment, [], AT) == "daily_loss_limit"
    tomorrow = AT + timedelta(days=1)
    roll_day(current, tomorrow)
    assert current.day_start_bankroll == Decimal(9500)
    row, assessment = signal(cutoff=tomorrow)
    bet = open_bet(current, settings, row, assessment, tomorrow)
    expiry = row.expires_at
    row.settled_at, row.settled_price, row.result = expiry, Decimal(99), "loss"
    assert settle_bet(current, bet, row, expiry)
    next_row, next_assessment = signal(cutoff=expiry)
    assert eligibility(current, settings, next_row, next_assessment, [], expiry) == "cooldown"
    later = expiry + timedelta(minutes=60)
    next_row, next_assessment = signal(cutoff=later)
    assert eligibility(current, settings, next_row, next_assessment, [], later) == "opened"


def test_decimal_stakes_and_settings_bounds() -> None:
    assert stake_for(SimulationSettings(), Decimal("10000.09")) == Decimal("100.00")
    fixed = SimulationSettings(stake_mode="fixed", fixed_stake=Decimal("150.25"))
    assert stake_for(fixed, Decimal("10000")) == Decimal("150.25")
    assert stake_for(fixed, Decimal("1000.49")) == Decimal("20.00")
    assert cash_result(Decimal("100"), Decimal("1.80"), "win") == (Decimal(180), Decimal(80))
    assert cash_result(Decimal("0.03"), Decimal("1.80"), "win") == (Decimal(".05"), Decimal(".02"))
    with pytest.raises(ValidationError):
        SimulationSettings(stake_percent=Decimal("2.01"))
    with pytest.raises(ValidationError):
        SimulationSettings(markets=("BTCUSDT", "BTCUSDT"))


@pytest.mark.parametrize(
    ("direction", "price", "expected", "bankroll"),
    [
        ("higher", "101", "win", "10080"),
        ("higher", "99", "loss", "9900"),
        ("lower", "99", "win", "10080"),
        ("lower", "101", "loss", "9900"),
        ("higher", "100", "loss", "9900"),
        ("lower", "100", "loss", "9900"),
        ("higher", None, "void", "10000"),
    ],
)
def test_settlement_freeze_and_idempotency(
    direction: Direction,
    price: str | None,
    expected: str,
    bankroll: str,
) -> None:
    settings = SimulationSettings()
    current = run(settings)
    row, assessment = signal(
        direction, "STRONG_HIGHER" if direction == "higher" else "STRONG_LOWER"
    )
    bet = open_bet(current, settings, row, assessment, AT)
    row.reference_price = Decimal(500)
    row.assessment["score"] = 1
    settled_at = row.expires_at + (timedelta(hours=1) if price is None else timedelta())
    row.settled_at = settled_at
    row.settled_price = Decimal(price) if price else None
    row.result = "win" if price else "missing"
    assert not settle_bet(current, bet, row, AT + timedelta(minutes=5))
    assert settle_bet(current, bet, row, settled_at)
    assert not settle_bet(current, bet, row, settled_at)
    assert bet.reference_price == Decimal(100) and bet.assessment["score"] == 88
    assert bet.breakeven_probability == Decimal(".5555555556")
    assert bet.status == expected and current.current_bankroll == Decimal(bankroll)
    assert bet.bankroll_before == Decimal(10000) and bet.bankroll_after == current.current_bankroll


def test_analytic_profit_factor_peak_drawdown_and_streaks() -> None:
    settings = SimulationSettings(stake_mode="fixed")
    current = run(settings)
    for index, price in enumerate((Decimal(101), Decimal(99), Decimal(99))):
        at = AT + timedelta(minutes=index * 11)
        row, assessment = signal(cutoff=at)
        bet = open_bet(current, settings, row, assessment, at)
        stats = SimulationStats.model_validate(current.stats)
        stats.opened(bet)
        current.stats = stats.model_dump(mode="json")
        row.settled_at, row.settled_price, row.result = row.expires_at, price, "win"
        assert settle_bet(current, bet, row, row.expires_at)
    stats = SimulationStats.model_validate(current.stats)
    perf = performance(stats.overall, Decimal(10000))
    assert (perf.bets, perf.wins, perf.losses) == (3, 1, 2)
    assert perf.net_pnl == Decimal(-120)
    assert perf.profit_factor == Decimal(".4")
    assert perf.average_win == Decimal(80) and perf.average_loss == Decimal(100)
    assert perf.current_losing_streak == perf.max_losing_streak == 2
    assert current.max_bankroll == Decimal(10080)
    assert current.max_drawdown == Decimal(".0198412698")
    assert performance(SimulationStats().overall, Decimal(10000)).profit_factor is None


def test_public_writes_require_operator(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EVENT_SIMULATOR_ENABLED", "true")
    monkeypatch.setenv("EVENT_SIGNAL_SHADOW_ENABLED", "true")
    monkeypatch.setenv("EVENT_SIMULATOR_ADMIN_TOKEN", "test-only" * 5)
    get_settings.cache_clear()
    try:
        with TestClient(app) as client:
            for method in ("POST", "PATCH"):
                response = client.request(method, "/api/v1/event-simulator", json={})
                assert response.status_code == 401
                response = client.request(
                    method,
                    "/api/v1/event-simulator",
                    json={},
                    headers={"Authorization": "Bearer wrong"},
                )
                assert response.status_code == 401
    finally:
        get_settings.cache_clear()
