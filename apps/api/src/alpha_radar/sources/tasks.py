import asyncio

import structlog
from celery import Task

from alpha_radar.config import get_settings
from alpha_radar.db.session import async_session_factory, engine
from alpha_radar.sources.errors import SourceError
from alpha_radar.sources.factory import create_source_adapter
from alpha_radar.sources.repository import SourceRepository
from alpha_radar.sources.service import SourceService
from alpha_radar.worker import app

logger = structlog.get_logger(__name__)


async def _ingest(slug: str, external_id: str | None = None) -> int:
    try:
        async with async_session_factory() as session:
            repository = SourceRepository(session)
            source = await repository.source(slug)
            if source is None or source.status != "active":
                raise SourceError("policy_restricted", "Source missing or disabled")
            adapter = create_source_adapter(source.provider, get_settings())
            documents = (
                [await adapter.fetch_document(external_id)]
                if external_id
                else await adapter.fetch_recent()
            )
            for document in documents:
                await SourceService(repository).ingest(source, document)
            await logger.ainfo("source_ingestion_complete", source=slug, documents=len(documents))
            return len(documents)
    except SourceError as error:
        await logger.awarning(
            "source_ingestion_failed", source=slug, kind=error.kind, retry_after=error.retry_after
        )
        raise
    finally:
        await engine.dispose()


def _run(task: Task, slug: str, external_id: str | None = None) -> int:
    try:
        return asyncio.run(_ingest(slug, external_id))
    except SourceError as error:
        # Invalid/parser/policy failures need operator/configuration action. Only
        # temporary failures receive a bounded retry; shared cooldown still applies.
        if error.kind == "temporary_source_error":
            raise task.retry(  # pyright: ignore[reportUnknownMemberType]
                exc=error,
                countdown=min(int(error.retry_after or 60), 900),
                max_retries=2,
            ) from error
        raise


@app.task(bind=True, name="alpha_radar.sources.ingest_source_recent")  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
def ingest_source_recent(task: Task, slug: str) -> int:
    return _run(task, slug)


@app.task(bind=True, name="alpha_radar.sources.ingest_source_document")  # pyright: ignore[reportUnknownMemberType, reportUntypedFunctionDecorator]
def ingest_source_document(task: Task, slug: str, external_id: str) -> int:
    return _run(task, slug, external_id)
