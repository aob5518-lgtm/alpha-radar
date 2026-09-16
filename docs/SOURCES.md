# Sources and Source Documents

## Boundary and lineage

Sprint 3 ends at `SourceDocument`:

```text
Source -> SourceDocument -> StoryCluster -> Event -> Asset / Project Mapping
       -> Theme -> Opportunity -> Strategy -> Outcome
```

A filing, press release, RSS item, or announcement is upstream evidence—not an Event. One document
may later yield zero, one, or multiple Events. Source documents therefore have no bullish/bearish,
impact, priced-in, opportunity, or confidence fields.

## Registry, identity, and revisions

`Source` is the canonical publisher/feed registry. Its tier describes publisher category, never
analysis confidence. License class records storage policy explicitly: `public_official`,
`metadata_only`, `excerpt_allowed`, `licensed`, `unknown`, or `restricted`. Public technical access
does not imply commercial redistribution rights.

`SourceDocument` is resolved deterministically within a source by external ID and canonical URL.
URL normalization lowercases scheme/host, removes fragments/default ports and known tracking
parameters, and sorts query parameters. A disagreement between external ID and URL is rejected
rather than silently joined. Content hashes detect revisions; they do not merge similar documents.
Semantic deduplication belongs to Story Clustering.

`SourceDocumentVersion` is append-only. An unchanged refetch updates last-observed/fetched
provenance but creates no version. Changed content appends a version and atomically moves the current
pointer. Old versions remain internally queryable for point-in-time research. Delayed observations
cannot replace a newer revision. The service uses a PostgreSQL transaction advisory lock per source
plus uniqueness constraints to serialize worker ingestion.

## Time and provenance

- `published_at`: publisher-provided publication time; nullable and never synthesized.
- `publisher_updated_at`: publisher-provided revision time; distinct from database `updated_at`.
- `first_observed_at` / `last_observed_at`: Alpha Radar observation bounds.
- `first_fetched_at` / `last_fetched_at`: completed retrieval bounds.
- `ingested_at`: persistence time.
- version `observed_at`, `fetched_at`, `ingested_at`: the exact revision lineage.

All normalized times are timezone-aware UTC. Every version records provider, external ID, retrieved
and canonical URLs, license class, and adapter-specific stable identifiers in internal metadata.
Raw provider payloads and internal metadata are not returned by the public API.

## Storage policy

Sprint 3 has no object storage and never stores unrestricted full text. `raw_content_locator` is
reserved for a future policy-controlled object store and remains null. `metadata_only`, `unknown`,
and `restricted` sources do not store excerpts; `restricted` blocks ingestion. Official/excerpt or
licensed policy may preserve a bounded plain-text summary/excerpt, but full-content storage still
requires a future explicit policy and licensed-source review.

## Adapters and request policy

Adapters return validated `FetchedSourceDocument` DTOs; repositories never see provider payloads.
The deterministic Mock adapter is used by tests/CI. No CI test requires internet.

The SEC adapter uses the official `data.sec.gov/submissions/CIK##########.json` endpoint and accepts
only configured CIKs plus forms 8-K, 10-Q, 10-K, and 6-K. It preserves CIK, accession number, form,
filing date, report date, and primary document. SEC states these JSON APIs need no key and permits at
most 10 requests/second in aggregate. Alpha Radar requires a declared organization/contact
User-Agent and defaults to 2 requests/second with at least one second between requests.

The Federal Reserve adapter reads the official all-press-releases RSS feed. It preserves feed GUID
or official URL and bounded feed metadata; it does not scrape article HTML or ingest FRED series.

Redis coordinates provider request intervals across workers using server time. 403, 429, and 5xx
responses establish a shared cooldown and are not retried in-request. Failures are categorized as
temporary, rate-limited, invalid payload, parser error, not found, or policy restricted and logged
as structured fields without response payloads or credentials.
Only temporary failures receive a bounded Celery retry (at most two, capped at 15 minutes);
rate-limit/policy/parser failures wait for the next poll or operator action.

External polling is disabled by default. To opt in, set `SOURCE_INGESTION_ENABLED`, the provider
flag, a monitored `SOURCE_CONTACT_IDENTITY`, and for SEC a JSON `SEC_CIKS` list. Celery performs all
network access; HTTP request paths read PostgreSQL only.

Official references:

- <https://www.sec.gov/search-filings/edgar-application-programming-interfaces>
- <https://www.sec.gov/about/developer-resources>
- <https://www.sec.gov/about/webmaster-frequently-asked-questions>
- <https://www.federalreserve.gov/feeds/feeds.htm>

## API and UI

`GET /api/v1/sources`, `GET /api/v1/documents`, and
`GET /api/v1/documents/{document_id}` expose bounded, deterministic read models. Document filters
include source, source type, document type, publication bounds, and escaped title search. The
bilingual `/radar/sources` surface labels records “Source Document” and “Not yet analyzed into
Event.” It never substitutes demo Event analysis.

Deferred: real production polling configuration, broad SEC universe discovery, licensed content,
object storage, Story Clustering, Events, asset mapping, embeddings, sentiment, and scoring.
