# Alpha Radar Development Roadmap

## Development Philosophy

Build from data foundations toward intelligence.

Order:

Foundation
→ Assets
→ Market Data
→ Sources
→ Story Clustering
→ Events
→ Asset Impact
→ Radar
→ Knowledge Graph
→ Scoring
→ Discover
→ Watchlist
→ Alerts
→ AI Analyst
→ Smart Money
→ Portfolio Intelligence

Do not skip foundational layers in order to create superficial UI demos.

---

# Sprint 0 — Engineering Foundation

Goal:

Create a production-quality local development and CI foundation.

Required:

- repository structure
- Next.js web application
- FastAPI backend
- worker application
- PostgreSQL
- TimescaleDB
- pgvector
- Redis
- Docker Compose
- SQLAlchemy
- Alembic
- environment configuration
- health endpoint
- structured logging foundation
- standardized backend error handling foundation
- frontend linting/typecheck/build
- backend lint/typecheck/tests
- GitHub Actions
- developer README

No market functionality yet.

No auth yet.

No AI integrations yet.

Acceptance:

`docker compose up` should start the required development stack.

GET /api/v1/health should work.

CI should exist and required checks should pass.

---

# Sprint 1 — Asset Foundation

Goal:

Introduce canonical Assets.

Tasks:

- Asset database model
- UUID canonical IDs
- asset types
- provider mapping model
- initial seed data
- asset repository/service
- asset API
- asset list UI
- asset detail skeleton

Initial assets:

BTC
ETH
SOL
XRP
ADA
LINK
AVAX
DOGE

COIN
CRCL
NVDA

SPY
QQQ
GLD

API examples:

GET /api/v1/assets
GET /api/v1/assets/{symbol}

Do not use symbol as database primary key.

---

# Sprint 1.5 — Internationalization Foundation

Goal:

Add English and Simplified Chinese localization to the existing web UI before additional product
surface area is built.

Required:

- translation catalogs
- centralized locale utilities
- locale cookie persistence
- server-rendered localized pages
- reusable language switcher
- localized presentation labels for asset types and statuses
- locale-aware formatting helpers
- glossary and architecture documentation

Do not localize canonical API values or database fields.

Do not introduce locale-prefixed routes unless a later architectural decision requires it.

---

# Sprint 2 — Market Data

Goal:

Normalize price/time-series data.

Build:

MarketDataProvider abstraction

Normalized quote model

Historical data model

Timescale hypertables where appropriate

Initial APIs:

GET /api/v1/assets/{symbol}/quote
GET /api/v1/assets/{symbol}/history

Start with a limited provider set.

Do not tightly couple business logic to provider formats.

Implemented foundation:

- canonical Asset-linked market instruments
- fixed-precision quote and OHLCV observations
- quote and candle Timescale hypertables
- idempotent candle upserts
- typed mock and Coinbase Exchange provider adapters
- Celery ingestion tasks with configurable scheduling
- bounded quote/history APIs
- localized Asset Market UI
- deterministic real-PostgreSQL integration verification

Production vendor entitlements, equities feeds, WebSocket streaming, composite prices, conversion,
derivatives analytics, and technical indicators remain deferred.

---

# Sprint 3 — Sources and Articles

Goal:

Create financial information ingestion primitives.

Models:

Source
Article

Implement:

source trust metadata
raw provenance
publication/fetch times
content hashing
basic deduplication
provider adapters

No sophisticated event reasoning yet.

Implemented foundation:

- canonical Source registry with explicit publisher tier and license/storage policy
- SourceDocument identity, timestamp provenance, deterministic URL/external-ID deduplication
- append-only SourceDocumentVersion revision history
- deterministic Mock, official SEC submissions JSON, and official Federal Reserve RSS adapters
- Redis-coordinated request policy and existing Celery worker tasks, disabled by default
- bounded Source/Document APIs and bilingual `/radar/sources` UI
- offline unit tests and deterministic real-PostgreSQL integration verification

Story clustering, Event extraction, asset mapping, full-text archives, embeddings, AI, sentiment,
and scoring remain deferred.

---

# Product Shell / Intelligence Map Preview

Goal:

Validate the bilingual product navigation and financial-intelligence information architecture using
deterministic, explicitly labeled demo data.

Includes:

