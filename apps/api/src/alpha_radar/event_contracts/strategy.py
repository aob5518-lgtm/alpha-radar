from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

VERSION = "event-contract-direction-v1"
Horizon = Literal[10, 30]
Direction = Literal["up", "down", "wait", "unavailable"]
Reason = Literal[
    "trend_pullback_confirmed",
    "insufficient_history",
    "history_gap",
    "stale_data",
    "mixed_trend",
    "choppy",
    "no_retest",
    "no_confirmation",
    "overextended",
    "opposing_barrier",
    "macro_event",
    "macro_date_uncertain",
    "episode_already_seen",
    "disabled",
    "provider_unavailable",
    "signal_expired",
    "observation_in_progress",
]


@dataclass(frozen=True)
class Rules:
    """Frozen research hypotheses, not fitted parameters or production Chart thresholds."""

    history_minutes: int = 1200
    feature_bars: int = 60
    fast_ma: int = 20
    slow_ma: int = 50
    atr_period: int = 14
    slope_bars: int = 5
    slope_atr: Decimal = Decimal("0.15")
    zone_atr: Decimal = Decimal("0.20")
    chase_atr: Decimal = Decimal("1")
    barrier_atr: Decimal = Decimal("0.75")
    shock_atr: Decimal = Decimal("2.5")
    good_close: Decimal = Decimal("0.65")
    freshness_seconds: int = 90
    signal_ttl_seconds: int = 60


RULES = Rules()


class Bar(BaseModel):
    model_config = ConfigDict(frozen=True)

    open_time: AwareDatetime
    close_time: AwareDatetime
    open: Decimal = Field(gt=0)
    high: Decimal = Field(gt=0)
    low: Decimal = Field(gt=0)
    close: Decimal = Field(gt=0)
    is_closed: bool = True

    @model_validator(mode="after")
    def validate_bar(self) -> Bar:
        if self.close_time - self.open_time <= timedelta(0):
            raise ValueError("Candle time order is invalid")
        if self.high < max(self.open, self.close) or self.low > min(self.open, self.close):
            raise ValueError("Candle OHLC bounds are invalid")
        return self


class Assessment(BaseModel):
    model_config = ConfigDict(frozen=True)

    version: str = VERSION
    horizon_minutes: Horizon
    direction: Direction
    reasons: list[Reason]
    confirmed_at: datetime | None = None
    reference_price: Decimal | None = None
    zone_low: Decimal | None = None
    zone_high: Decimal | None = None
    episode_key: str | None = None
    input_sha256: str | None = None
    environment_interval: Literal["5m", "15m"]
    trigger_interval: Literal["1m", "5m"]
    features: dict[str, str] = Field(default_factory=dict)


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def ema(values: list[Decimal], period: int) -> list[Decimal | None]:
    result: list[Decimal | None] = [None] * len(values)
    if len(values) < period:
        return result
    current = sum(values[:period], Decimal(0)) / period
    result[period - 1] = current
    alpha = Decimal(2) / (period + 1)
    for index in range(period, len(values)):
        current += alpha * (values[index] - current)
        result[index] = current
    return result


def atr(bars: list[Bar]) -> list[Decimal | None]:
    ranges = [bars[0].high - bars[0].low] if bars else []
    for index in range(1, len(bars)):
        bar, previous = bars[index], bars[index - 1]
        ranges.append(
            max(bar.high - bar.low, abs(bar.high - previous.close), abs(bar.low - previous.close))
        )
    result: list[Decimal | None] = [None] * len(bars)
    period = RULES.atr_period
    if len(bars) < period:
        return result
    current = sum(ranges[:period], Decimal(0)) / period
    result[period - 1] = current
    for index in range(period, len(bars)):
        current = (current * (period - 1) + ranges[index]) / period
        result[index] = current
    return result


def aggregate(bars: list[Bar], minutes: int) -> list[Bar]:
    """UTC-aligned complete groups only; no synthetic or partially observed candles."""
    groups: dict[int, list[Bar]] = {}
    seconds = minutes * 60
    for bar in bars:
        bucket = int(bar.open_time.timestamp()) // seconds * seconds
        groups.setdefault(bucket, []).append(bar)
    result: list[Bar] = []
    for bucket, group in sorted(groups.items()):
        start = datetime.fromtimestamp(bucket, UTC)
        if len(group) != minutes or any(
            bar.open_time != start + timedelta(minutes=i) for i, bar in enumerate(group)
        ):
            continue
        result.append(
            Bar(
                open_time=start,
                close_time=start + timedelta(minutes=minutes),
                open=group[0].open,
                high=max(bar.high for bar in group),
                low=min(bar.low for bar in group),
                close=group[-1].close,
            )
        )
    return result


