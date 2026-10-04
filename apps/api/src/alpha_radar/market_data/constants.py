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
    bybit_interval: str = ""


INTERVAL_DEFINITIONS: dict[MarketInterval, IntervalDefinition] = {
    MarketInterval.ONE_MINUTE: IntervalDefinition(
        duration=timedelta(minutes=1),
        max_query_range=timedelta(days=7),
        coinbase_granularity=60,
        bybit_interval="1",
    ),
    MarketInterval.FIVE_MINUTES: IntervalDefinition(
        duration=timedelta(minutes=5),
        max_query_range=timedelta(days=30),
        coinbase_granularity=300,
        bybit_interval="5",
    ),
    MarketInterval.FIFTEEN_MINUTES: IntervalDefinition(
        duration=timedelta(minutes=15),
        max_query_range=timedelta(days=90),
        coinbase_granularity=900,
        bybit_interval="15",
    ),
    MarketInterval.ONE_HOUR: IntervalDefinition(
        duration=timedelta(hours=1),
        max_query_range=timedelta(days=366),
        coinbase_granularity=3600,
        bybit_interval="60",
    ),
    MarketInterval.FOUR_HOURS: IntervalDefinition(
        duration=timedelta(hours=4),
        max_query_range=timedelta(days=1464),
        coinbase_granularity=3600,
        coinbase_aggregation=4,
        bybit_interval="240",
    ),
    MarketInterval.ONE_DAY: IntervalDefinition(
        duration=timedelta(days=1),
        max_query_range=timedelta(days=3650),
        coinbase_granularity=86400,
        bybit_interval="D",
    ),
    MarketInterval.ONE_WEEK: IntervalDefinition(
        duration=timedelta(days=7),
        max_query_range=timedelta(days=7000),
        coinbase_granularity=86400,
        coinbase_aggregation=7,
        bybit_interval="W",
    ),
}

MAX_HISTORY_LIMIT = 1000
COINBASE_MAX_CANDLES_PER_REQUEST = 300
COINBASE_MAX_BACKFILL_TARGET_CANDLES = 500
BYBIT_MAX_CANDLES_PER_REQUEST = 1000
BYBIT_MAX_BACKFILL_TARGET_CANDLES = 1000
BYBIT_MAX_BACKFILL_PAGES = 64

BYBIT_HISTORY_RETENTION: dict[MarketInterval, timedelta | None] = {
    MarketInterval.ONE_MINUTE: timedelta(days=7),
    MarketInterval.FIVE_MINUTES: timedelta(days=30),
    MarketInterval.FIFTEEN_MINUTES: timedelta(days=90),
    MarketInterval.ONE_HOUR: timedelta(days=365),
    MarketInterval.FOUR_HOURS: timedelta(days=730),
    MarketInterval.ONE_DAY: None,
    MarketInterval.ONE_WEEK: None,
}


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
