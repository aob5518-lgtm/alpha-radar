from datetime import UTC, datetime
from math import ceil
from typing import cast
from uuid import UUID

from alpha_radar.assets.schemas import PaginationMetadata
from alpha_radar.errors import AppError
from alpha_radar.sources.errors import SourceError
from alpha_radar.sources.models import Source, SourceDocument, SourceDocumentVersion
from alpha_radar.sources.normalization import canonical_url, content_hash, plain_text
from alpha_radar.sources.policy import storage_policy
from alpha_radar.sources.repository import SourceRepository
from alpha_radar.sources.schemas import (
    DocumentListResponse,
    DocumentResponse,
    FetchedSourceDocument,
    LicenseClass,
    SourceListResponse,
    SourceResponse,
    SourceType,
    VersionResponse,
)


def utc(value: datetime) -> datetime:
    # SQLite test driver drops offsets; PostgreSQL persists timestamptz.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class SourceService:
    def __init__(self, repository: SourceRepository) -> None:
        self.repository = repository

    async def ingest(self, source: Source, fetched: FetchedSourceDocument) -> SourceDocument:
        policy = storage_policy(cast(LicenseClass, source.license_class))
        if not policy.metadata:
            raise SourceError("policy_restricted", "Source policy prohibits metadata storage")
        url = canonical_url(fetched.canonical_url)
        if fetched.observed_at > fetched.fetched_at:
            raise SourceError("invalid_payload", "Observation cannot follow fetch completion")
        # Each call owns one transaction; advisory lock remains held until commit.
        await self.repository.lock_source(source.id)
        matches = await self.repository.identity(source.id, fetched.external_id, url)
        if len(matches) > 1:
            raise SourceError(
                "invalid_payload", "External ID and URL resolve to different documents"
            )
        document = matches[0] if matches else None
        if (
            document
            and document.external_id
            and fetched.external_id
            and document.external_id != fetched.external_id
        ):
            raise SourceError("invalid_payload", "Canonical URL has a conflicting external ID")
        now = datetime.now(UTC)
        digest = content_hash(fetched)
        if document is None:
            document = SourceDocument(
                source_id=source.id,
                external_id=fetched.external_id,
                canonical_url=url,
                document_type=fetched.document_type,
                title=fetched.title,
                first_observed_at=fetched.observed_at,
                last_observed_at=fetched.observed_at,
                first_fetched_at=fetched.fetched_at,
                last_fetched_at=fetched.fetched_at,
                ingested_at=now,
                current_content_hash=digest,
            )
            self.repository.session.add(document)
            await self.repository.session.flush()
            previous = None
        else:
            previous = await self.repository.current(document.id)
            # Delayed task deliveries must not replace the latest observed revision.
            if fetched.observed_at < utc(document.last_observed_at):
                raise SourceError(
                    "invalid_payload", "Out-of-order observation; refusing revision leakage"
                )
            document.first_observed_at = min(utc(document.first_observed_at), fetched.observed_at)
            document.first_fetched_at = min(utc(document.first_fetched_at), fetched.fetched_at)
            document.last_observed_at = max(utc(document.last_observed_at), fetched.observed_at)
            document.last_fetched_at = max(utc(document.last_fetched_at), fetched.fetched_at)
            document.external_id = document.external_id or fetched.external_id
        if previous is None or previous.content_hash != digest:
            number = previous.version_number + 1 if previous else 1
            if previous:
                previous.is_current = False
                await self.repository.session.flush()
            provenance: dict[str, object] = {
                **dict(fetched.metadata),
                "provider": source.provider,
                "external_id": fetched.external_id,
                "retrieved_url": fetched.canonical_url,
                "canonical_url": url,
                "license_class": source.license_class,
            }
            version = SourceDocumentVersion(
                source_document_id=document.id,
                version_number=number,
                content_hash=digest,
                title=plain_text(fetched.title),
                summary=plain_text(fetched.summary) if policy.excerpt and fetched.summary else None,
                excerpt=plain_text(fetched.excerpt) if policy.excerpt and fetched.excerpt else None,
                raw_content_locator=None,
                published_at=fetched.published_at,
                publisher_updated_at=fetched.publisher_updated_at,
                observed_at=fetched.observed_at,
                fetched_at=fetched.fetched_at,
                ingested_at=now,
                is_current=True,
                metadata_=provenance,
            )
            self.repository.session.add(version)
            document.title = version.title
            document.published_at = fetched.published_at
            document.publisher_updated_at = fetched.publisher_updated_at
            document.author = fetched.author
            document.language = fetched.language
            document.document_type = fetched.document_type
            document.canonical_url = url
            document.current_content_hash = digest
            document.metadata_ = provenance
        await self.repository.session.commit()
        return document

    async def response(self, document: SourceDocument) -> DocumentResponse:
        source = await self.repository.session.get(Source, document.source_id)
        assert source is not None
        fields = {
            key: getattr(document, key)
            for key in DocumentResponse.model_fields
            if key not in {"source", "current_version"}
        }
        return DocumentResponse.model_validate(
            {
                **fields,
                "source": SourceResponse.model_validate(source),
                "current_version": VersionResponse.model_validate(
                    await self.repository.current(document.id)
                ),
            }
        )

    async def detail(self, document_id: UUID) -> DocumentResponse:
        document = await self.repository.document(document_id)
        if document is None:
            raise AppError(
                code="document_not_found", message="Source document not found", status_code=404
            )
        return await self.response(document)

    async def list_sources(self, page: int, page_size: int) -> SourceListResponse:
        rows, count = await self.repository.sources(page, page_size)
        return SourceListResponse(
            items=[SourceResponse.model_validate(row) for row in rows],
            pagination=PaginationMetadata(
                page=page,
                page_size=page_size,
                total_items=count,
                total_pages=ceil(count / page_size),
            ),
        )

    async def list_documents(
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
    ) -> DocumentListResponse:
        for value in (published_after, published_before):
            if value is not None and value.tzinfo is None:
                raise AppError(
                    code="invalid_time_range",
                    message="Date filters require a timezone",
                    status_code=422,
                )
        if published_after and published_before and published_after > published_before:
            raise AppError(
                code="invalid_time_range",
                message="published_after must precede published_before",
                status_code=422,
            )
        rows, count = await self.repository.documents(
            page=page,
            page_size=page_size,
            source=source,
            source_type=source_type,
            document_type=document_type,
            published_after=published_after,
            published_before=published_before,
            search=search,
        )
        return DocumentListResponse(
            items=[await self.response(row) for row in rows],
            pagination=PaginationMetadata(
                page=page,
                page_size=page_size,
                total_items=count,
                total_pages=ceil(count / page_size),
            ),
        )
