# Alpha Radar

Alpha Radar is an AI-powered financial intelligence and asset discovery platform. Sprint 0 provides
the local engineering foundation only; financial features begin in Sprint 1.

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

Stop the stack with `docker compose down`. Add `--volumes` only when you intentionally want to delete
local database and Redis data.

## Frontend development

```bash
pnpm install
pnpm web:dev
```

The browser-facing API base URL comes from `NEXT_PUBLIC_API_URL`.

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
`timescaledb` and `vector` extensions and creates no domain tables.

## Repository map

- `apps/`: runnable web, API, and worker applications
- `packages/`: future shared frontend/configuration packages
- `services/`: logical modular-monolith domain boundaries
- `infra/docker/`: container build and database initialization files
- `docs/`: product, roadmap, architecture, and data-model decisions
- `scripts/`: developer and verification utilities
- `tests/`: cross-application integration tests
