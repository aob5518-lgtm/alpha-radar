"""Deterministic Compose-only seed and revision verification; never calls the internet."""

import asyncio

from sqlalchemy import func, select

from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.sources.adapters import MockSourceAdapter
from alpha_radar.sources.models import SourceDocument, SourceDocumentVersion
from alpha_radar.sources.repository import SourceRepository
from alpha_radar.sources.seed import seed_sources
from alpha_radar.sources.service import SourceService


async def main() -> None:
    try:
        async with async_session_factory() as session:
            await seed_sources(session, include_mock=True)
            repository = SourceRepository(session)
            source = await repository.source("mock-source")
            assert source is not None
            service = SourceService(repository)
            first = (await MockSourceAdapter().fetch_recent())[0]
            document = await service.ingest(source, first)
            await service.ingest(source, first)
            revised = (await MockSourceAdapter(2).fetch_recent())[0]
            await service.ingest(source, revised)
            documents = int(
                await session.scalar(
                    select(func.count())
                    .select_from(SourceDocument)
                    .where(SourceDocument.source_id == source.id)
                )
                or 0
            )
            versions = int(
                await session.scalar(
                    select(func.count())
                    .select_from(SourceDocumentVersion)
                    .where(SourceDocumentVersion.source_document_id == document.id)
                )
                or 0
            )
            current = await repository.current(document.id)
            if (documents, versions, current.version_number) != (1, 2, 2):
                raise RuntimeError(
                    f"Unexpected source revision state: {documents}, {versions}, "
                    f"{current.version_number}"
                )
            print(f"Mock source revision verification passed: document_id={document.id}")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
