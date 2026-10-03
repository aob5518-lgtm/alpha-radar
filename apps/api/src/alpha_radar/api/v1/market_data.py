import asyncio
from datetime import timedelta
from typing import Annotated
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from pydantic import AwareDatetime
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.assets.repository import AssetRepository
from alpha_radar.assets.service import AssetService
from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, get_db_session
from alpha_radar.market_data.constants import MAX_HISTORY_LIMIT, MarketInterval
from alpha_radar.market_data.factory import create_market_data_provider
from alpha_radar.market_data.models import InstrumentType
from alpha_radar.market_data.providers.base import (
    StreamingCandleMarketDataProvider,
    StreamingMarketDataProvider,
)
from alpha_radar.market_data.repository import MarketDataRepository
from alpha_radar.market_data.schemas import (
    MarketHistoryResponse,
    MarketInstrumentListResponse,
    MarketInstrumentResponse,
    MarketQuoteResponse,
)
from alpha_radar.market_data.service import MarketDataService
from alpha_radar.resource_limits import ConnectionLimiter

router = APIRouter(prefix="/assets", tags=["market-data"])
instruments_router = APIRouter(prefix="/market-instruments", tags=["market-data"])
logger = structlog.get_logger(__name__)


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


@instruments_router.get("", response_model=MarketInstrumentListResponse)
async def list_market_instruments(
    service: Annotated[MarketDataService, Depends(get_market_data_service)],
    provider: Annotated[str, Query(min_length=1, max_length=64)] = "bybit",
    instrument_type: InstrumentType = InstrumentType.PERPETUAL,
) -> MarketInstrumentListResponse:
    return await service.list_instruments(
        provider=provider.lower(), instrument_type=instrument_type
    )


@instruments_router.get("/{instrument_id}", response_model=MarketInstrumentResponse)
async def get_market_instrument(
    instrument_id: UUID,
    service: Annotated[MarketDataService, Depends(get_market_data_service)],
) -> MarketInstrumentResponse:
    return await service.get_instrument(instrument_id)


@instruments_router.get("/{instrument_id}/quote", response_model=MarketQuoteResponse)
async def get_instrument_quote(
    instrument_id: UUID,
    service: Annotated[MarketDataService, Depends(get_market_data_service)],
) -> MarketQuoteResponse:
    return await service.get_instrument_quote(instrument_id)


@instruments_router.get("/{instrument_id}/history", response_model=MarketHistoryResponse)
async def get_instrument_history(
    instrument_id: UUID,
    service: Annotated[MarketDataService, Depends(get_market_data_service)],
    interval: MarketInterval = MarketInterval.ONE_DAY,
    start: Annotated[AwareDatetime | None, Query()] = None,
    end: Annotated[AwareDatetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_HISTORY_LIMIT)] = 100,
) -> MarketHistoryResponse:
    return await service.get_instrument_history(
        instrument_id, interval=interval, start=start, end=end, limit=limit
    )


@instruments_router.websocket("/{instrument_id}/stream")
async def stream_instrument_candles(
    websocket: WebSocket,
    instrument_id: UUID,
    interval: MarketInterval = MarketInterval.ONE_HOUR,
) -> None:
    settings = get_settings()
    client_id = websocket.client.host if websocket.client else "unknown"
    limiter = ConnectionLimiter.redis(
        settings.redis_url,
        namespace="market-stream",
        per_client_limit=settings.market_stream_per_client_limit,
        global_limit=settings.market_stream_global_limit,
        ttl_seconds=settings.market_stream_idle_timeout_seconds + 15,
    )
    try:
        result, lease_token = await limiter.acquire(client_id)
    except Exception:
        await limiter.close()
        await websocket.close(code=1013)
        return
    await websocket.accept()
    if not result.acquired:
        await websocket.send_json({"type": "limited", "reason": result.reason})
        await websocket.close(code=1013)
        await limiter.close()
        return
    provider = create_market_data_provider(settings)
    try:
        if not isinstance(provider, StreamingCandleMarketDataProvider):
            await websocket.send_json({"type": "unavailable", "reason": "provider_not_streaming"})
            await websocket.close(code=1008)
            return
        async with async_session_factory() as session:
            instrument = await MarketDataRepository(session).get_instrument(instrument_id)
            if instrument is None or instrument.provider != provider.name:
                await websocket.send_json(
                    {"type": "unavailable", "reason": "instrument_unavailable"}
                )
                await websocket.close(code=1008)
                return
            reference = MarketDataService.instrument_ref(instrument)
            iterator = provider.stream_candles(reference, interval).__aiter__()
            while True:
                try:
                    async with asyncio.timeout(settings.market_stream_idle_timeout_seconds):
                        candle = await anext(iterator)
                except TimeoutError:
                    await websocket.send_json({"type": "idle_timeout"})
                    await websocket.close(code=1000)
                    return
                await limiter.refresh(client_id, lease_token)
                await websocket.send_json({"type": "candle", **candle.model_dump(mode="json")})
    except WebSocketDisconnect:
        return
    except Exception:
        await logger.aexception(
            "market_candle_stream_failed",
            market_instrument_id=str(instrument_id),
            interval=interval.value,
        )
        await websocket.close(code=1011)
    finally:
        await limiter.release(client_id, lease_token)
        await limiter.close()


@router.websocket("/{identifier}/stream")
async def stream_asset_ticks(websocket: WebSocket, identifier: str) -> None:
    settings = get_settings()
    client_id = websocket.client.host if websocket.client else "unknown"
    limiter = ConnectionLimiter.redis(
        settings.redis_url,
        namespace="market-stream",
        per_client_limit=settings.market_stream_per_client_limit,
        global_limit=settings.market_stream_global_limit,
        ttl_seconds=settings.market_stream_idle_timeout_seconds + 15,
    )
    try:
        result, lease_token = await limiter.acquire(client_id)
    except Exception:
        await limiter.close()
        await websocket.close(code=1013)
        return
    await websocket.accept()
    if not result.acquired:
        await websocket.send_json({"type": "limited", "reason": result.reason})
        await websocket.close(code=1013)
        await limiter.close()
        return
    provider = create_market_data_provider(settings)
    try:
        if not isinstance(provider, StreamingMarketDataProvider):
            await websocket.send_json({"type": "unavailable", "reason": "provider_not_streaming"})
            await websocket.close(code=1008)
            return
        async with async_session_factory() as session:
            asset = await AssetService(AssetRepository(session)).resolve_asset(identifier)
            instrument = await MarketDataRepository(session).get_preferred_instrument(asset.id)
            if instrument is None or instrument.provider != provider.name:
                await websocket.send_json(
                    {"type": "unavailable", "reason": "instrument_unavailable"}
                )
                await websocket.close(code=1008)
                return
            reference = MarketDataService.instrument_ref(instrument)
            iterator = provider.stream_ticks(reference).__aiter__()
            while True:
                try:
                    async with asyncio.timeout(settings.market_stream_idle_timeout_seconds):
                        tick = await anext(iterator)
                except TimeoutError:
                    await websocket.send_json({"type": "idle_timeout"})
                    await websocket.close(code=1000)
                    return
                await limiter.refresh(client_id, lease_token)
                await websocket.send_json({"type": "tick", **tick.model_dump(mode="json")})
    except WebSocketDisconnect:
        return
    except Exception:
        await logger.aexception("market_stream_failed", asset_identifier=identifier)
        await websocket.close(code=1011)
    finally:
        await limiter.release(client_id, lease_token)
        await limiter.close()
