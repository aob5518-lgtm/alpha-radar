from typing import TypedDict, cast

from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.worker import app


class ScheduleEntry(TypedDict):
    task: str
    args: list[str | int]


def test_periodic_candle_schedule_covers_every_supported_timeframe() -> None:
    schedules = cast(
        dict[str, ScheduleEntry],
        app.conf.beat_schedule,  # pyright: ignore[reportUnknownMemberType]
    )
    candle_entries = [
        entry
        for entry in schedules.values()
        if entry["task"] == "alpha_radar.market_data.fetch_candles"
    ]
    assert {entry["args"][0] for entry in candle_entries} == {
        interval.value for interval in MarketInterval
    }
    assert all(entry["args"][1] == 3 for entry in candle_entries)
