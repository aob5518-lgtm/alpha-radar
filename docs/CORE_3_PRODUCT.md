# Alpha Radar Core 3 Product

Status: Current product scope

## Principle

Alpha Radar optimizes for usefulness, accuracy, speed and clarity. The entire user-facing product
must be understandable within seconds and has exactly three primary destinations:

| Route | Purpose | Data boundary |
| --- | --- | --- |
| `/events` | Important financial events | Canonical Event records linked to official SourceDocuments |
| `/chart` | Crypto chart, structural support/resistance and trend | Persisted history plus provider-streamed current price/open candle |
| `/analyst` | Structured market interpretation | Rehydrated Chart context, validated Events and source evidence |

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

Events uses category-appropriate time semantics. Macro retains its compact schedule-oriented Today,
This Week and Calendar views. Crypto uses Latest, 24H and 7D rolling views so verified material
events remain visible after publication; Latest is a seven-day window in V1. All defaults to a
concise Latest mix of recent Crypto events, recently released Macro events and near-term Macro
schedules. Crypto ordering uses the best canonical timestamp available: actual release, then
detected time, then scheduled timestamp/date. Critical and High importance are the default; Medium
is opt-in and Low is excluded by default. A canonical Event carries distinct scheduled, actual
release, detected and updated timestamps. Every displayed time has explicit timezone semantics. A
date-only schedule renders “time not announced.”

SourceDocument is upstream evidence, not an Event. Canonical `events`, `event_assets`, and
`event_source_references` tables keep schedules, impacted canonical Asset UUIDs and evidence
separate. The initial curated universe uses official BLS, BEA and Federal Reserve calendars for CPI,
PPI, the Employment Situation, GDP and FOMC meetings. An optional official-source synchronization
task detects releases and schedule revisions for only this universe. It updates actual/previous
values only when a strict official-source parser can derive them; forecast remains null without a
licensed consensus source. Date-only events use `scheduled_date` and never synthesize a time, and
elapsed wall-clock time alone never completes an Event.

The calendar has `All`, `Macro`, and `Crypto` category filters. Crypto records reuse the same
SourceDocument → Event pipeline and accept reviewed official RSS/Atom sources plus fixed,
provider-specific Bybit and Coinbase HTML adapters. HTML hosts and article paths are code-owned,
redirects fail closed, and initial network fetches are bounded to 14 days. An official document is
not automatically a user-facing Event. A short deterministic gate accepts
only explicit material concepts such as mainnet/token launches, listings/delistings, protocol
upgrades/hard forks, security incidents, material governance/regulatory/ETF actions, confirmed
distributions, and explicitly major integrations, partnerships, acquisitions, or product launches.
Recaps, AMAs, meetups, podcasts, tutorials, documentation updates, minor maintenance releases,
community events, and uncertain items remain SourceDocuments but do not become Events. Feed-level
importance is an upper bound, not a per-document conclusion.

When the server-side OpenAI provider is configured, a strict structured-output classifier may
further reject or downgrade a deterministically relevant candidate. Its schema permits only the
existing event types, importance bands, safe research actions, confidence bands, and a short reason.
Provider failure falls back to the deterministic classification; an unconfigured AI provider is a
fully supported mode. The classifier concerns information relevance only and cannot express price
targets, return predictions, position sizing, leverage, or trade orders.

No social site is scraped: influential social remains unavailable until a legitimate configured API
adapter exists. If later enabled, a post is a SIGNAL, not independent proof of fundamentals. The
detail surface separates FACT, SIGNAL, ANALYSIS, ACTION, and RISK. Recommended actions are limited
to watch, research, prepare, wait for confirmation, caution, or avoid; categorical confidence and
opportunity bands are presentation aids, never invented probabilities. Contract addresses remain
null unless an official source explicitly supplies and validates one.
When the Crypto filter has no qualifying records, the UI states that only verified, relevant Crypto
Events are shown; it does not fill the calendar with samples or opportunities.

## Chart

Chart supports `1m`, `5m`, `15m`, `1h`, `4h`, `1d` and `1w` from centralized interval definitions.
It requests an initial 800 persisted observations and never fills missing candles, rendering the
latest roughly 200 before lazy-loading older pages as the user pans left. Bybit production mode
uses one provider WebSocket for ticker, public trade, and Kline topics. Trades update visual partial
state; the official Kline remains authoritative. The
exchange `confirm=false` state remains labeled LIVE / PARTIAL and `confirm=true` closes the candle.
The persisted REST/backfill series remains authoritative history. Structural Levels and
Trend consume closed candles only; the streamed open candle never enters either engine.

Celery Beat maintains a bounded recent closed-candle window for every supported timeframe after the
initial backfill. Production readiness fails closed when the market provider is mock, ingestion is
disabled, or any timeframe is stale.

Structural levels and Trend Regime are deterministic technical context, not AI and not predictions.
See `TECHNICAL_LEVELS.md`.

## Analyst

Chart URLs use `/chart?instrument=<market_instrument_id>&interval=1h`. Chart links to Analyst with
that exact instrument UUID and timeframe. Analyst re-resolves the instrument, retrieves its
persisted quote/history and recomputes technical values; its linked Asset UUID is used only for
Event lookup. It does not trust price, level or event facts supplied through URL state.

Simplified Chinese Events use deterministic presentation mappings for titles, status, importance,
analysis/scenario copy, watch items, and official source names. Canonical IDs, URLs, provider
identities, and raw provenance remain unchanged. English retains canonical English presentation.
An empty filtered Event set clears the detail panel.

The provider-neutral runtime is disabled unless `AI_PROVIDER=openai`, `AI_MODEL` and the server-only
`OPENAI_API_KEY` are configured. The OpenAI adapter uses the Responses API with strict JSON Schema
output. Vendor handling is isolated under `src/lib/ai`; the UI and grounding pipeline depend only on
the internal provider interface. The server route has a 16 KiB request-body limit and a 2,000
character question limit. Redis enforces per-client and global request limits plus a global
concurrency lease; limiter failure makes the endpoint unavailable rather than unmetered.

The output contract is structured into Market State, Trend, Key Resistance, Key Support, Important
Recent Events, Bull Case, Bear Case, Trigger Conditions, Invalidation/Risk and Watch Next. Statements
are typed as FACT, ANALYSIS or SCENARIO and retain source references. Model provider/version,
generation timestamp, context timestamp and technical model version are recorded. Resistance and
support are injected from Structural Levels V1.1 after model validation, so the model cannot invent
authoritative technical levels. Missing data remains explicitly unavailable.

## Archived scope

Theme/opportunity scoring, strategy/cycle dashboards, airdrop dashboards, generic news feed,
automatic trading, order placement and wallet execution are outside current scope. Authentication
and broad automated Event extraction remain separate reviewed phases.
