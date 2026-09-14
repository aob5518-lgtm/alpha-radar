# Alpha Radar

Alpha Radar is an AI-powered financial intelligence and asset discovery platform. Sprint 1 adds the
canonical Asset foundation while deliberately leaving market data, events, AI, and authentication
for later work.

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
`asset_provider_mappings`, and `asset_aliases`.

## Asset API

- `GET /api/v1/assets` supports `page`, `page_size`, `search`, `asset_type`, `sort_by`, and
  `sort_order`, and returns pagination metadata.
- `GET /api/v1/assets/{identifier}` resolves UUID, then slug, then case-insensitive symbol. An
  ambiguous symbol returns HTTP 409 instead of selecting an arbitrary asset.

The web asset directory is available at <http://localhost:3000/assets>.

## Repository map

- `apps/`: runnable web, API, and worker applications
- `packages/`: shared frontend contracts and future configuration packages
- `services/`: logical modular-monolith domain boundaries
- `infra/docker/`: container build and database initialization files
- `docs/`: product, roadmap, architecture, and data-model decisions
- `scripts/`: developer and verification utilities
- `tests/`: cross-application integration tests
