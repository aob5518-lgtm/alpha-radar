from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import timedelta


class MarketInterval(str, enum.Enum):
    ONE_MINUTE = "1m"
    ONE_HOUR = "1h"
    ONE_DAY = "1d"


@dataclass(frozen=True)
class IntervalDefinition:
    duration: timedelta
    max_query_range: timedelta
    coinbase_granularity: int


INTERVAL_DEFINITIONS: dict[MarketInterval, IntervalDefinition] = {
    MarketInterval.ONE_MINUTE: IntervalDefinition(
        duration=timedelta(minutes=1),
        max_query_range=timedelta(days=7),
        coinbase_granularity=60,
    ),
    MarketInterval.ONE_HOUR: IntervalDefinition(
        duration=timedelta(hours=1),
        max_query_range=timedelta(days=366),
        coinbase_granularity=3600,
    ),
    MarketInterval.ONE_DAY: IntervalDefinition(
        duration=timedelta(days=1),
        max_query_range=timedelta(days=3650),
        coinbase_granularity=86400,
    ),
}

MAX_HISTORY_LIMIT = 1000
COINBASE_MAX_CANDLES_PER_REQUEST = 300


class QualityFlag(str, enum.Enum):
    STALE = "stale"
    MISSING_FIELDS = "missing_fields"
    ZERO_PRICE = "zero_price"
    NEGATIVE_PRICE = "negative_price"
    FUTURE_TIMESTAMP = "future_timestamp"
    OLD_TIMESTAMP = "old_timestamp"
    OUT_OF_ORDER = "out_of_order"
    DUPLICATE = "duplicate"


class Freshness(str, enum.Enum):
    FRESH = "fresh"
    STALE = "stale"
