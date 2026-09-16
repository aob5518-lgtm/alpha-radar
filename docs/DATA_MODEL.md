# Data Model Conventions

## Identity

Every Asset uses a canonical internal UUID primary key. Seeded assets receive deterministic UUIDv5
values so repeated seed runs and independent local environments refer to the same identities.

Symbols are labels, not identifiers, and are intentionally not globally unique. A case-insensitive
symbol index supports lookup while allowing the same symbol in different markets. Slugs are stable,
globally unique, lowercase application identifiers. Renaming a slug is therefore an explicit data
migration rather than a presentation-only change.

`AssetProviderMapping` references `Asset.id`. The `(provider, provider_asset_id)` pair is unique,
preventing one provider identifier from resolving to multiple canonical assets. Providers are stored
in lowercase; provider symbols retain the provider's representation.

`AssetAlias` also references `Asset.id`. Aliases are normalized with trimmed, collapsed whitespace
and lowercase Unicode text. `(asset_id, normalized_alias)` is unique, but the same normalized alias
may belong to multiple assets because entity resolution must preserve ambiguity rather than choose an
arbitrary asset.

The detail API resolves an identifier in this deterministic order: canonical UUID, lowercase slug,
then case-insensitive symbol. UUID and slug matches are unique. A syntactically valid UUID is never
reinterpreted as a slug or symbol. A missing identifier returns 404; a symbol that matches multiple
assets returns 409 with candidate slugs.

Market capitalization uses `numeric(30, 8)` and application `Decimal`, never floating point. Asset
metadata uses PostgreSQL JSONB. Asset and mapping timestamps use timezone-aware `timestamptz` values.

## Market instruments and observations

`MarketInstrument.asset_id` references the canonical Asset UUID. It represents one
provider-addressable spot pair or index, not a replacement for Asset identity. The unique provider
identity is `(provider, provider_instrument_id)`. Instrument types initially used are `spot` and
`index`; enum values also accommodate `perpetual`, `future`, and `option` without modeling a
derivative as a new Asset. `AssetProviderMapping` is retained separately.

Every instrument and observation stores explicit base and quote currencies. USD, USDT, USDC, EUR,
and other quotes are distinct and are not implicitly converted.

`MarketQuote` stores append-only observations in a Timescale hypertable partitioned by
`observed_at`. Its Timescale-compatible primary key includes `(id, observed_at)`. `MarketCandle` is a
hypertable partitioned by `open_time`; its primary/unique identity is
`(provider, market_instrument_id, interval, open_time)`, which includes the partition column and
supports idempotent upserts.

Prices, bid/ask, sizes, OHLC, volume, and quote volume use `numeric(38, 18)` / `Decimal`. Quality and
provider metadata use JSONB. All market observations reference `Asset.id`, never a ticker.

## Time

Normalized timestamps are stored in UTC using PostgreSQL `timestamptz`. The model must keep distinct
semantics for `published_at`, `fetched_at`, `detected_at`, and `event_time`; these fields are not
interchangeable. Application code should use timezone-aware datetime values.

Market data additionally distinguishes `provider_timestamp`, `observed_at`, and `ingested_at` for
quotes, and `open_time`, `close_time`, optional `provider_timestamp`, and `ingested_at` for candles.
A provider timestamp is nullable and must never be inferred from receipt time.

## Information lineage

The required progression is:

```text
Article -> Story Cluster -> Event
```

An Article is a sourced record. A Story Cluster groups reports about the same underlying information
and distinguishes independent evidence from syndication. An Event is a structured real-world
occurrence derived from evidence; an article is never automatically an event. Provenance links must
be retained throughout this progression.

Sprint 3 names the canonical upstream record `SourceDocument` so it covers filings, official
releases, RSS items and future licensed articles without claiming each record is an Article or Event.
`Source` identifies the publisher/feed. `SourceDocumentVersion` preserves immutable observed
revisions. Identity uses source-scoped external ID and canonical URL; content hash detects changes,
not semantic equivalence. Publisher, observation, fetch and ingestion timestamps remain distinct.
See `SOURCES.md`.

## Strategy / Opportunity demo contracts

Theme, Opportunity, EarlyProject, AirdropOpportunity, Catalyst, StrategyPlaybook, CycleReadiness,
ExitFramework and Outcome are presentation-only TypeScript contracts, not persisted tables.
All strategic fixtures carry `isDemo: true`; relation IDs resolve against deterministic catalogs.
`affectedAssetIds` always uses existing canonical Asset UUIDs. There is no duplicate Asset,
MarketInstrument, quote or candle source of truth. Radar linkage remains an independent typed demo
reference adapter, not a backend Event foreign key.
Every object has fact/analysis/scenario/model-output/counterpoint/invalidation blocks. Fictional
FACT is explicitly labeled. Scheduled dates can be null, probability uses uncalibrated demo bands,
and Outcome observation dates, return, drawdown, correctness and version remain null/unobserved.
Future persisted models require Alembic migrations and language-neutral facts/provenance; do not
reuse LocalizedText fixtures as canonical backend storage. See `STRATEGY_ENGINE.md`.

## Schema changes

Every schema change requires a forward-safe Alembic migration. Migrations must preserve history,
avoid irreversible destructive operations, use appropriate indexes, and document TimescaleDB
hypertable decisions. Vector columns will use pgvector only when a feature needs them.