- Command Center shell
- Radar filters and summary metrics
- Timeline, Impact Map, and Heatmap presentations
- event detail drawer with separated fact, analysis, scenario, and model-output labels
- Discover, Watchlist, Alerts, and AI Analyst shells
- demo intelligence links on canonical Asset pages

This is a presentation-layer preview, not a change to the data-foundation sequence. It does not
implement Sources, Articles, Story Clusters, Events, live ingestion, alert delivery, authentication,
or AI. Real intelligence continues through the later roadmap sprints below, and demo fixtures must be
removed or isolated when validated domain APIs become available.

---

# Strategy & Opportunity Product Foundation Preview

Presentation-only continuation of the approved Radar shell: bilingual Theme Radar, fictional early
projects, opportunity lifecycle, incentive research, catalysts, conditional playbooks, cycle
readiness, bull-market preparation, exit review and nullable unobserved Outcome contracts.
Discover/Strategy grouping and typed Radar/Asset links use deterministic, explicitly labeled demos.
No real scoring, trading, scraping, probability calibration, cycle prediction or performance tracking.
This preview does not replace Sources/Story Clustering/Events or alter the data-foundation sequence.
Real strategy intelligence requires sourced evidence and historical validation. See `STRATEGY_ENGINE.md`.

---

# Sprint 4 — Story Clustering

Goal:

Group articles referring to the same underlying information.

Build:

StoryCluster

Article → StoryCluster relations

Track:

canonical/original source where identifiable
independent confirmation
derived report/repost

Never use raw article count as confirmation count.

---

# Sprint 5 — Event Engine

Goal:

Convert information into structured Events.

Implement:

Event schema
event types
event statuses
event time
parent_event_id
source confidence
event extraction pipeline
classification

Initial event categories:

macro
regulation
earnings
legal
ETF
token unlock
protocol upgrade
security
governance
product
partnership
M&A
capital raise
geopolitical
market structure

---

# Sprint 6 — Event-to-Asset Mapping

Goal:

Determine which assets may be affected.

Implement EventAsset.

Fields include:

relationship
direction
impact score
analysis confidence
time horizon
impact order
reasoning

Support first/second/third-order effects.

---

# Sprint 7 — Radar

Goal:

Create first high-value user-facing intelligence product.

Route:

/radar

Views:

Today
This Week
Upcoming
Breaking
High Impact
Macro
Regulation
Crypto
Earnings

---

# Sprint 8 — Knowledge Graph

Goal:

Represent financial relationships.

Initial implementation may remain in PostgreSQL.

Do not introduce Neo4j unless justified later.

Support AssetRelationship.

Examples:

USDC → CRCL
SOL → JUP
ETH → LDO

---

# Sprint 9 — Scoring

Goal:

Create deterministic versioned scores.

Implement:

Catalyst Score
Risk Score
Impact Score
initial Alpha Score

Every score must preserve inputs and version.

---

# Sprint 10 — Discover

Goal:

Surface opportunities and risks.

Route:

/discover

Initial sections:

Top Opportunities
Underpriced Catalysts
Emerging Narratives
High Conviction
High Risk

---

# Sprint 11 — Authentication and Watchlist

Goal:

Introduce users only after core public intelligence works.

Implement:

authentication
user
watchlist
saved assets
preferences

---

# Sprint 12 — Alert Engine

Goal:

Deliver high-value changes instead of requiring constant dashboard monitoring.

Initial triggers:

high-impact event
watchlist event
major score movement
risk threshold
catalyst proximity

Support cooldown and deduplication.

---

# Sprint 13 — AI Analyst

Goal:

Enable natural-language financial research over platform data.

Route:

/analyst

Pipeline:

Question
→ retrieve assets/events/market data/sources
→ reason
→ answer with evidence

Must use current platform data when available.

---

# Sprint 14 — Smart Money

Potential datasets:

ETF flows
exchange flows
whale activity
stablecoin flows
institutional capital flows

Build only after core data quality is reliable.

---

# Sprint 15 — Portfolio Intelligence

Goal:

Evaluate portfolio exposure to events, catalysts, and risks.

Features:

portfolio assets
weights
event exposure
catalyst exposure
risk concentration
portfolio alerts

Automated trade execution is NOT part of this sprint.
