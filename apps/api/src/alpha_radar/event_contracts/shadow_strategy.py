from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from math import sqrt
from typing import Literal
from uuid import UUID

from alpha_radar.event_contracts.shadow_rules import (
    EPISODE_LOOKBACK,
    FRESHNESS,
    OBSERVATION_MIN,
    ORDINARY_MIN,
    RSI_HIGH,
    RSI_LOW,
    RSI_RESET_HIGH,
    RSI_RESET_LOW,
    RULES,
    STRONG_MIN,
    WEIGHTS,
    WINDOW,
    Direction,
    HorizonRules,
    Reason,
    Regime,
    Result,
    State,
)
from alpha_radar.event_contracts.strategy import Horizon
from alpha_radar.market_data.constants import MarketInterval


@dataclass(frozen=True, slots=True)
class Candle:
    opened: datetime
    closed: datetime
    opening: float
    high: float
    low: float
    close: float
    volume: float | None
    confirmed: bool = True


@dataclass(frozen=True, slots=True)
class Series:
    instrument_id: UUID
    interval: MarketInterval
    candles: list[Candle]


@dataclass(frozen=True, slots=True)
class Evaluation:
    reason: Reason
    as_of: datetime | None = None
    state: State = "WAIT"
    direction: Direction | None = None
    score: int | None = None
    evidence: dict[str, bool] = field(default_factory=lambda: {})
    points: dict[str, int] = field(default_factory=lambda: {})
    features: dict[str, float] = field(default_factory=lambda: {})
    regime: Regime | None = None
    episode_at: datetime | None = None


def rsi_series(candles: list[Candle]) -> list[float]:
    changes = [right.close - left.close for left, right in zip(candles, candles[1:], strict=False)]
    gain = sum(max(change, 0) for change in changes[:14]) / 14
    loss = sum(max(-change, 0) for change in changes[:14]) / 14
    values = [50.0] * 14
    for i in range(13, len(changes)):
        if i >= 14:
            gain = (gain * 13 + max(changes[i], 0)) / 14
            loss = (loss * 13 + max(-changes[i], 0)) / 14
        values.append(100 * gain / (gain + loss) if gain + loss else 50.0)
    return values


def scale(candles: list[Candle]) -> float:
    window = candles[-15:]
    return (
        sum(
            max(bar.high - bar.low, abs(bar.high - prev.close), abs(bar.low - prev.close))
            for prev, bar in zip(window, window[1:], strict=False)
        )
        / 14
    )


def ema(closes: list[float], period: int) -> float:
    value = sum(closes[:period]) / period
    for closing in closes[period:]:
        value += (closing - value) * (2 / (period + 1))
    return value


def continuous(candles: list[Candle], minutes: int) -> bool:
    seconds = minutes * 60
    duration = timedelta(seconds=seconds)
    return all(
        bar.opened.timestamp() % seconds == 0 and bar.closed - bar.opened == duration
        for bar in candles
    ) and all(
        left.closed == right.opened for left, right in zip(candles, candles[1:], strict=False)
    )


def closed_window(series: Series, at: datetime) -> list[Candle]:
    return [bar for bar in series.candles if bar.confirmed and bar.closed <= at][-WINDOW:]


def proxy_result(direction: Direction, reference: Decimal, settled: Decimal) -> Result:
    if settled == reference:
        return "loss"
    return "win" if (settled > reference) == (direction == "higher") else "loss"


