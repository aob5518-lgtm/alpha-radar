from dataclasses import dataclass
from datetime import timedelta
from typing import Literal
from uuid import UUID

from alpha_radar.event_contracts.strategy import Horizon
from alpha_radar.market_data.constants import MarketInterval

VERSION = "event-signal-v1"
SETTLEMENT_VERSION = "event-shadow-v1"
PROXY = "binance_index_minute_close_proxy"
WINDOW = 80
EPISODE_LOOKBACK = 40
FRESHNESS = timedelta(seconds=90)
MACRO_WINDOW = timedelta(minutes=30)
MISSING_AFTER = timedelta(hours=1)
SYMBOLS = ("BTCUSDT", "ETHUSDT")
HORIZONS: tuple[Horizon, ...] = (10, 30)

Direction = Literal["higher", "lower"]
State = Literal["STRONG_HIGHER", "HIGHER", "WAIT", "LOWER", "STRONG_LOWER"]
Regime = Literal["ranging", "weak_trend", "strong_trend", "reversal"]
Result = Literal["pending", "win", "loss", "missing"]
Reason = Literal[
    "identity_mismatch",
    "insufficient_history",
    "history_gap",
    "stale_data",
    "reference_unavailable",
    "volume_unavailable",
    "macro_event",
    "no_extreme",
    "no_rejection",
    "trend_conflict",
    "insufficient_score",
    "observation_only",
    "episode_unanchored",
    "episode_already_seen",
    "signal_recorded",
    "warming_up",
    "disabled",
]


@dataclass(frozen=True, slots=True)
class HorizonRules:
    trigger: MarketInterval
    context: MarketInterval
    trigger_minutes: int
    context_minutes: int
    z_min: float
    vwap_atr_min: float
    impulse_atr_min: float
    wick_fraction: float
    reversal_fraction: float
    structure_atr: float
    volume_multiple: float
    minimum_rejections: int


RULES: dict[Horizon, HorizonRules] = {
    10: HorizonRules(
        MarketInterval.ONE_MINUTE,
        MarketInterval.FIVE_MINUTES,
        1,
        5,
        1.8,
        1.2,
        1.4,
        0.32,
        0.55,
        0.70,
        1.7,
        1,
    ),
    30: HorizonRules(
        MarketInterval.FIVE_MINUTES,
        MarketInterval.FIFTEEN_MINUTES,
        5,
        15,
        2.0,
        1.4,
        1.6,
        0.35,
        0.60,
        0.55,
        1.9,
        2,
    ),
}

RSI_HIGH = 70
RSI_LOW = 30
RSI_RESET_LOW = 45
RSI_RESET_HIGH = 55
ORDINARY_MIN = 75
OBSERVATION_MIN = 65
STRONG_MIN = 85
WEIGHTS = {
    "extreme": 25,
    "exhaustion": 20,
    "rejection": 20,
    "structure": 15,
    "volume": 10,
    "regime": 10,
}


def snapshot_key(instrument_id: UUID, horizon: Horizon) -> str:
    return f"alpha-radar:{VERSION}:{instrument_id}:{horizon}"
