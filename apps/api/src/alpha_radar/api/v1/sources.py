from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from alpha_radar.db.session import get_db_session
from alpha_radar.sources.repository import SourceRepository
from alpha_radar.sources.schemas import (
    DocumentListResponse,
    DocumentResponse,
    SourceListResponse,
    SourceType,
)
from alpha_radar.sources.service import SourceService

router = APIRouter(tags=["sources"])


def get_source_service(session: Annotated[AsyncSession, Depends(get_db_session)]) -> SourceService:
    return SourceService(SourceRepository(session))


@router.get("/sources", response_model=SourceListResponse)
async def list_sources(
    service: Annotated[SourceService, Depends(get_source_service)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> SourceListResponse:
    return await service.list_sources(page, page_size)


@router.get("/documents", response_model=DocumentListResponse)
async def list_documents(
    service: Annotated[SourceService, Depends(get_source_service)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    source: Annotated[str | None, Query(max_length=128)] = None,
    source_type: SourceType | None = None,
    document_type: Annotated[str | None, Query(max_length=64)] = None,
    published_after: datetime | None = None,
    published_before: datetime | None = None,
    search: Annotated[str | None, Query(min_length=1, max_length=100)] = None,
) -> DocumentListResponse:
    return await service.list_documents(
        page=page,
        page_size=page_size,
        source=source,
        source_type=source_type,
        document_type=document_type,
        published_after=published_after,
        published_before=published_before,
        search=search,
    )


@router.get("/documents/{document_id}", response_model=DocumentResponse)
async def detail(
    document_id: UUID, service: Annotated[SourceService, Depends(get_source_service)]
) -> DocumentResponse:
    return await service.detail(document_id)
