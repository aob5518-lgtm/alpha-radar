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

## Official Crypto Event sources

Crypto source documents follow a separate opt-in path into the existing Event relevance gate. The
reviewed source registry is deliberately code-owned rather than an arbitrary HTML scraper:

| Source | Verified index/feed | Adapter | Allowed hostname |
| --- | --- | --- | --- |
| Ethereum Foundation Blog | `https://blog.ethereum.org/en/feed.xml` | RSS | `blog.ethereum.org` |
| Solana Official News | `https://solana.com/news/rss.xml` | RSS | `solana.com` |
| Bybit Official Announcements | `https://announcements.bybit.com/en/` | Bybit-only HTML | `announcements.bybit.com` |
| Coinbase Official Blog | `https://www.coinbase.com/blog/landing` | Coinbase-only HTML | `www.coinbase.com` |
| Bitcoin Core | `bitcoin/bitcoin` | GitHub Releases REST API | `api.github.com`, `github.com` |
| Anza Agave | `anza-xyz/agave` | GitHub Releases REST API | `api.github.com`, `github.com` |
| Sui | `MystenLabs/sui` | GitHub Releases REST API | `api.github.com`, `github.com` |
| Chainlink | `smartcontractkit/chainlink` | GitHub Releases REST API | `api.github.com`, `github.com` |
| AvalancheGo | `ava-labs/avalanchego` | GitHub Releases REST API | `api.github.com`, `github.com` |
| Dogecoin | `dogecoin/dogecoin` | GitHub Releases REST API | `api.github.com`, `github.com` |
| Bitcoin Cash Node | `bitcoin-cash-node/bitcoin-cash-node` | GitHub Releases REST API | `api.github.com`, `github.com` |

RSS item links must remain on the configured official host. HTML adapters accept only their fixed
article path and hostname. Requests do not follow redirects, so cross-domain redirects fail closed.
Network fetches require a trustworthy publisher date, use at most a 14-day lookback, and apply a
bounded item limit. Date-only HTML metadata remains date-only; no publication time is fabricated.

SourceDocument retention and Event publication are intentionally separate. A promotion, roundup,
education article, or uncertain item can remain provenance while producing no Event. Provider hints
may reject or lower an item, but cannot bypass the common deterministic relevance gate or the
optional strict AI classifier. Asset links resolve only against canonical Asset records; Event
ingestion never calculates chart levels.

Use `CRYPTO_EVENT_OFFICIAL_SOURCES` to select reviewed adapters. Keep sync disabled until at least
one selected source has passed a live read-only smoke from the deployment network. Bybit and
Coinbase may impose CDN controls, so parser availability in code is not proof of production network
access.

GitHub polling uses only `GET /repos/{owner}/{repo}/releases` for the code-owned repository list.
Public repositories work without a credential; `GITHUB_TOKEN` is an optional server-only rate-limit
credential. Repository, release ID, tag, publisher timestamp, canonical release URL, title and a
bounded excerpt remain in provenance. Deterministic release policy accepts explicit material
network activations/upgrades, hard forks, consensus/security-critical changes and mandatory node or
validator releases. Routine patches, documentation/tooling releases and unrelated prereleases do
not become Events. Additions to the repository list require code review and fixture coverage.

The SEC and Federal Reserve paths retain their mandatory monitored organization/contact identity.
Reviewed public Crypto sources instead use `AlphaRadar/0.1`; a valid configured contact identity is
appended when present, and no synthetic email is used. Crypto adapters execute independently so one
source failure cannot stop the remaining sources or roll back earlier committed Events. Redis keeps
the last-run operational result with attempted, successful, and failed source slugs plus ingested
Event count. Mixed outcomes are `degraded`; zero successful sources with failures is `failed`.

Official references:

- <https://www.sec.gov/search-filings/edgar-application-programming-interfaces>
- <https://www.sec.gov/about/developer-resources>
- <https://www.sec.gov/about/webmaster-frequently-asked-questions>
- <https://www.federalreserve.gov/feeds/feeds.htm>
- <https://docs.github.com/en/rest/releases/releases#list-releases>

## Official social signals

Social ingestion is provider-neutral at the worker boundary and disabled by default. The only
implemented provider is the official X API v2: it resolves each reviewed username through the API,
then reads a bounded seven-day user timeline with replies and reposts excluded. No browser
automation, HTML scraping, unofficial client, or invented numeric account ID is used.

The code-owned allowlist contains Elon Musk as tier 1 and official Bitcoin Core, Ethereum, Solana,
Anza, Sui, Chainlink, Avalanche, Dogecoin, and Bitcoin Cash Node accounts as tier 2. Tier 3 is
intentionally empty. Monitoring requires `CRYPTO_SOCIAL_PROVIDER=x`, a server-only
`X_BEARER_TOKEN`, and selected keys in `CRYPTO_SOCIAL_ACCOUNTS`; without all three, it remains
operationally disabled and does not fail readiness.

Each account is an independent failure boundary. Redis records the last run, attempted,
succeeded/failed accounts, posts inspected, and Events created. A post must explicitly and
unambiguously mention a tracked Asset before it can pass the relevance gate; official project
accounts additionally require a material event concept. Qualifying posts are `SIGNAL` evidence and
use `watch`/`wait_for_confirmation` semantics, never price targets, leverage, position sizing or
BUY/SELL orders. X rate-limit responses use the shared cooldown path and are retried only on a later
scheduled poll.

Official references:

- <https://docs.x.com/x-api/users/lookup/api-reference/get-users-by-username-username>
- <https://docs.x.com/x-api/posts/user-posts-timeline-by-user-id>

## API and UI

`GET /api/v1/sources`, `GET /api/v1/documents`, and
`GET /api/v1/documents/{document_id}` expose bounded, deterministic read models. Document filters
include source, source type, document type, publication bounds, and escaped title search. The
bilingual `/radar/sources` surface labels records “Source Document” and “Not yet analyzed into
Event.” It never substitutes demo Event analysis.

Deferred: real production polling configuration, broad SEC universe discovery, licensed content,
object storage, Story Clustering, Events, asset mapping, embeddings, sentiment, and scoring.
