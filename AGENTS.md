# Alpha Radar Engineering Constitution

All AI coding agents working in this repository must follow these rules.

## 1. Read Before Coding

Before implementing a feature, read:

- docs/MASTER_SPEC.md
- docs/ROADMAP.md
- relevant architecture/data-model documentation if present

If a requested task conflicts with the documented architecture, report the conflict instead of silently changing architecture.

## 2. Plan Before Implementation

For non-trivial tasks:

1. inspect existing code
2. describe the implementation plan
3. identify files that will change
4. identify schema/API changes
5. identify risks
6. implement only after the plan is coherent

Do not perform unrelated broad refactors.

## 3. Architecture

Current architecture:

Modular monolith + asynchronous background workers.

Do NOT introduce microservices unless explicitly requested.

Do NOT add a new database, queue, framework, or major architectural dependency without explicit approval.

Prefer the simplest implementation compatible with the architecture.

## 4. Frontend

Preferred stack:

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query
- TanStack Table
- Zustand where appropriate
- TradingView Lightweight Charts where appropriate

Rules:

- TypeScript strict mode.
- Avoid `any`.
- Reuse shared components.
- Do not duplicate API types unnecessarily.
- Implement loading, error, and empty states.
- Responsive layouts are required.

## 5. Backend

Preferred stack:

- Python
- FastAPI
- Pydantic
- SQLAlchemy
- Alembic

Rules:

- All endpoints require typed request and response schemas.
- Business logic should not live directly in route handlers.
- Validate all external inputs.
- Use structured errors.
- Database concerns should be separated from API transport logic.

## 6. Database

Primary database:

PostgreSQL.

Required extensions:

- TimescaleDB
- pgvector

Rules:

- Every schema change requires an Alembic migration.
- Never delete migration history.
- Avoid destructive irreversible migrations.
- Add appropriate indexes.
- Store internal timestamps in UTC.
- Use `timestamptz` where applicable.
- Preserve raw source data when it matters for provenance.

## 7. Canonical Entity IDs

Do not use ticker symbols as primary business identifiers.

Every asset must have an internal canonical UUID.

Provider-specific identifiers belong in mapping tables.

Example:

BTC internal asset UUID
↳ Binance: BTCUSDT
↳ Coinbase: BTC-USD
↳ CoinGecko: bitcoin

All Events, Scores, Watchlists, Market Data, and Relationships must reference canonical IDs.

## 8. Time Semantics

The system must distinguish:

- published_at
- fetched_at
- detected_at
- event_time

These timestamps have different meanings and must not be conflated.

Store normalized timestamps as UTC.

## 9. AI Features

AI-generated analysis must never silently replace factual source data.

Separate:

- FACT
- ANALYSIS
- SCENARIO
- MODEL OUTPUT

AI outputs must include confidence where applicable.

Important factual claims must maintain evidence/source references.

Never fabricate:

- sources
- prices
- financial data
- regulatory facts

When platform data exists, do not rely on LLM memory instead of retrieval.

Use structured, validated AI output schemas.

## 10. Financial Intelligence

Do not reduce financial analysis to keyword sentiment.

Preserve:

- direction
- magnitude
- confidence
- time horizon
- first-order effects
- second-order effects
- third-order effects

Differentiate:

- Event importance
- Asset relevance
- Probability
- Market expectations
- Priced-in level
- Actual price reaction
- Opportunity

Important does NOT necessarily mean investable.

## 11. Source Integrity

Every external record should maintain provenance.

Prefer canonical/primary sources.

Do not treat syndicated or reposted articles as independent confirmations.

Article count is not evidence count.

Source confidence and analysis confidence must remain separate concepts.

## 12. Event Model

The system must distinguish:

Article
→ Story Cluster
→ Event

An Article is not automatically an Event.

Events should eventually support parent/child relationships.

Suggested Event statuses:

- rumored
- scheduled
- confirmed
- ongoing
- completed
- cancelled
- superseded

## 13. Scoring

Initial financial scores must be deterministic and explainable.

Every score should preserve:

- input features
- weights
- model/version
- timestamp

Do not scatter scoring constants throughout the codebase.

Use versioned configuration.

## 14. Secrets

Never commit:

- API keys
- database passwords
- tokens
- credentials

Use environment variables.

`.env.example` should contain variable names and safe defaults only.

## 15. Tests

Every meaningful feature requires appropriate tests.

Backend:

- pytest

Frontend:

- project-standard unit/component testing

End-to-end:

- Playwright when applicable

Bug fixes should include regression tests when practical.

## 16. Required Checks

Before declaring a task complete, run relevant:

- lint
- formatting checks
- typecheck
- tests
- build

Report the commands and their results.

Never claim success if required checks failed.

## 17. API

API namespace:

/api/v1/...

Collection endpoints should support pagination when appropriate.

Use consistent filtering and sorting conventions.

## 18. Logging

Use structured logging.

Never log:

- secrets
- authorization headers
- private credentials
- unnecessary sensitive payloads

## 19. External Providers

External provider integrations should use adapter interfaces.

Business logic must not directly depend on provider-specific response formats.

Example:

MarketDataProvider
NewsProvider
MacroDataProvider

Normalize provider data before it enters core business logic.

## 20. Feature Flags

Experimental functionality should be gated behind feature flags where appropriate.

Do not merge incomplete experiments into critical core flows.

## 21. Definition of Done

A task is complete only when:

- implementation works
- types pass
- tests pass
- builds pass
- migrations exist when required
- documentation is updated when required
- error states are handled
- security implications are considered
- no secrets are committed
- acceptance criteria are satisfied

Always provide a concise completion report.
