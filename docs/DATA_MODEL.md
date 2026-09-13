# Data Model Conventions

Sprint 0 establishes conventions only; it intentionally creates no financial domain tables.

## Identity

Assets use canonical internal UUID primary keys. Symbols are mutable labels and must never be primary
business identifiers. Provider identifiers belong in mapping rows that reference the canonical asset
UUID, allowing one asset to map to forms such as `BTCUSDT`, `BTC-USD`, and `bitcoin`.

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
