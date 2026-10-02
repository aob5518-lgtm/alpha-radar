from collections.abc import AsyncIterator
from datetime import UTC, datetime

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.seed import seed_assets
from alpha_radar.db.session import get_db_session
from alpha_radar.events.models import Event, EventAsset, EventSourceReference
from alpha_radar.events.repository import EventRepository
from alpha_radar.events.seed import seed_events
from alpha_radar.events.service import EventService
from alpha_radar.main import create_app


async def test_seed_is_idempotent_and_events_retain_provenance(session: AsyncSession) -> None:
    await seed_assets(session)
    first = await seed_events(session)
    second = await seed_events(session)

    assert first == (14, 42, 14)
    assert second == (0, 0, 0)
    assert await session.scalar(select(func.count()).select_from(Event)) == 14
    assert await session.scalar(select(func.count()).select_from(EventAsset)) == 42
    assert await session.scalar(select(func.count()).select_from(EventSourceReference)) == 14

    result = await EventService(EventRepository(session)).list(
        page=1,
        page_size=20,
        start=datetime(2026, 10, 1, tzinfo=UTC),
        end=datetime(2026, 11, 1, tzinfo=UTC),
        importances=["critical", "high"],
        event_type=None,
        status="scheduled",
        asset_id=None,
    )
    assert result.pagination.total_items == 5
    assert result.items[0].scheduled_timezone == "America/New_York"
    assert result.items[0].sources[0].source_name.startswith("U.S. Bureau")
    assert {asset.symbol for asset in result.items[0].affected_assets} == {"BTC", "QQQ", "SPY"}


async def test_date_only_event_does_not_invent_a_time(session: AsyncSession) -> None:
    event = Event(
        external_key="date-only:test",
        title="Date-only event",
        event_type="regulation",
        status="scheduled",
        scheduled_date=datetime(2026, 10, 20).date(),
        scheduled_at=None,
        scheduled_timezone=None,
        detected_at=datetime.now(UTC),
        importance="high",
        summary="FACT: Date only.",
        why_it_matters="ANALYSIS: Material if confirmed.",
        impact_analysis={},
        watch_next=[],
    )
    session.add(event)
    await session.commit()

    detail = await EventService(EventRepository(session)).detail(event.id)
    assert detail.scheduled_date is not None
    assert detail.scheduled_date.isoformat() == "2026-10-20"
    assert detail.scheduled_at is None
    listed = await EventService(EventRepository(session)).list(
        page=1,
        page_size=10,
        start=datetime(2026, 10, 20, tzinfo=UTC),
        end=datetime(2026, 10, 21, tzinfo=UTC),
        importances=["high"],
        event_type=None,
        status=None,
        asset_id=None,
    )
    assert [item.id for item in listed.items] == [event.id]


async def test_event_list_and_detail_api(session: AsyncSession) -> None:
    await seed_assets(session)
    await seed_events(session)
    app = create_app()

    async def override_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_db_session] = override_session
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        listing = await client.get(
            "/api/v1/events", params=[("importance", "critical"), ("importance", "high")]
        )
        assert listing.status_code == 200
        payload = listing.json()
        assert payload["pagination"]["total_items"] == 14
        detail = await client.get(f"/api/v1/events/{payload['items'][0]['id']}")
        assert detail.status_code == 200
        assert detail.json()["sources"][0]["source_name"].startswith("U.S. Bureau")