def evaluate(
    trigger: Series,
    context: Series,
    horizon: Horizon,
    *,
    instrument_id: UUID,
    now: datetime,
    macro_blocked: bool = False,
    reference_available: bool = True,
    snapshot_available: bool = True,
) -> Evaluation:
    rules = RULES[horizon]
    if (trigger.instrument_id, context.instrument_id, trigger.interval, context.interval) != (
        instrument_id,
        instrument_id,
        rules.trigger,
        rules.context,
    ):
        return Evaluation("identity_mismatch")
    bars = closed_window(trigger, now)
    at = bars[-1].closed if bars else None
    if len(bars) != WINDOW or at is None:
        return Evaluation("insufficient_history", at)
    if now - at > FRESHNESS:
        return Evaluation("stale_data", at)
    higher = closed_window(context, at)
    if len(higher) != WINDOW:
        return Evaluation("insufficient_history", at)
    expected_context_end = int(at.timestamp()) // (rules.context_minutes * 60)
    if (
        not continuous(bars, rules.trigger_minutes)
        or not continuous(higher, rules.context_minutes)
        or higher[-1].closed.timestamp() != expected_context_end * rules.context_minutes * 60
    ):
        return Evaluation("history_gap", at)
    if not reference_available or not snapshot_available:
        return Evaluation("reference_unavailable", at)
    if macro_blocked:
        return Evaluation("macro_event", at)
    if any(bar.volume is None for bar in bars[-24:]):
        return Evaluation("volume_unavailable", at)
    rsis = rsi_series(bars)
    extreme_indexes = range(len(bars) - 4, len(bars))
    candidates = [i for i in extreme_indexes if rsis[i] >= RSI_HIGH or rsis[i] <= RSI_LOW]
    if not candidates:
        return Evaluation("no_extreme", at)
    index = candidates[-1]
    side: Literal[1, -1] = 1 if rsis[index] >= RSI_HIGH else -1
    # The most stretched recent bar is measured against the preceding equilibrium.
    index = max(
        (i for i in candidates if (rsis[i] >= RSI_HIGH) == (side == 1)),
        key=lambda i: side * rsis[i],
    )
    return assess(bars, higher, rsis, index, side, rules)


