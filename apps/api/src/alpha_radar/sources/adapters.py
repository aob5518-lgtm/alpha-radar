import re
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from alpha_radar.sources.errors import SourceError
from alpha_radar.sources.normalization import canonical_url, plain_text
from alpha_radar.sources.schemas import FetchedSourceDocument
from alpha_radar.sources.transport import SourceTransport


class SourceAdapter(ABC):
    @abstractmethod
    async def fetch_recent(self, limit: int = 20) -> list[FetchedSourceDocument]: ...

    @abstractmethod
    async def fetch_document(self, external_id: str) -> FetchedSourceDocument: ...


class MockSourceAdapter(SourceAdapter):
    def __init__(self, revision: int = 1) -> None:
        self.revision = revision

    async def fetch_recent(self, limit: int = 20) -> list[FetchedSourceDocument]:
        if not 1 <= limit <= 100:
            raise SourceError("invalid_payload", "Limit must be between 1 and 100")
        moment = datetime(2026, 9, 15, 12, self.revision, tzinfo=UTC)
        return [
            FetchedSourceDocument(
                external_id="mock-document-1",
                canonical_url="https://example.invalid/source/document-1",
                document_type="sample_release",
                title=f"Sample source document revision {self.revision}",
                summary="Offline sample only, not an official announcement.",
                published_at=None,
                observed_at=moment,
                fetched_at=moment,
                metadata={"is_demo": True, "feed": "offline_fixture"},
            )
        ]

    async def fetch_document(self, external_id: str) -> FetchedSourceDocument:
        if external_id != "mock-document-1":
            raise SourceError("document_not_found", "Mock document not found")
        return (await self.fetch_recent())[0]


class SECRecent(BaseModel):
    model_config = ConfigDict(extra="ignore")
    accessionNumber: list[str]
    form: list[str]
    filingDate: list[str]
    reportDate: list[str]
    primaryDocument: list[str]
    acceptanceDateTime: list[str] = Field(default_factory=list)


class SECFilings(BaseModel):
    recent: SECRecent


class SECSubmission(BaseModel):
    model_config = ConfigDict(extra="ignore")
    cik: int
    name: str
    filings: SECFilings


class SECSourceAdapter(SourceAdapter):
    def __init__(self, transport: SourceTransport, ciks: list[str]) -> None:
        if len(ciks) > 20 or any(not re.fullmatch(r"\d{1,10}", cik) for cik in ciks):
            raise SourceError("invalid_payload", "Configure at most 20 numeric SEC CIKs")
        self.transport = transport
        self.ciks = ciks

    @staticmethod
    def normalize(
        payload: object, observed_at: datetime, fetched_at: datetime
    ) -> list[FetchedSourceDocument]:
        try:
            data = SECSubmission.model_validate(payload)
            recent = data.filings.recent
            n = len(recent.form)
            arrays = [
                recent.accessionNumber,
                recent.filingDate,
                recent.reportDate,
                recent.primaryDocument,
            ]
            if (
                any(len(array) != n for array in arrays)
                or recent.acceptanceDateTime
                and len(recent.acceptanceDateTime) != n
            ):
                raise ValueError("SEC column lengths differ")
            result: list[FetchedSourceDocument] = []
            for i, form in enumerate(recent.form):
                if form not in {"8-K", "10-Q", "10-K", "6-K"}:
                    continue
                accession = recent.accessionNumber[i]
                primary = recent.primaryDocument[i]
                if not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession) or not re.fullmatch(
                    r"[A-Za-z0-9_.-]+", primary
                ):
                    raise ValueError("Invalid SEC document identity")
                published = None
                if recent.acceptanceDateTime and recent.acceptanceDateTime[i]:
                    candidate = datetime.fromisoformat(
                        recent.acceptanceDateTime[i].replace("Z", "+00:00")
                    )
                    # SEC acceptance values without an explicit zone are not fabricated as UTC.
                    published = candidate if candidate.tzinfo is not None else None
                result.append(
                    FetchedSourceDocument(
                        external_id=accession,
                        canonical_url=(
                            f"https://www.sec.gov/Archives/edgar/data/{data.cik}/"
                            f"{accession.replace('-', '')}/{primary}"
                        ),
                        document_type=form,
                        title=f"{data.name} — {form} — {recent.filingDate[i]}",
                        language="en",
                        published_at=published,
                        observed_at=observed_at,
                        fetched_at=fetched_at,
                        metadata={
                            "cik": str(data.cik).zfill(10),
                            "accession_number": accession,
                            "form_type": form,
                            "filing_date": recent.filingDate[i],
                            "report_date": recent.reportDate[i] or None,
                            "primary_document": primary,
                            "feed": f"https://data.sec.gov/submissions/CIK{data.cik:010d}.json",
                        },
                    )
                )
            return result
        except (ValidationError, ValueError) as error:
            raise SourceError("invalid_payload", "Invalid SEC submissions payload") from error

    async def fetch_recent(self, limit: int = 20) -> list[FetchedSourceDocument]:
        if not 1 <= limit <= 100:
            raise SourceError("invalid_payload", "Limit must be between 1 and 100")
        result: list[FetchedSourceDocument] = []
        for cik in self.ciks:
            response, observed, fetched = await self.transport.get(
                f"https://data.sec.gov/submissions/CIK{int(cik):010d}.json"
            )
            try:
                payload: object = response.json()
            except ValueError as error:
                raise SourceError("parser_error", "SEC response is not JSON") from error
            result.extend(self.normalize(payload, observed, fetched))
        return sorted(
            result,
            key=lambda item: (
                item.published_at or datetime.min.replace(tzinfo=UTC),
                item.external_id or "",
            ),
            reverse=True,
        )[:limit]

    async def fetch_document(self, external_id: str) -> FetchedSourceDocument:
        # This sprint reads filing metadata only, never downloads filing full text.
        for item in await self.fetch_recent(100):
            if item.external_id == external_id:
                return item
        raise SourceError("document_not_found", "Filing is outside configured recent submissions")


