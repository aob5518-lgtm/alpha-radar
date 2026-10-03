# Alpha Radar

Alpha Radar is a focused financial intelligence product with three primary surfaces: Important
Financial Events, a professional Crypto Chart with deterministic structural levels and trend, and a
platform-grounded AI Analyst. Events and AI remain honest integration boundaries until their real
backend phases ship; fictional intelligence is not used to fill those gaps.

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

Primary product routes are `/events`, `/chart`, and `/analyst`; `/` redirects to Events.

Verify the running stack, database extensions, and Redis:

```bash
./scripts/verify-stack.sh
```

For an approved real-provider production deployment, set at minimum:

```dotenv
APP_ENV=production
MARKET_DATA_PROVIDER=coinbase
MARKET_DATA_INGESTION_ENABLED=true
EVENT_SYNC_ENABLED=true
SOURCE_CONTACT_IDENTITY=Alpha Radar Operations <monitored@example.com>
```

Run all required interval backfills once, then execute `python scripts/verify-production.py`.
Production readiness returns HTTP 503 when mock/disabled market data is configured or any supported
timeframe lacks current closed history. The report includes provider/ingestion mode, latest history
timestamps, Event sync status, AI configuration and Redis limiter status, and streaming mode.

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
python -m alpha_radar.events.seed
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

The canonical Asset API remains active. The former Asset Directory route redirects to Chart and is
not a primary product surface.

## Market data API

- `GET /api/v1/assets/{identifier}/quote` returns the latest persisted quote with provider,
  currencies, timestamp semantics, quality flags, and backend-computed freshness.
- `GET /api/v1/assets/{identifier}/history` accepts `interval`, `start`, `end`, and bounded `limit`
  parameters and returns candles ordered oldest to newest. Supported intervals are 1m, 5m, 15m,
  1h, 4h, 1d and 1w.
- `WS /api/v1/assets/{identifier}/stream` emits normalized real-time ticks when the configured
  provider supports streaming. Coinbase uses its public Exchange ticker channel. The open candle is
  visual only; technical calculations remain closed-candle-only.

## Event API

- `GET /api/v1/events` supports pagination, time range, importance, type, status and canonical Asset
  filters. Critical and High are the default importance set.
- `GET /api/v1/events/{event_id}` returns the canonical event, affected Assets and official source
  references.
- The idempotent `python -m alpha_radar.events.seed` command installs curated official BLS, BEA and
  Federal Reserve 2026 schedules without inventing actual, forecast, previous or unannounced times.
- Optional `EVENT_SYNC_ENABLED=true` polling checks only official BLS CPI/PPI/Employment, BEA GDP,
  and Federal Reserve monetary-policy feeds. Releases and schedule revisions retain source-document
  provenance. An Event completes only with official release evidence; unsupported actual/previous
  values remain null and forecast remains null.

## AI Analyst

AI is unavailable by default. To enable the provider-neutral OpenAI adapter, set `AI_PROVIDER=openai`,
`AI_MODEL`, and server-only `OPENAI_API_KEY`. Never prefix the key with `NEXT_PUBLIC_`. Each request
rebuilds context from the canonical Asset, latest quote, closed candles, frozen V1.1 technical
engines, recent validated Events and their source references. Strict structured output records
provider/model and context timestamps.
The server route enforces a 16 KiB body bound, the 2,000-character question bound, Redis-backed
per-client and global request limits, and a global concurrency lease. Defaults are 10 requests per
client per minute, 60 globally per minute, and 3 concurrent model calls.

The market WebSocket defaults to two connections per client/IP and 100 globally. Redis leases are
released on disconnect and expire after idle sessions; each browser connection currently owns one
upstream provider stream, so these caps are intentionally conservative.

REST ingestion calls run in Celery tasks. The read APIs serve persisted data; only the explicit
WebSocket stream endpoint opens a provider market-data stream when streaming is configured.

## Repository map

- `apps/`: runnable web, API, and worker applications
- `packages/`: shared frontend contracts and future configuration packages
- `services/`: logical modular-monolith domain boundaries
- `infra/docker/`: container build and database initialization files
- `docs/`: product, roadmap, architecture, and data-model decisions
- `scripts/`: developer and verification utilities
- `tests/`: cross-application integration tests
