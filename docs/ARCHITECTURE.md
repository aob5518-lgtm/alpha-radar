# Alpha Radar Architecture

## Shape

Alpha Radar is a modular monolith with a separately running asynchronous worker. The API and worker
share one installable Python package so configuration, database access, logging, and future domain
modules do not diverge. This is an operational separation, not a microservice boundary.

```text
Browser -> Next.js web -> FastAPI API -> PostgreSQL/TimescaleDB + pgvector
                                      -> Redis
                           Celery worker <- Redis
                                      -> PostgreSQL/TimescaleDB + pgvector
```

## Applications

- `apps/web`: Next.js App Router, React, strict TypeScript, Tailwind CSS, and shadcn-compatible UI.
- `apps/api`: FastAPI transport plus the shared `alpha_radar` Python package.
- `apps/worker`: deployment entry-point documentation; the worker imports `alpha_radar.worker` from
  the same backend package.

Logical domain boundaries are implemented inside the shared backend package and may also be
represented by top-level `services/` documentation placeholders. They are added incrementally
without network boundaries.

## Asset domain

`alpha_radar.assets` is the first domain module. HTTP routes validate transport concerns and call
the asset service; the service owns identifier-resolution rules and response composition; the
repository owns SQLAlchemy queries. Routes never query the database directly. The API and worker
continue to share the package, so future asynchronous asset work can reuse the same models and
services without an HTTP dependency.

Frontend asset contracts live in `packages/types`. The Next.js server-side API client consumes
those contracts and uses the private `API_URL`, allowing Compose to call `http://api:8000` without
exposing an internal hostname to browsers.

## Market-data domain

`alpha_radar.market_data` adds a provider-neutral boundary inside the modular monolith. A canonical
Asset may have multiple provider-addressable `MarketInstrument` records. Provider adapters emit
typed normalized DTOs; the ingestion service validates provenance and quality; repositories persist
observations. HTTP handlers only resolve assets and read PostgreSQL, so external provider latency or
availability never enters the request path.

Celery tasks reuse the existing worker and Redis broker. Beat schedules provide conservative quote
and 1m-candle polling defaults, while external ingestion is disabled unless explicitly configured.
The deterministic mock provider supports tests and integration verification without network access.
The Coinbase adapter is an optional development adapter, not a commercial data entitlement.

## Health semantics

`GET /api/v1/health` is a process liveness endpoint. `GET /api/v1/health/ready` checks PostgreSQL and
Redis and returns HTTP 503 while either dependency is unavailable. Docker uses liveness after it has
already sequenced API startup on healthy infrastructure; operators can use readiness for traffic
gating. The worker is sequenced directly on PostgreSQL and Redis and does not require the HTTP API.

## Data and migrations

PostgreSQL is the system of record. The database image supplies TimescaleDB and pgvector; the init
script and the first Alembic migration idempotently enable both extensions. All future schema changes
must use Alembic. Redis is ephemeral coordination/cache infrastructure and the Celery broker/result
store, not a source of truth.

Market quotes and candles are Timescale hypertables partitioned on `observed_at` and `open_time`,
respectively. Quotes are append-only observations. Candles use provider/instrument/interval/open-time
identity with atomic upserts, allowing an open candle to be updated without duplicating history.
Financial values use fixed-precision NUMERIC/Decimal types. See `docs/MARKET_DATA.md` for timestamp,
quote-currency, freshness, quality, provider, and licensing semantics.

## Cross-cutting foundations

Settings are environment-driven and validated by Pydantic. Structlog emits JSON with UTC timestamps
and request correlation IDs. Expected, validation, and unexpected API failures share a typed error
envelope. Secrets are excluded from version control and must never be logged.

## Internationalization

English and Simplified Chinese localization is owned by the Next.js presentation layer. The backend
API, database schema, canonical asset fields, provider identifiers, enum values, UUIDs, and slugs
remain language-neutral. Frontend pages translate copy and enum presentation labels without changing
the API contract or route structure.

