from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import timedelta


class MarketInterval(str, enum.Enum):
    ONE_MINUTE = "1m"
    FIVE_MINUTES = "5m"
    FIFTEEN_MINUTES = "15m"
    ONE_HOUR = "1h"
    FOUR_HOURS = "4h"
    ONE_DAY = "1d"
    ONE_WEEK = "1w"


@dataclass(frozen=True)
class IntervalDefinition:
    duration: timedelta
    max_query_range: timedelta
    coinbase_granularity: int
    coinbase_aggregation: int = 1


INTERVAL_DEFINITIONS: dict[MarketInterval, IntervalDefinition] = {
    MarketInterval.ONE_MINUTE: IntervalDefinition(
        duration=timedelta(minutes=1),
        max_query_range=timedelta(days=7),
        coinbase_granularity=60,
    ),
    MarketInterval.FIVE_MINUTES: IntervalDefinition(
        duration=timedelta(minutes=5),
        max_query_range=timedelta(days=30),
        coinbase_granularity=300,
    ),
    MarketInterval.FIFTEEN_MINUTES: IntervalDefinition(
        duration=timedelta(minutes=15),
        max_query_range=timedelta(days=90),
        coinbase_granularity=900,
    ),
    MarketInterval.ONE_HOUR: IntervalDefinition(
        duration=timedelta(hours=1),
        max_query_range=timedelta(days=366),
        coinbase_granularity=3600,
    ),
    MarketInterval.FOUR_HOURS: IntervalDefinition(
        duration=timedelta(hours=4),
        max_query_range=timedelta(days=1464),
        coinbase_granularity=3600,
        coinbase_aggregation=4,
    ),
    MarketInterval.ONE_DAY: IntervalDefinition(
        duration=timedelta(days=1),
        max_query_range=timedelta(days=3650),
        coinbase_granularity=86400,
    ),
    MarketInterval.ONE_WEEK: IntervalDefinition(
        duration=timedelta(days=7),
        max_query_range=timedelta(days=7000),
        coinbase_granularity=86400,
        coinbase_aggregation=7,
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
