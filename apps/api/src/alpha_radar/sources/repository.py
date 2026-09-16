from datetime import datetime
from uuid import UUID

from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from alpha_radar.sources.models import Source, SourceDocument, SourceDocumentVersion
from alpha_radar.sources.schemas import SourceType


class SourceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def lock_source(self, source_id: UUID) -> None:
        # Transaction-scoped serialization across API/worker processes; no new queue.
        if self.session.get_bind().dialect.name == "postgresql":
            await self.session.execute(
                text("SELECT pg_advisory_xact_lock(:key)"), {"key": source_id.int % (2**63 - 1)}
            )

    async def source(self, slug: str) -> Source | None:
        return await self.session.scalar(select(Source).where(Source.slug == slug))

    async def sources(self, page: int, page_size: int) -> tuple[list[Source], int]:
        count = int(await self.session.scalar(select(func.count()).select_from(Source)) or 0)
        rows = await self.session.scalars(
            select(Source)
            .order_by(Source.slug, Source.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(rows), count

    async def identity(
        self, source_id: UUID, external_id: str | None, url: str
    ) -> list[SourceDocument]:
        identities = [SourceDocument.canonical_url == url]
        if external_id:
            identities.append(SourceDocument.external_id == external_id)
        return list(
            await self.session.scalars(
                select(SourceDocument).where(
                    SourceDocument.source_id == source_id, or_(*identities)
                )
            )
        )

    async def versions(self, document_id: UUID) -> list[SourceDocumentVersion]:
        return list(
            await self.session.scalars(
                select(SourceDocumentVersion)
                .where(SourceDocumentVersion.source_document_id == document_id)
                .order_by(SourceDocumentVersion.version_number)
            )
        )

    async def current(self, document_id: UUID) -> SourceDocumentVersion:
        return (
            await self.session.scalars(
                select(SourceDocumentVersion).where(
                    SourceDocumentVersion.source_document_id == document_id,
                    SourceDocumentVersion.is_current.is_(True),
                )
            )
        ).one()

    async def document(self, document_id: UUID) -> SourceDocument | None:
        return await self.session.get(SourceDocument, document_id)

    async def documents(
        self,
        *,
        page: int,
        page_size: int,
        source: str | None = None,
        source_type: SourceType | None = None,
        document_type: str | None = None,
        published_after: datetime | None = None,
        published_before: datetime | None = None,
        search: str | None = None,
    ) -> tuple[list[SourceDocument], int]:
        filters: list[ColumnElement[bool]] = []
        if source:
            filters.append(Source.slug == source)
        if source_type:
            filters.append(Source.source_type == source_type)
        if document_type:
            filters.append(SourceDocument.document_type == document_type)
        if published_after:
            filters.append(SourceDocument.published_at >= published_after)
        if published_before:
            filters.append(SourceDocument.published_at <= published_before)
        if search:
            escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            filters.append(SourceDocument.title.ilike(f"%{escaped}%", escape="\\"))
        query = select(SourceDocument).join(Source).where(*filters)
        count = int(
            await self.session.scalar(select(func.count()).select_from(query.subquery())) or 0
        )
        query = (
            query.order_by(
                SourceDocument.published_at.desc().nulls_last(),
                SourceDocument.first_observed_at.desc(),
                SourceDocument.id,
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(await self.session.scalars(query)), count