The web app keeps the existing unprefixed routes such as `/`, `/assets`, and
`/assets/[identifier]`. Locale preference is stored in an unauthenticated cookie named
`alpha_radar_locale`, validated against the supported locale list, and read by server-rendered pages
so the first HTML response is already localized. After authentication is introduced, this cookie can
be synchronized with a user preference while continuing to provide a fallback for anonymous users.

Locale catalogs live under `apps/web/messages`, while centralized locale utilities, label helpers,
and `Intl`-based date, number, percent, and currency formatters live under `apps/web/src/lib/i18n`.
Future AI Analyst requests must receive the user's preferred locale so model output can match the UI
language, but AI integration remains deferred.

## Product shell and demo-intelligence boundary

The web application owns a presentation-only Intelligence Map shell. Language-neutral TypeScript
contracts for `RadarItem`, `AssetImpact`, source tier, direction, impact, horizon, order, confidence,
status, and priced-in state live in `packages/types`. Deterministic fixtures and pure filtering/view
derivations live under `apps/web/src/lib/intelligence`; they do not call the network and all fixture
records carry `isDemo: true`.

The fixed sample snapshot is intentionally independent from wall-clock time so UI behavior and tests
remain reproducible. Demo assets reference the existing canonical Asset UUIDs, allowing Asset pages
to link into filtered Radar views without using ticker symbols as business identifiers. Tickers are
used only as human-readable route query conveniences.

`RadarItem` keeps `eventTime`, `publishedAt`, `detectedAt`, and optional `updatedAt` separate. The
Timeline sorts by event time with a detected-time fallback; time-range filters intentionally select
by detected time relative to the fixed snapshot. Source count means the number of sample source
references, not independent confirmations. Localized title/summary blocks are presentation data;
canonical enums and UUID relationships remain language-neutral.

The hardened shell derives breaking state from `status === "breaking"` and source-reference count
from `sources.length`; neither is separately stored. `impacts` is the canonical event-to-asset
relationship list, while `assets` is derived display metadata resolved from those canonical IDs.
`RadarAsset.assetType` reuses the canonical `AssetType`. Event importance uses `ImportanceLevel`,
separate from the `ImpactLevel` describing asset effect magnitude, even though both initially use
low/medium/high presentation bands. The existing `impact` query filter selects event importance.

Categorical confidence is demo/presentation-only, not the permanent Event Engine contract. A future
real engine must use a numeric, calibrated confidence score and derive display bands separately.
`LocalizedText` likewise belongs to demo/presentation copy, not canonical backend Event storage.
Future events must retain language-neutral structured facts and source/original-language provenance,
with localization as a separate concern. Neither backend calibration nor backend localization is
implemented here.

Radar filters, selected event, and map view are backed by query parameters. Validated parameters
survive reload and browser history navigation; asset symbol/slug conveniences resolve to canonical
UUIDs, and UI updates serialize UUIDs into shareable URLs. Unknown enum values fall back safely.
Asset pages retain persisted Market quote/history, provider provenance, and freshness independently
from explicitly labeled sample Radar intelligence; neither surface substitutes for the other.

`AssetImpact` describes one event-to-canonical-asset relationship: bullish/bearish/mixed/neutral
direction, low/medium/high magnitude, confidence, intraday/short/medium/long horizon, and
first/second/third-order transmission. These ordinal sample labels are not calculated financial
scores. The Impact Map projects those relationships as labeled event-to-asset edges. The Heatmap
projects the same relationships into event rows and asset columns, with both direction and magnitude
written in each populated cell so meaning never depends on color alone.

The shell does not add backend models, migrations, provider adapters, queues, or Graph infrastructure.
The Impact Map is a frontend projection of the fixture's typed relationships rather than a graph
database. Its future source of truth remains the evidence-preserving pipeline:

```text
Article -> Story Cluster -> Event -> Asset Mapping -> Impact
```

Until those domains ship, sample source names never imply retrieval and every intelligence surface
must display the localized demo disclosure. Real Event APIs should replace the fixture adapter at the
presentation boundary rather than reuse demo records as domain entities.

## Deferred decisions

Authentication, production market-data entitlements, equities providers, events, AI integrations,
task routing, cloud deployment, telemetry vendors, and scaling policies belong to later sprints. No
Kafka, Kubernetes, WebSocket feed, or independent service is introduced.
