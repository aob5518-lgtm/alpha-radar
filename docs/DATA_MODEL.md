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

## Time

Normalized timestamps are stored in UTC using PostgreSQL `timestamptz`. The model must keep distinct
semantics for `published_at`, `fetched_at`, `detected_at`, and `event_time`; these fields are not
interchangeable. Application code should use timezone-aware datetime values.

## Information lineage

The required progression is:

```text
Article -> Story Cluster -> Event
```

An Article is a sourced record. A Story Cluster groups reports about the same underlying information
and distinguishes independent evidence from syndication. An Event is a structured real-world
occurrence derived from evidence; an article is never automatically an event. Provenance links must
be retained throughout this progression.

## Schema changes

Every schema change requires a forward-safe Alembic migration. Migrations must preserve history,
avoid irreversible destructive operations, use appropriate indexes, and document TimescaleDB
hypertable decisions. Vector columns will use pgvector only when a feature needs them.
