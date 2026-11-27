from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.config import get_settings
from alpha_radar.db.session import get_db_session
from alpha_radar.errors import AppError
from alpha_radar.event_contracts.repository import ResearchRepository
from alpha_radar.event_contracts.schemas import ResearchResponse
from alpha_radar.event_contracts.service import read_research
from alpha_radar.event_contracts.shadow_repository import ShadowRepository
from alpha_radar.event_contracts.shadow_rules import snapshot_key
from alpha_radar.event_contracts.shadow_schemas import (
    ShadowAssessment,
    ShadowObservation,
    ShadowResponse,
)
from alpha_radar.event_contracts.strategy import Horizon

router = APIRouter(prefix="/event-contracts", tags=["event-contract-research"])


@router.get("/{asset_id}", response_model=ResearchResponse)
async def research(
    asset_id: UUID,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    horizon: Annotated[Literal["10", "30"], Query()] = "10",
) -> ResearchResponse:
    selected: Horizon = 10 if horizon == "10" else 30
    return await read_research(
        ResearchRepository(session),
        asset_id,
        selected,
        enabled=get_settings().event_contracts_enabled,
        now=datetime.now(UTC),
    )


@router.get("/{asset_id}/shadow", response_model=ShadowResponse)
async def shadow(
    asset_id: UUID,
    session: Annotated[AsyncSession, Depends(get_db_session)],
    horizon: Annotated[Literal["10", "30"], Query()] = "10",
) -> ShadowResponse:
    settings = get_settings()
    selected: Horizon = 10 if horizon == "10" else 30
    repository = ShadowRepository(session)
    instrument = await repository.instrument(asset_id=asset_id)
    if instrument is None:
        raise AppError(
            status_code=404,
            code="shadow_instrument_not_found",
            message="Event Signal supports canonical BTC and ETH Bybit contracts.",
        )
    if settings.event_signal_shadow_enabled:
        try:
            async with Redis.from_url(settings.redis_url, socket_timeout=1) as redis:  # pyright: ignore[reportUnknownMemberType]
                raw = await redis.get(snapshot_key(instrument.id, selected))
            if isinstance(raw, str | bytes):
                cached = ShadowResponse.model_validate_json(raw)
                if (
                    cached.asset_id == asset_id
                    and cached.market_instrument_id == instrument.id
                    and cached.horizon_minutes == selected
                    and cached.symbol == instrument.base_currency
                    and cached.valid_until is not None
                    and cached.valid_until > datetime.now(UTC)
                ):
                    return cached
        except (RedisError, ValidationError):
            pass
    return ShadowResponse(
        asset_id=asset_id,
        market_instrument_id=instrument.id,
        symbol=instrument.base_currency,
        horizon_minutes=selected,
        assessment=ShadowAssessment(
            reason="warming_up" if settings.event_signal_shadow_enabled else "disabled"
        ),
        observations=[
            ShadowObservation.model_validate(row)
            for row in await repository.recent(instrument.id, selected)
        ]
        if settings.event_signal_shadow_enabled
        else [],
    )
