from __future__ import annotations

import argparse
import asyncio
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import httpx
from sqlalchemy import select

from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.event_contracts.audit import replay
from alpha_radar.event_contracts.provider import SYMBOLS, BinanceIndexProvider
from alpha_radar.event_contracts.repository import ResearchRepository
from alpha_radar.event_contracts.service import ingest_bars, seed_indices
from alpha_radar.event_contracts.strategy import Bar, utc
from alpha_radar.event_contracts.tasks import run_sync
from alpha_radar.events.models import Event
from alpha_radar.market_data.constants import MarketInterval
from alpha_radar.market_data.models import MarketCandle


async def run(args: argparse.Namespace) -> None:
    try:
        if args.command == "sync":
            print(json.dumps(await run_sync()))
            return
        async with async_session_factory() as session:
            instruments = await seed_indices(session)
            selected = [
                item for item in instruments if args.symbol in (None, item.provider_instrument_id)
            ]
            if args.command == "backfill":
                if not 1 <= args.days <= 365:
                    raise ValueError("Backfill days must be between 1 and 365")
                async with httpx.AsyncClient(
                    timeout=20, headers={"User-Agent": "AlphaRadar/0.1"}
                ) as client:
                    provider = BinanceIndexProvider(client)
                    horizon = datetime.now(UTC) - timedelta(days=args.days, hours=20)
                    for instrument in selected:
                        end, count, pages = datetime.now(UTC), 0, 0
                        while end > horizon and pages < 530:
                            bars = await provider.fetch(instrument.provider_instrument_id, end=end)
                            if not bars:
                                break
                            if bars[0].open_time >= end:
                                raise ValueError("Backfill cursor did not advance")
                            await ingest_bars(ResearchRepository(session), instrument, bars)
                            end, count, pages = bars[0].open_time, count + len(bars), pages + 1
                            if pages % 20 == 0:
                                print(
                                    json.dumps(
                                        {
                                            "symbol": instrument.provider_instrument_id,
                                            "pages": pages,
                                            "rows": count,
                                            "oldest": end.isoformat(),
                                        }
                                    ),
                                    flush=True,
                                )
                            await asyncio.sleep(0.4)
                        print(
                            json.dumps(
                                {
                                    "symbol": instrument.provider_instrument_id,
                                    "rows": count,
                                    "pages": pages,
                                    "horizon_reached": end <= horizon,
                                }
                            ),
                            flush=True,
                        )
                        if end > horizon:
                            raise RuntimeError("Provider exhausted before the requested horizon")
                return
            if args.days < 1 or args.days > 365:
                raise ValueError("Audit days must be between 1 and 365")
            start = datetime.now(UTC) - timedelta(days=args.days, hours=20)
            events = list(
                (
                    await session.scalars(
                        select(Event).where(
                            Event.category == "macro",
                            Event.importance.in_(("critical", "high")),
                            Event.status.notin_(("cancelled", "superseded")),
                        )
                    )
                ).all()
            )
            windows: list[tuple[datetime, datetime]] = []
            for event in events:
                if event.scheduled_at:
                    at = utc(event.scheduled_at)
                    windows.append((at, at))
                elif event.scheduled_date:
                    at = datetime.combine(event.scheduled_date, datetime.min.time(), tzinfo=UTC)
                    windows.append((at, at + timedelta(days=1)))
            results: list[dict[str, object]] = []
            for instrument in selected:
                values = list(
                    (
                        await session.scalars(
                            select(MarketCandle)
                            .where(
                                MarketCandle.market_instrument_id == instrument.id,
                                MarketCandle.interval == MarketInterval.ONE_MINUTE,
                                MarketCandle.open_time >= start,
                                MarketCandle.is_closed.is_(True),
                            )
                            .order_by(MarketCandle.open_time)
                        )
                    ).all()
                )
                bars = [
                    Bar(
                        open_time=utc(bar.open_time),
                        close_time=utc(bar.close_time),
                        open=bar.open,
                        high=bar.high,
                        low=bar.low,
                        close=bar.close,
                    )
                    for bar in values
                ]
                for horizon in (10, 30):
                    print(
                        f"Auditing {instrument.provider_instrument_id} {horizon}m: "
                        f"{len(bars)} index minutes",
                        flush=True,
                    )
                    report = replay(bars, horizon, macro_windows=windows, payout=args.payout)
                    report["symbol"] = instrument.provider_instrument_id
                    report["asset_id"] = str(instrument.asset_id)
                    report["market_instrument_id"] = str(instrument.id)
                    results.append(report)
            output = json.dumps({"reports": results}, indent=2)
            if args.output:
                Path(args.output).write_text(output + "\n")
                print(f"Audit written to {args.output}")
            else:
                print(output)
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description="Non-executable Binance index direction research")
    parser.add_argument("command", choices=("sync", "backfill", "audit"))
    parser.add_argument("--symbol", choices=SYMBOLS)
    parser.add_argument("--days", type=int, default=180)
    parser.add_argument(
        "--payout",
        type=Decimal,
        help="Explicit hypothetical net payout per unit, never a live quote",
    )
    parser.add_argument("--output", help="Local audit JSON artifact path")
    args = parser.parse_args()
    if args.payout is not None and (not args.payout.is_finite() or args.payout <= 0):
        parser.error("payout must be finite and positive")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
