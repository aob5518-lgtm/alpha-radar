"""Deterministic real-PostgreSQL verification; never permitted on production data."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
from sqlalchemy import func, select

from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.event_contracts.models import EventContractDecision
from alpha_radar.event_contracts.repository import ResearchRepository
from alpha_radar.event_contracts.service import (
    ingest_bars,
    observe,
    publish,
    read_research,
    seed_indices,
)
from alpha_radar.event_contracts.strategy import Bar


async def verify() -> None:
    if get_settings().app_env == "production":
        raise RuntimeError("Synthetic integration verification must never run in production")
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    start = now - timedelta(minutes=1200)
    bars: list[Bar] = []
    for index in range(1230):
        price = Decimal(100) + Decimal(index) * Decimal(".02")
        bars.append(
            Bar(
                open_time=start + timedelta(minutes=index),
                close_time=start + timedelta(minutes=index + 1),
                open=price - Decimal(".01"),
                high=price + Decimal(".1"),
                low=price - Decimal(".1"),
                close=price,
            )
        )
    for index, values in (
        (1198, ("123.8", "123.84", "123.70", "123.78")),
        (1199, ("123.78", "123.96", "123.76", "123.94")),
    ):
        bars[index] = bars[index].model_copy(
            update=dict(zip(("open", "high", "low", "close"), map(Decimal, values), strict=True))
        )
    try:
        async with async_session_factory() as session:
            instruments = await seed_indices(session)
            assert [item.id for item in instruments] == [
                item.id for item in await seed_indices(session)
            ]
            repository = ResearchRepository(session)
            for instrument in instruments:
                await ingest_bars(repository, instrument, bars[:1200])
                assert (await publish(repository, instrument, 10, now=now)).direction == "up"
                await publish(repository, instrument, 10, now=now)
                count = await session.scalar(
                    select(func.count())
                    .select_from(EventContractDecision)
                    .where(
                        EventContractDecision.market_instrument_id == instrument.id,
                        EventContractDecision.horizon_minutes == 10,
                    )
                )
                assert count == 1, "Duplicate persisted signal"
                await ingest_bars(repository, instrument, bars[1200:])
                assert await observe(repository, instrument, now=now + timedelta(minutes=30)) == 1
                response = await read_research(
                    repository, instrument.asset_id, 10, enabled=True, now=now
                )
                assert response.assessment.direction == "up"
                assert response.observations[0].outcome == "up"
                assert response.probability is None and not response.settlement_basis_verified
                assert response.market_instrument_id == instrument.id
            # Real HTTP serialization and validation with the default disabled flag.
            async with httpx.AsyncClient(base_url="http://api:8000", timeout=10) as client:
                response = await client.get(
                    f"/api/v1/event-contracts/{instruments[0].asset_id}?horizon=30"
                )
                assert response.status_code == 200
                assert response.json()["horizon_minutes"] == 30
                assert response.json()["availability"] == "disabled"
                assert (
                    await client.get(
                        f"/api/v1/event-contracts/{instruments[0].asset_id}?horizon=15"
                    )
                ).status_code == 422
        print(
            "Event-contract PostgreSQL integration passed: canonical indices, upsert, "
            "immutable/idempotent signal, proxy observation, HTTP and unavailable boundaries."
        )
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(verify())
