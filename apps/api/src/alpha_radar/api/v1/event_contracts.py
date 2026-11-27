from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.config import get_settings
from alpha_radar.db.session import get_db_session
from alpha_radar.event_contracts.repository import ResearchRepository
from alpha_radar.event_contracts.schemas import ResearchResponse
from alpha_radar.event_contracts.service import read_research
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
