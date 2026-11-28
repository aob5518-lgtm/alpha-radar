from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from alpha_radar.event_contracts.strategy import Horizon, utc
from alpha_radar.event_semi_auto.models import LiveIntent, RealBet, SemiAutoSettings
from alpha_radar.event_semi_auto.schemas import Metrics, Result, RiskSettings

PENDING = ("PENDING_REVIEW", "APPROVED_BY_USER")
TTL: dict[Horizon, timedelta] = {10: timedelta(seconds=60), 30: timedelta(seconds=120)}
RATIO = Decimal(".0000000001")
CENT = Decimal(".01")


def breakeven(multiplier: Decimal) -> Decimal:
    return (Decimal(1) / multiplier).quantize(RATIO)


def drift(intent: LiveIntent, observed: Decimal | None) -> Decimal | None:
    if observed is None or not intent.signal_atr or intent.signal_atr <= 0:
        return None
    return (abs(observed - intent.signal_reference_price) / intent.signal_atr).quantize(RATIO)


def risk_block(
    state: SemiAutoSettings,
    settings: RiskSettings,
    identity: tuple[object, int],
    active: list[RealBet],
    daily_pnl: Decimal,
    stake: Decimal,
    now: datetime,
) -> str | None:
    if not state.enabled or state.killed:
        return "disabled"
    if state.cooldown_until and now < utc(state.cooldown_until):
        return "cooldown"
    if any((bet.market_instrument_id, bet.horizon_minutes) == identity for bet in active):
        return "existing_active_bet"
    if len(active) >= settings.max_active_real_bets:
        return "max_active_bets"
    reserved = sum((bet.actual_premium for bet in active), Decimal(0))
    if stake > settings.max_stake:
        return "stake_limit"
    if reserved + stake > settings.max_daily_loss + min(Decimal(0), daily_pnl):
        return "daily_loss_limit"
    return None


def apply_loss(
    state: SemiAutoSettings, settings: RiskSettings, result: Result, now: datetime
) -> None:
    if result == "WIN":
        state.loss_count = 0
    if result == "LOSS" and (not state.cooldown_until or now >= utc(state.cooldown_until)):
        state.loss_count += 1
        if state.loss_count >= settings.max_consecutive_losses:
            state.loss_count = 0
            state.cooldown_until = now + timedelta(minutes=settings.cooldown_minutes)


def returns(
    premium: Decimal, payout: Decimal, result: Result, exception_return: Decimal | None
) -> tuple[Decimal, Decimal]:
    if result == "WIN":
        gross = (premium * payout).quantize(CENT, rounding=ROUND_HALF_UP)
    elif result == "LOSS":
        gross = Decimal(0)
    elif exception_return is not None:
        gross = exception_return
    else:
        raise ValueError("The operator must enter the actual return for a tie or cancellation.")
    return gross, gross - premium


def performance(
    rows: list[tuple[str, Decimal, Decimal, Decimal | None]],
) -> Metrics:
    if not rows:
        return Metrics()
    wins = losses = streak = max_streak = 0
    premium = count_payout = resolved_premium = pnl = peak = drawdown = Decimal(0)
    for status, stake, payout, net in rows:
        premium += stake
        count_payout += payout
        if net is None:
            continue
        resolved_premium += stake
        pnl += net
        peak = max(peak, pnl)
        drawdown = max(drawdown, peak - pnl)
        if status == "WIN":
            wins += 1
            streak = 0
        elif status == "LOSS":
            losses += 1
            streak += 1
            max_streak = max(max_streak, streak)
    return Metrics(
        bets=len(rows),
        wins=wins,
        losses=losses,
        win_rate=(Decimal(wins) / (wins + losses)).quantize(RATIO) if wins + losses else None,
        net_pnl=pnl,
        return_on_premium=(pnl / resolved_premium).quantize(RATIO) if resolved_premium else None,
        max_drawdown=drawdown,
        max_losing_streak=max_streak,
        average_payout=(count_payout / len(rows)).quantize(RATIO),
        average_premium=(premium / len(rows)).quantize(CENT, rounding=ROUND_HALF_UP),
    )
