from __future__ import annotations

from datetime import datetime, timedelta

from alpha_radar.market_data.constants import QualityFlag


def timestamp_quality_flags(
    *,
    provider_timestamp: datetime | None,
    observed_at: datetime,
    future_tolerance: timedelta,
    stale_after: timedelta,
) -> list[str]:
    if provider_timestamp is None:
        return []

    flags: list[str] = []
    if provider_timestamp > observed_at + future_tolerance:
        flags.append(QualityFlag.FUTURE_TIMESTAMP.value)
    if provider_timestamp < observed_at - stale_after:
        flags.append(QualityFlag.OLD_TIMESTAMP.value)
    return flags
