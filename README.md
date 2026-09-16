# Alpha Radar

Alpha Radar is an AI-powered financial intelligence and asset discovery platform. Sprint 2 adds a
provider-neutral, point-in-time market-data foundation on top of canonical Assets while deliberately
leaving events, AI, authentication, execution, and production vendor entitlements for later work.

## Requirements

- Docker Engine with Docker Compose v2 (recommended path)
- Node.js 22 and pnpm 11 for frontend development
- Python 3.12 for backend development

## Environment setup

Copy `.env.example` to `.env`. The checked-in values are safe local-development defaults; replace
passwords before using any shared or deployed environment. Never commit `.env`.

```bash
cp .env.example .env
```

## Start with Docker

```bash
docker compose up --build
```

Open the web application at <http://localhost:3000>. API documentation is at
<http://localhost:8000/docs>, liveness at <http://localhost:8000/api/v1/health>, and dependency
readiness at <http://localhost:8000/api/v1/health/ready>.

Verify the running stack, database extensions, and Redis:

```bash
./scripts/verify-stack.sh
```

Load the deliberate, idempotent development asset seed after the stack is ready:

```bash
docker compose run --rm api python -m alpha_radar.assets.seed
```

Seeding is never run automatically during application startup.

Load deterministic sample market instruments, a quote, and candles after the Asset seed:

```bash
docker compose run --rm api python -m alpha_radar.market_data.seed
```

External market-data polling is disabled by default. See `docs/MARKET_DATA.md` before enabling the
optional Coinbase development adapter; public technical access does not grant redistribution rights.

Seed the official Source registry idempotently:

```bash
docker compose run --rm api python -m alpha_radar.sources.seed
```

Real SEC/Federal Reserve polling is disabled by default and requires explicit provider flags plus a
monitored contact identity. See `docs/SOURCES.md`; public access never implies redistribution rights.
Source APIs are `/api/v1/sources` and `/api/v1/documents`; the bilingual UI is at
<http://localhost:3000/radar/sources>.

Stop the stack with `docker compose down`. Add `--volumes` only when you intentionally want to delete
local database and Redis data.

## Frontend development

```bash
pnpm install
pnpm web:dev
```

Server-rendered pages use `API_URL`; Compose sets it to the internal API service. No browser-visible
secret or internal Compose hostname is required.

## Backend development

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e "apps/api[dev]"
cd apps/api
uvicorn alpha_radar.main:app --reload
```

When the backend runs on the host, set `DATABASE_URL` and `REDIS_URL` to use `localhost` rather than
the Compose service names. The defaults already do this when no `.env` overrides are loaded.

Seed a host-run backend with:

```bash
python -m alpha_radar.assets.seed
```

## Checks and tests

Frontend:

```bash
pnpm web:lint
pnpm web:typecheck
pnpm web:format:check
pnpm web:test
pnpm web:build
```

Backend (from `apps/api` with the development extra installed):

```bash
ruff check . ../worker
ruff format --check . ../worker
pyright
pytest
```

## Migrations

Compose runs migrations before starting the API. For local migration work:

```bash
cd apps/api
alembic upgrade head
alembic current
alembic revision --autogenerate -m "describe change"
```

Every schema change requires an Alembic migration. The initial migration verifies the required
`timescaledb` and `vector` extensions. The Sprint 1 migration creates `assets`,
`asset_provider_mappings`, and `asset_aliases`. The Sprint 2 migration creates market instruments,
quotes, and candles, and converts both observation tables to Timescale hypertables.

## Asset API

- `GET /api/v1/assets` supports `page`, `page_size`, `search`, `asset_type`, `sort_by`, and
  `sort_order`, and returns pagination metadata.
- `GET /api/v1/assets/{identifier}` resolves UUID, then slug, then case-insensitive symbol. An
  ambiguous symbol returns HTTP 409 instead of selecting an arbitrary asset.

The web asset directory is available at <http://localhost:3000/assets>.

## Market data API

- `GET /api/v1/assets/{identifier}/quote` returns the latest persisted quote with provider,
  currencies, timestamp semantics, quality flags, and backend-computed freshness.
- `GET /api/v1/assets/{identifier}/history` accepts `interval`, `start`, `end`, and bounded `limit`
  parameters and returns candles ordered oldest to newest.

Provider calls run only in Celery ingestion tasks. HTTP requests never call external vendors.

## Repository map

- `apps/`: runnable web, API, and worker applications
- `packages/`: shared frontend contracts and future configuration packages
- `services/`: logical modular-monolith domain boundaries
- `infra/docker/`: container build and database initialization files
- `docs/`: product, roadmap, architecture, and data-model decisions
- `scripts/`: developer and verification utilities
- `tests/`: cross-application integration tests