def classify(
    history: list[Bar],
    horizon: Horizon,
    *,
    as_of: datetime,
    macro_blocked: bool = False,
    macro_date_uncertain: bool = False,
    prepared: tuple[list[Bar], list[Bar]] | None = None,
) -> Assessment:
    environment_minutes, trigger_minutes = (5, 1) if horizon == 10 else (15, 5)
    base: dict[str, object] = {
        "horizon_minutes": horizon,
        "environment_interval": f"{environment_minutes}m",
        "trigger_interval": f"{trigger_minutes}m",
    }

    def result(direction: Direction, reason: Reason, **values: object) -> Assessment:
        return Assessment.model_validate(
            {**base, "direction": direction, "reasons": [reason], **values}
        )

    # Never let future/partial input participate, including future extrema/pivots.
    bars = sorted(
        (bar for bar in history if bar.is_closed and bar.close_time <= as_of),
        key=lambda bar: bar.open_time,
    )[-RULES.history_minutes :]
    if not bars:
        return result("unavailable", "insufficient_history")
    last = bars[-1]
    base.update(confirmed_at=last.close_time, reference_price=last.close)
    if as_of - last.close_time > timedelta(seconds=RULES.freshness_seconds):
        return result("unavailable", "stale_data")
    if any(bar.close_time - bar.open_time != timedelta(minutes=1) for bar in bars) or any(
        right.open_time != left.close_time for left, right in zip(bars, bars[1:], strict=False)
    ):
        return result("unavailable", "history_gap")
    trigger, environment = (
        prepared
        if prepared is not None
        else (aggregate(bars, trigger_minutes), aggregate(bars, environment_minutes))
    )
    # Prepared audit inputs are still bounded causally and use the same fixed seed windows.
    trigger = [bar for bar in trigger if bar.close_time <= as_of][-RULES.feature_bars :]
    environment = [bar for bar in environment if bar.close_time <= as_of][-RULES.feature_bars :]
    if min(len(trigger), len(environment)) < RULES.feature_bars:
        return result("unavailable", "insufficient_history")
    if macro_blocked or macro_date_uncertain:
        return result("wait", "macro_event" if macro_blocked else "macro_date_uncertain")
    closes = [bar.close for bar in environment]
    fast = ema(closes, RULES.fast_ma)
    slow = ema(closes, RULES.slow_ma)[-1]
    env_atr = atr(environment)[-1]
    current_fast, previous_fast = fast[-1], fast[-1 - RULES.slope_bars]
    assert slow is not None and current_fast is not None and previous_fast is not None
    if env_atr is None or env_atr <= 0:
        return result("wait", "mixed_trend")
    slope = (current_fast - previous_fast) / env_atr
    sign = (
        1
        if closes[-1] > current_fast > slow and slope >= RULES.slope_atr
        else (-1 if closes[-1] < current_fast < slow and slope <= -RULES.slope_atr else 0)
    )
    if not sign:
        return result("wait", "mixed_trend")
    ma = ema([bar.close for bar in trigger], RULES.fast_ma)
    volatility = atr(trigger)
    center, scale = ma[-1], volatility[-1]
    assert center is not None and scale is not None
    if scale <= 0:
        return result("wait", "mixed_trend")
    low, high = center - RULES.zone_atr * scale, center + RULES.zone_atr * scale
    base.update(
        zone_low=low,
        zone_high=high,
        features={
            "environment_ema20": str(current_fast),
            "environment_ema50": str(slow),
            "environment_slope_atr": str(slope),
            "trigger_ema20": str(center),
            "trigger_atr14": str(scale),
        },
    )
    sides = [
        1 if bar.close > value else -1 if bar.close < value else 0
        for bar, value in zip(trigger[-12:], ma[-12:], strict=False)
        if value is not None
    ]
    nonzero = [side for side in sides if side]
    if sum(a != b for a, b in zip(nonzero, nonzero[1:], strict=False)) >= 3:
        return result("wait", "choppy")
    final, previous = trigger[-1], trigger[-2]
    if max(bar.high - bar.low for bar in trigger[-3:]) > RULES.shock_atr * scale:
        return result("wait", "overextended")
    if abs(final.close - center) > RULES.chase_atr * scale:
        return result("wait", "overextended")
    touches: list[int] = []
    for index in range(len(trigger) - 12, len(trigger)):
        point, width = ma[index], volatility[index]
        if (
            point is not None
            and width is not None
            and (
                trigger[index].low <= point + RULES.zone_atr * width
                and trigger[index].high >= point - RULES.zone_atr * width
            )
        ):
            touches.append(index)
    recent = [index for index in touches if index >= len(trigger) - 3]
    if not recent:
        return result("wait", "no_retest")
    if len(touches) > 4:
        return result("wait", "choppy")
    span = final.high - final.low
    closes_well = span > 0 and (
        (final.close - final.low) / span >= RULES.good_close
        if sign == 1
        else (final.high - final.close) / span >= RULES.good_close
    )
    confirms = (
        final.close > final.open and final.close > high and final.close > previous.high
        if sign == 1
        else final.close < final.open and final.close < low and final.close < previous.low
    )
    if not confirms or not closes_well:
        return result("wait", "no_confirmation")
    # Observed confirmed swing extrema only. This does not modify or impersonate Chart S1/R1.
    barriers: list[Decimal] = []
    for index in range(3, len(trigger) - 3):
        window = trigger[index - 3 : index + 4]
        point = trigger[index].high if sign == 1 else trigger[index].low
        extreme = max(bar.high for bar in window) if sign == 1 else min(bar.low for bar in window)
        if point == extreme and sign * (point - final.close) > 0:
            barriers.append(sign * (point - final.close))
    if barriers and min(barriers) < RULES.barrier_atr * scale:
        return result("wait", "opposing_barrier")
    start = recent[-1]
    while start - 1 in touches:
        start -= 1
    episode = f"{sign}:{trigger[start].open_time.isoformat()}"
    fingerprint = hashlib.sha256(
        json.dumps(
            [bar.model_dump(mode="json") for bar in bars],
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    return result(
        "up" if sign == 1 else "down",
        "trend_pullback_confirmed",
        episode_key=episode,
        input_sha256=fingerprint,
    )


def break_even_probability(net_payout_ratio: Decimal) -> Decimal:
    if not net_payout_ratio.is_finite() or net_payout_ratio <= 0:
        raise ValueError("A positive net payout ratio is required")
    return Decimal(1) / (Decimal(1) + net_payout_ratio)
