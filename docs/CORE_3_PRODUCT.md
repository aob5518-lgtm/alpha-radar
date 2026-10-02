# Alpha Radar Core 3 Product

Status: Current product scope

## Principle

Alpha Radar optimizes for usefulness, accuracy, speed and clarity. The entire user-facing product
must be understandable within seconds and has exactly three primary destinations:

| Route | Purpose | Data boundary |
| --- | --- | --- |
| `/events` | Important financial events | Validated Event records with source provenance; honest empty state until Event Engine ships |
| `/chart` | Crypto chart, structural support/resistance and trend | Persisted provider MarketQuote and closed MarketCandle records |
| `/analyst` | Structured market interpretation | Rehydrated Chart context, validated Events and source evidence; disabled until model integration |

English and Simplified Chinese are supported without localizing canonical IDs, symbols, enum values
or provider identities.

## Navigation and legacy routes

Primary navigation contains Events, Chart, AI Analyst and locale control only. `/` redirects to
`/events`. Historical Command Center, Discover, Strategy, Cycle, Watchlist, Alerts, Asset Directory,
Radar, Impact Map and Heatmap routes redirect to the closest Core 3 destination. `/radar/sources`
remains a deliberately unlinked internal provenance view.

The historical code and documentation remain available for audit, but demo Strategy/Opportunity or
Intelligence fixtures are not imported into Core 3 pages. Useful Asset, Market Data, Source,
PostgreSQL, Redis and Celery foundations remain active.

## Events

Events uses a compact calendar layout with Today, This Week and Calendar views. Critical and High
importance are the default; Medium is opt-in and Low is excluded by default. A future canonical
Event carries distinct scheduled, actual release, detected and updated timestamps. Every displayed
time has explicit timezone semantics. A date-only schedule renders “time not announced.”

SourceDocument is upstream evidence, not an Event. The Events page never exposes raw ingestion noise
or converts a document into an event client-side. Until Event persistence and extraction are
implemented, the production page is deliberately empty.

## Chart

Chart supports `1m`, `5m`, `15m`, `1h`, `4h`, `1d` and `1w` from centralized interval definitions.
It requests up to 1,000 persisted observations and never fills missing candles. Quote price,
provider, quote currency and freshness remain visible. Lightweight Charts renders candlesticks,
minimal volume, current price and S1–S3/R1–R3.

Structural levels and Trend Regime are deterministic technical context, not AI and not predictions.
See `TECHNICAL_LEVELS.md`.

## Analyst

Chart links to Analyst with canonical asset UUID and timeframe only. Analyst re-resolves the Asset,
retrieves persisted quote/history and recomputes technical values. It does not trust price, level or
event facts supplied through URL state.

The output contract is structured into Market State, Trend, Key Resistance, Key Support, Important
Recent Events, Bull Case, Bear Case, Trigger Conditions, Invalidation/Risk and Watch Next. Statements
are typed as FACT, ANALYSIS or SCENARIO and retain source references. Model provider/version and
generation timestamp are required when an AI backend is introduced. The current shell makes no
model call and generates no substitute answer.

## Archived scope

Theme/opportunity scoring, strategy/cycle dashboards, airdrop dashboards, generic news feed,
automatic trading, order placement and wallet execution are outside current scope. Authentication,
real Event extraction and production LLM integration require separate reviewed phases.
