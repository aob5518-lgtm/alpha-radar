from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.seed import seed_assets
from alpha_radar.db.session import get_db_session
from alpha_radar.main import create_app


@pytest.mark.asyncio
async def test_assets_api_lists_filters_and_returns_errors(session: AsyncSession) -> None:
    await seed_assets(session)
    application = create_app()

    async def override_session() -> AsyncIterator[AsyncSession]:
        yield session

    application.dependency_overrides[get_db_session] = override_session
    transport = ASGITransport(app=application)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/v1/assets",
            params={"asset_type": "etf", "page_size": 2, "sort_by": "symbol"},
        )
        detail = await client.get("/api/v1/assets/bitcoin")
        missing = await client.get("/api/v1/assets/does-not-exist")

    assert response.status_code == 200
    assert response.json()["pagination"] == {
        "page": 1,
        "page_size": 2,
        "total_items": 4,
        "total_pages": 2,
    }
    assert [item["symbol"] for item in response.json()["items"]] == ["GLD", "IBIT"]
    assert detail.status_code == 200
    assert detail.json()["slug"] == "bitcoin"
    assert len(detail.json()["provider_mappings"]) == 3
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "asset_not_found"
