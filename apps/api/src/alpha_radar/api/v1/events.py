from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.db.session import get_db_session
from alpha_radar.events.repository import EventRepository
from alpha_radar.events.schemas import (
    EventImportance,
    EventListResponse,
    EventResponse,
    EventStatus,
)
from alpha_radar.events.service import EventService

router = APIRouter(prefix="/events", tags=["events"])


def get_event_service(session: Annotated[AsyncSession, Depends(get_db_session)]) -> EventService:
    return EventService(EventRepository(session))


@router.get("", response_model=EventListResponse)
async def list_events(
    service: Annotated[EventService, Depends(get_event_service)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
    start: AwareDatetime | None = None,
    end: AwareDatetime | None = None,
    importance: Annotated[list[EventImportance] | None, Query()] = None,
    event_type: Annotated[str | None, Query(max_length=64)] = None,
    status: EventStatus | None = None,
    asset_id: UUID | None = None,
) -> EventListResponse:
    return await service.list(
        page=page,
        page_size=page_size,
        start=start,
        end=end,
        importances=list(importance or ["critical", "high"]),
        event_type=event_type,
        status=status,
        asset_id=asset_id,
    )


@router.get("/{event_id}", response_model=EventResponse)
async def get_event(
    event_id: UUID, service: Annotated[EventService, Depends(get_event_service)]
) -> EventResponse:
    return await service.detail(event_id)