def assess(
    bars: list[Candle],
    higher: list[Candle],
    rsis: list[float],
    index: int,
    side: Literal[1, -1],
    rules: HorizonRules,
) -> Evaluation:
    bar, extreme, previous = bars[-1], bars[index], bars[-2]
    prior = bars[index - 20 : index]
    atr = scale(bars[:index])
    closes = [item.close for item in prior]
    average = sum(closes) / len(closes)
    deviation = sqrt(sum((price - average) ** 2 for price in closes) / len(closes))
    volumes = [item.volume or 0 for item in prior]
    total_volume = sum(volumes)
    if atr <= 0 or total_volume <= 0:
        return Evaluation("volume_unavailable" if total_volume <= 0 else "no_extreme", bar.closed)
    vwap = (
        sum(
            volume * (item.high + item.low + item.close) / 3
            for item, volume in zip(prior, volumes, strict=False)
        )
        / total_volume
    )
    stretched = (
        max(item.high for item in bars[index:])
        if side == 1
        else min(item.low for item in bars[index:])
    )
    z = side * (stretched - average) / deviation if deviation else 0.0
    vwap_distance = side * (stretched - vwap) / atr
    impulse = side * (stretched - bars[index - 3].close) / atr
    band = z >= rules.z_min
    vwap_far = vwap_distance >= rules.vwap_atr_min
    extended = impulse >= rules.impulse_atr_min

    preceding = bars[index - 12 : index - 3]
    local_edge = (
        max(item.high for item in preceding) if side == 1 else min(item.low for item in preceding)
    )
    extreme_edge = extreme.high if side == 1 else extreme.low
    current_edge = bar.high if side == 1 else bar.low
    rsi_divergence = (
        index < len(bars) - 1
        and side * (current_edge - extreme_edge) >= 0
        and side * (rsis[index] - rsis[-1]) >= 3
    )
    deceleration = (
        index < len(bars) - 1
        and side * (rsis[index] - rsis[-1]) >= 4
        and side * (extreme.close - bar.close) >= 0.25 * atr
    )
    extreme_volume = (extreme.volume or 0) / (total_volume / len(prior))
    climax = extreme_volume >= rules.volume_multiple
    no_follow_through = (
        climax
        and index < len(bars) - 1
        and (
            (bar.volume or 0) <= 0.75 * (extreme.volume or 0)
            and side * (bar.close - extreme.close) < 0
        )
    )

    candle_range = bar.high - bar.low
    wick = side * (
        current_edge - (max(bar.opening, bar.close) if side == 1 else min(bar.opening, bar.close))
    )
    wick_rejection = candle_range > 0 and wick / candle_range >= rules.wick_fraction
    band_reentry = band and side * (bar.close - average) < rules.z_min * deviation
    failed_break = side * (stretched - local_edge) > 0 and side * (bar.close - local_edge) < 0
    reverse_body = candle_range > 0 and (
        side * (bar.opening - bar.close) > 0
        and side * (current_edge - bar.close) / candle_range >= rules.reversal_fraction
    )
    rejection_count = sum((wick_rejection, band_reentry, failed_break))
    rejection = reverse_body and rejection_count >= rules.minimum_rejections

    # Causal context from already closed native candles and observed range edges.
    # These edges are context for this experiment, with no new Chart level engine.
    env = higher[-13:-1]
    env_edge = max(item.high for item in env) if side == 1 else min(item.low for item in env)
    near_structure = abs(stretched - env_edge) <= rules.structure_atr * scale(higher)
    env_closes = [item.close for item in higher]
    fast, slow = ema(env_closes, 20), ema(env_closes, 50)
    env_atr = scale(higher)
    old, new = higher[-7:-4], higher[-4:-1]
    same_direction_structure = (
        side * (max(x.high for x in new) - max(x.high for x in old)) > 0
        and side * (min(x.low for x in new) - min(x.low for x in old)) > 0
    )
    displacement = (fast - slow) / env_atr if env_atr else 0.0
    slope = (fast - ema(env_closes[:-4], 20)) / env_atr if env_atr else 0.0
    strong = abs(displacement) >= 0.75 and abs(slope) >= 0.35 and displacement * slope > 0
    trend_conflict = strong and side * slope > 0 and same_direction_structure
    acceleration = side * (bar.close - previous.close) > 0.35 * atr
    exhausted = rsi_divergence or deceleration or no_follow_through
    regime: Regime = (
        "reversal"
        if failed_break and rejection
        else "strong_trend"
        if strong
        else "weak_trend"
        if abs(displacement) > 0.25
        else "ranging"
    )
    points = {
        "extreme": min(WEIGHTS["extreme"], 10 + 6 * band + 5 * vwap_far + 4 * extended),
        "exhaustion": min(
            WEIGHTS["exhaustion"], 10 * rsi_divergence + 10 * deceleration + 8 * no_follow_through
        ),
        "rejection": min(
            WEIGHTS["rejection"],
            8 * reverse_body + 5 * wick_rejection + 5 * band_reentry + 7 * failed_break,
        ),
        "structure": min(WEIGHTS["structure"], 9 * near_structure + 6 * failed_break),
        "volume": min(WEIGHTS["volume"], 6 * climax + 4 * no_follow_through),
        "regime": 2 if trend_conflict else 7 if strong else WEIGHTS["regime"],
    }
    raw_score = sum(points.values())
    evidence = {
        "rsi_extreme": True,
        "bollinger_extreme": band,
        "vwap_extension": vwap_far,
        "atr_impulse": extended,
        "rsi_divergence": rsi_divergence,
        "momentum_deceleration": deceleration,
        "volume_exhaustion": no_follow_through,
        "wick_rejection": wick_rejection,
        "band_reentry": band_reentry,
        "failed_breakout": failed_break,
        "reversal_body": reverse_body,
        "near_structure": near_structure,
        "volume_climax": climax,
        "trend_conflict": trend_conflict,
        "acceleration": acceleration,
    }
    features = {
        "extreme_rsi": round(rsis[index], 6),
        "current_rsi": round(rsis[-1], 6),
        "bollinger_z": round(z, 6),
        "vwap_distance_atr": round(vwap_distance, 6),
        "impulse_atr": round(impulse, 6),
        "volume_multiple": round(extreme_volume, 6),
        "context_ema_spread_atr": round(displacement, 6),
        "context_ema_slope_atr": round(slope, 6),
    }
    resets = [
        i
        for i in range(len(bars) - EPISODE_LOOKBACK, index)
        if (RSI_RESET_LOW <= rsis[i] <= RSI_RESET_HIGH or side * (rsis[i] - 50) <= -20)
    ]
    if not (band or vwap_far or extended):
        reason: Reason = "no_extreme"
    elif trend_conflict and (acceleration or not rejection or not exhausted):
        reason = "trend_conflict"
    elif not rejection or acceleration:
        reason = "no_rejection"
    elif raw_score < OBSERVATION_MIN:
        reason = "insufficient_score"
    elif raw_score < ORDINARY_MIN:
        reason = "observation_only"
    elif not resets:
        reason = "episode_unanchored"
    else:
        reason = "signal_recorded"

    direction: Direction = "lower" if side == 1 else "higher"
    state: State = "WAIT"
    if reason == "signal_recorded":
        if raw_score >= STRONG_MIN and exhausted and not trend_conflict:
            state = "STRONG_LOWER" if side == 1 else "STRONG_HIGHER"
        else:
            state = "LOWER" if side == 1 else "HIGHER"
    return Evaluation(
        reason,
        bar.closed,
        state,
        direction if state != "WAIT" or reason == "observation_only" else None,
        raw_score,
        evidence,
        points,
        features,
        regime,
        bars[resets[-1]].closed if resets else None,
    )
