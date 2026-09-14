from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.repository import AssetRepository
from alpha_radar.assets.service import AssetService
from alpha_radar.config import get_settings
from alpha_radar.db.session import get_db_session
from alpha_radar.market_data.constants import MAX_HISTORY_LIMIT, MarketInterval
from alpha_radar.market_data.repository import MarketDataRepository
from alpha_radar.market_data.schemas import MarketHistoryResponse, MarketQuoteResponse
from alpha_radar.market_data.service import MarketDataService

router = APIRouter(prefix="/assets", tags=["market-data"])


def get_market_data_service(
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> MarketDataService:
    settings = get_settings()
    return MarketDataService(
        MarketDataRepository(session),
        AssetService(AssetRepository(session)),
        quote_freshness=timedelta(seconds=settings.market_data_quote_freshness_seconds),
        future_tolerance=timedelta(seconds=settings.market_data_future_tolerance_seconds),
    )


@router.get("/{identifier}/quote", response_model=MarketQuoteResponse)
async def get_asset_quote(
    identifier: str,
    service: Annotated[MarketDataService, Depends(get_market_data_service)],
) -> MarketQuoteResponse:
    return await service.get_quote(identifier)


@router.get("/{identifier}/history", response_model=MarketHistoryResponse)
async def get_asset_history(
    identifier: str,
    service: Annotated[MarketDataService, Depends(get_market_data_service)],
    interval: MarketInterval = MarketInterval.ONE_DAY,
    start: Annotated[AwareDatetime | None, Query()] = None,
    end: Annotated[AwareDatetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_HISTORY_LIMIT)] = 100,
) -> MarketHistoryResponse:
    return await service.get_history(
        identifier,
        interval=interval,
        start=start,
        end=end,
        limit=limit,
    )