class FedSourceAdapter(SourceAdapter):
    feed_url = "https://www.federalreserve.gov/feeds/press_all.xml"

    def __init__(self, transport: SourceTransport) -> None:
        self.transport = transport

    @staticmethod
    def normalize(
        content: bytes, observed_at: datetime, fetched_at: datetime
    ) -> list[FetchedSourceDocument]:
        if b"<!DOCTYPE" in content.upper() or b"<!ENTITY" in content.upper():
            raise SourceError("parser_error", "XML declarations/entities are prohibited")
        try:
            root = ElementTree.fromstring(content)
            channel = root.find("channel")
            if root.tag != "rss" or channel is None:
                raise ValueError("Expected RSS channel")
            result: list[FetchedSourceDocument] = []
            for item in channel.findall("item"):
                title, link = item.findtext("title"), item.findtext("link")
                if not title or not link:
                    raise ValueError("RSS item missing title or link")
                url = canonical_url(link)
                if not url.startswith("https://www.federalreserve.gov/"):
                    raise ValueError("RSS document has non-official URL")
                date = item.findtext("pubDate")
                published = parsedate_to_datetime(date) if date else None
                result.append(
                    FetchedSourceDocument(
                        external_id=item.findtext("guid") or url,
                        canonical_url=url,
                        document_type="press_release",
                        title=plain_text(title),
                        summary=plain_text(item.findtext("description") or "")[:2000] or None,
                        language="en",
                        published_at=published,
                        observed_at=observed_at,
                        fetched_at=fetched_at,
                        metadata={"feed": FedSourceAdapter.feed_url, "guid": item.findtext("guid")},
                    )
                )
            return result
        except (ElementTree.ParseError, ValueError, TypeError) as error:
            raise SourceError("parser_error", "Invalid Federal Reserve RSS payload") from error

    async def fetch_recent(self, limit: int = 20) -> list[FetchedSourceDocument]:
        if not 1 <= limit <= 100:
            raise SourceError("invalid_payload", "Limit must be between 1 and 100")
        response, observed, fetched = await self.transport.get(self.feed_url)
        return self.normalize(response.content, observed, fetched)[:limit]

    async def fetch_document(self, external_id: str) -> FetchedSourceDocument:
        for item in await self.fetch_recent(100):
            if item.external_id == external_id:
                return item
        raise SourceError("document_not_found", "Document is outside current Fed feed")
