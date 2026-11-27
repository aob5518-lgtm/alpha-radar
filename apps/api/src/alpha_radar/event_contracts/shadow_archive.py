"""Bounded public Bybit dataset download for read-only shadow replay."""

import argparse
import asyncio
import csv
import gzip
from datetime import UTC, datetime, timedelta
from pathlib import Path

from alpha_radar.config import get_settings
from alpha_radar.event_contracts.provider import SYMBOLS
from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.models import InstrumentType
from alpha_radar.market_data.providers.base import MarketInstrumentRef
from alpha_radar.market_data.providers.bybit import BybitMarketDataProvider


async def download(directory: Path, end: datetime, days: int) -> None:
    provider = BybitMarketDataProvider(
        base_url=get_settings().bybit_api_url, requests_per_second=3, timeout_seconds=15
    )
    directory.mkdir(parents=True, exist_ok=True)
    start = end - timedelta(days=days, hours=21)
    for symbol in SYMBOLS:
        reference = MarketInstrumentRef(
            provider_instrument_id=symbol,
            instrument_type=InstrumentType.PERPETUAL,
            base_currency=symbol[:-4],
            quote_currency="USDT",
        )
        for interval in (
            MarketInterval.ONE_MINUTE,
            MarketInterval.FIVE_MINUTES,
            MarketInterval.FIFTEEN_MINUTES,
        ):
            target = directory / f"{symbol}-{interval.value}.csv.gz"
            temporary = target.with_suffix(".partial")
            pages = 0
            with gzip.open(temporary, "wt", newline="") as out:
                writer = csv.writer(out)
                async for batch in provider.iter_candle_pages(
                    reference, interval, end=end, horizon=start, max_pages=140
                ):
                    for candle in batch:
                        if candle.is_closed and candle.close_time <= end:
                            writer.writerow(
                                (
                                    candle.open_time.isoformat(),
                                    candle.close_time.isoformat(),
                                    candle.open,
                                    candle.high,
                                    candle.low,
                                    candle.close,
                                    candle.volume,
                                )
                            )
                    pages += 1
                    if pages % 20 == 0:
                        print(
                            symbol,
                            interval.value,
                            pages,
                            batch[0].open_time.isoformat(),
                            flush=True,
                        )
            if pages == 0:
                raise RuntimeError(f"No public history for {symbol} {interval}")
            temporary.replace(target)
            print(symbol, interval.value, pages, str(target), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--end", type=datetime.fromisoformat, required=True)
    parser.add_argument("--days", type=int, default=90)
    args = parser.parse_args()
    if args.end.tzinfo is None or not 1 <= args.days <= 90:
        parser.error("Provide an aware end time and 1–90 days")
    asyncio.run(download(args.directory, args.end.astimezone(UTC), args.days))


if __name__ == "__main__":
    main()
