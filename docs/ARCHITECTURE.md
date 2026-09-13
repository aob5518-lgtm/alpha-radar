# Sprint 0 Architecture

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

Logical domain boundaries live under `services/`. They are placeholders in Sprint 0 and will be
implemented incrementally without network boundaries.

## Health semantics

`GET /api/v1/health` is a process liveness endpoint. `GET /api/v1/health/ready` checks PostgreSQL and
Redis and returns HTTP 503 while either dependency is unavailable. Docker uses liveness after it has
already sequenced startup on healthy infrastructure; operators can use readiness for traffic gating.

## Data and migrations

PostgreSQL is the system of record. The database image supplies TimescaleDB and pgvector; the init
script and the first Alembic migration idempotently enable both extensions. All future schema changes
must use Alembic. Redis is ephemeral coordination/cache infrastructure and the Celery broker/result
store, not a source of truth.

## Cross-cutting foundations

Settings are environment-driven and validated by Pydantic. Structlog emits JSON with UTC timestamps
and request correlation IDs. Expected, validation, and unexpected API failures share a typed error
envelope. Secrets are excluded from version control and must never be logged.

## Deferred decisions

Authentication, provider adapters, domain models, task queues/routing, cloud deployment, telemetry
vendors, and scaling policies belong to later sprints. No Kafka, Kubernetes, or independent services
are introduced.
