# Alpha Radar — Master Specification

Version: 0.1
Status: Active Development

## 1. Product Vision

Alpha Radar is an AI-powered financial intelligence and asset discovery platform.

It continuously monitors:

- financial markets
- macroeconomic events
- regulatory developments
- company disclosures
- crypto markets
- on-chain activity
- capital flows
- narratives
- future catalysts

Its core intelligence pipeline is:

Information
→ Event
→ Interpretation
→ Asset Impact
→ Market Expectations
→ Mispricing
→ Opportunity / Risk
→ Outcome Evaluation

The platform must answer:

1. What happened?
2. Why does it matter?
3. Which assets are affected?
4. Has the market already priced it in?
5. Where may opportunity or risk exist?

Alpha Radar is not intended to be another generic financial news feed.

The web experience should support English and Simplified Chinese. Canonical financial data,
provider identifiers, tickers, slugs, and API enum values remain language-neutral; localization is a
presentation-layer concern.

## 2. Initial Scope

V1 focuses on:

- Crypto
- US equities
- US ETFs
- US macro
- US financial regulation

Initial universe target:

Crypto:
100–200 assets

US equities:
100–300 assets

ETFs:
20–50

Macro indicators:
30–50

Initial development/test assets:

Crypto:
BTC
ETH
SOL
XRP
ADA
LINK
AVAX
DOGE

Equities:
COIN
CRCL
NVDA

ETFs:
SPY
QQQ
GLD

Macro/reference:
DXY
US10Y

## 3. Core Product Modules

### Command Center

Route:

/

Purpose:

Answer "What matters today?"

Core components:

- major markets
- market regime
- top opportunities
- high-impact events
- major risks
- AI briefing
- watchlist alerts

### Radar

Route:

/radar

Purpose:

Monitor past, present, and future market-moving events.

Views:

- Today
- This Week
- Upcoming
- Breaking
- High Impact
- Macro
- Regulation
- Crypto
- Earnings
- ETF
- Protocol

### Discover

Route:

/discover

Purpose:

Identify asymmetric opportunities and risks.

Potential sections:

- Top Opportunities
- Underpriced Catalysts
- Emerging Narratives
- Smart Money
- Momentum + Fundamentals
- High Conviction
- High Risk

### Asset Intelligence

Route:

/assets/[symbol]

Sections:

- Overview
- Market
- AI Thesis
- Catalysts
- Events
- Fundamentals
- Capital Flow
- Narratives
- Related Assets
- Risk
- Historical Event Response

AI Thesis should eventually support:

- Bull Case
- Base Case
- Bear Case
- Key Catalysts
- Risks
- Kill Conditions

### Watchlist

Route:

/watchlist

Users monitor selected assets and their:

- Alpha Score
- latest important event
- upcoming catalyst
- risk
- alerts

### Alerts

Route:

/alerts

Alert categories may include:

- major events
- score shifts
- price anomalies
- volume anomalies
- regulatory changes
- catalyst proximity
- narrative acceleration
- portfolio exposure

Severity:

LOW
MEDIUM
HIGH
CRITICAL

### AI Analyst

Route:

/analyst

The AI Analyst must retrieve current platform data before answering time-sensitive questions.

Answers should eventually include:

- conclusion
- evidence
- reasoning
- confidence
- related assets
- related events

### Product Shell and Intelligence Map

The first product-shell implementation validates the information architecture before the real
Sources, Story Clustering, Event Engine, and Event-to-Asset Mapping domains exist. It provides the
shared navigation for Command Center, Radar, Discover, Assets, Watchlist, Alerts, and AI Analyst,
plus three Radar presentations: Timeline, Impact Map, and Heatmap.

This implementation uses a fixed, deterministic sample snapshot. Every sample event, relationship,
source, score-like value, and derived surface must be visibly marked `Demo Data` or
`Sample Intelligence` in both supported languages. Sample sources are illustrative references and
must never be presented as fetched evidence. The shell does not provide live intelligence,
investment recommendations, persisted watchlists, notifications, or model-generated answers.

The product shell previews the future user experience without changing the required intelligence
lineage:

```text
Article -> Story Cluster -> Event -> Asset Mapping -> Impact
```

When those domains are implemented, validated API contracts will replace the fixtures; presentation
components must not become a parallel event domain.

## 4. System Architecture

Initial architecture:

Modular monolith + asynchronous workers.

Do not introduce distributed microservices prematurely.

Logical flow:

External Data Sources
↓
Ingestion
↓
Normalization
↓
Raw Data / Articles
↓
Story Clustering
↓
Event Engine
↓
Asset Mapping / Knowledge Graph
↓
AI Analysis
↓
Scoring
↓
Opportunity / Risk Engine
↓
API
↓
Web Application

## 5. Technical Stack

Frontend:

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- TanStack Query
- TanStack Table
- Zustand when useful
- Lightweight Charts

Backend:

- Python
- FastAPI
- Pydantic
- SQLAlchemy
- Alembic

Data:

- PostgreSQL
- TimescaleDB
- pgvector

Infrastructure:

- Redis
- background worker initially using Celery or an equivalent approved implementation
- Docker
- Docker Compose

CI:

GitHub Actions

Keep early infrastructure cloud-neutral.

## 6. Repository Structure

Target logical structure:

alpha-radar/
  apps/
    web/
    api/
    worker/
  packages/
    ui/
    types/
    config/
    sdk/
  services/
    ingestion/
    events/
    scoring/
    ai/
    alerts/
    graph/
  docs/
    MASTER_SPEC.md
    ROADMAP.md
    ARCHITECTURE.md
    DATA_MODEL.md
    AI_SYSTEM.md
    ADR/
  infra/
    docker/
  scripts/
  tests/
  AGENTS.md

Exact implementation may evolve if documented, but major changes require justification.

## 7. Core Data Concepts

### Asset

Canonical internal financial entity.

Important rule:

Symbols are not primary identifiers.

Use internal UUIDs.

### Provider Mapping

Maps canonical Asset IDs to provider-specific IDs.

Example:

Asset BTC
↳ Binance BTCUSDT
↳ Coinbase BTC-USD
↳ CoinGecko bitcoin

### Article

Raw or normalized published content.

### Story Cluster

Groups multiple reports referring to the same underlying information.

Prevents syndicated/reposted content from being mistaken for independent confirmation.

### Event

A structured real-world market-relevant occurrence.

Examples:

- Fed decision
- regulation vote
- earnings result
- ETF approval
- protocol upgrade
- token unlock
- security incident

### EventAsset

Maps events to affected assets.

Should support:

- relationship
- direction
- impact
- confidence
- time horizon
- impact order
- reasoning

### AssetRelationship

Represents relationships between financial entities.

Examples:

USDC → CRCL
revenue_driver

Ethereum → LDO
ecosystem_dependency

### Narrative

Represents market narratives such as:

- AI
- RWA
- stablecoins
- DePIN
- tokenization
- rate cuts
- crypto regulation

### Score

Versioned financial intelligence output.

Potential component scores:

- Fundamental
- Valuation
- Catalyst
- Capital Flow
- Momentum
- Narrative
- Sentiment
- Risk
- Alpha

## 8. Event Intelligence Pipeline

Raw Source
↓
Normalize
↓
Deduplicate
↓
Story Cluster
↓
Entity Extraction
↓
Event Extraction
↓
Classification
↓
Asset Mapping
↓
Impact Analysis
↓
Source Confidence
↓
Analysis Confidence
↓
Scoring
↓
Persist
↓
Radar / Discover / Alerts

Each stage should eventually be inspectable.

## 9. AI Principles

Use AI where semantic/reasoning capability adds value.

Do not use expensive AI where deterministic systems are sufficient.

AI layers:

1. Extraction
2. Classification
3. Asset Mapping
4. Impact Reasoning
5. Scenario Analysis
6. Confidence Estimation
7. Research/Analyst synthesis

AI must not directly control final Alpha Score in initial V1.

## 10. Source Trust

The system should support a source trust framework.

Example tiers:

Tier A:
Government, regulator, legislature, central bank, company IR, canonical protocol source.

Tier B:
Major professional financial news organizations.

Tier C:
Specialist financial/crypto media.

Tier D:
Social media/community/user-generated sources.

Source confidence answers:

"How confident are we that the event/fact is real?"

Analysis confidence answers:

"How confident are we that our interpretation of the market impact is correct?"

These must remain separate.

## 11. Event Model

Events should eventually support statuses:

- rumored
- scheduled
- confirmed
- ongoing
- completed
- cancelled
- superseded

Events should support parent/child relationships.

Example:

CLARITY Act
├ Committee action
├ Cloture vote
├ Amendment
├ Final Senate vote
├ House reconciliation
└ Signature

## 12. Event-to-Asset Intelligence

An EventAsset relation should eventually contain:

- event_id
- asset_id
- relationship_type
- direction
- impact_score
- analysis_confidence
- time_horizon
- impact_order
- reason

Direction:

- bullish
- bearish
- mixed
- neutral

Time horizon:

- intraday
- short
- medium
- long

Impact order:

- first_order
- second_order
- third_order

## 13. Alpha Score

V1 Alpha Score should be deterministic and explainable.

Initial conceptual components:

Fundamental
Catalyst
Capital Flow
Valuation
Momentum
Narrative
Sentiment
Risk

Initial example weighting:

Fundamental: 20%
Catalyst: 20%
Capital Flow: 15%
Valuation: 15%
Momentum: 10%
Narrative: 10%
Sentiment: 10%

Risk is applied as a penalty.

These weights must be configurable/versioned, not scattered as hardcoded constants.

Different asset classes may later use different models.

## 14. Opportunity

Opportunity should NOT simply equal Alpha Score.

Conceptually:

Opportunity
=
Impact
× Probability
× Mispricing
× Confidence
× Timing
− Risk

Important principle:

A highly important event may offer little opportunity if it is already fully priced in.

## 15. Priced-In Engine

Goal:

Estimate how much a known catalyst or expectation is already reflected in market prices.

Potential inputs:

- 7d returns
- 30d returns
- volume
- volatility
- options
- open interest
- funding
- prediction market probabilities
- news intensity
- social attention

Potential outputs:

- Expectation Score
- Priced-In Score
- Surprise Score

## 16. Historical Impact

The system should eventually record the market outcome following events.

Possible horizons:

- 5m
- 1h
- 24h
- 7d
- 30d

Store:

- returns
- volatility response
- volume response
- relative performance where applicable

This becomes the basis for:

- historical analogues
- backtesting
- prediction evaluation
- model calibration

## 17. Prediction Evaluation

Predictions should eventually be evaluated against actual market outcomes.

Example:

Prediction:
SOL bullish
Impact 82

Observed:
1h +1.2%
24h +5.1%
7d +8.4%

Persist results for later model evaluation.

The long-term proprietary asset is the prediction/outcome dataset.

## 18. Security

Never expose provider secrets to frontend code.

Authentication and authorization must eventually be server-enforced.

All external inputs require validation.

Support rate limiting.

Sanitize sensitive logs.

## 19. Observability

Eventually track:

- API latency
- API errors
- worker failures
- source failures
- data freshness
- AI latency
- AI usage/cost
- event processing latency

Possible tools later:

- Sentry
- PostHog

Do not overbuild infrastructure in Sprint 0.

## 20. Performance Targets

Initial goals:

Cached dashboard API:
p95 under 500ms

Asset APIs:
p95 under 1s when practical

Breaking-event source detection:
target under 60 seconds where provider capabilities allow

Event analysis:
target under 120 seconds

## 21. V1 Non-Goals

Do NOT prioritize:

- exchange functionality
- wallets
- DEX
- copy trading
- social network
- NFT marketplace
- automated trading execution
- advanced strategy marketplace
- native mobile apps

Core focus:

Financial intelligence and opportunity discovery.

## 22. Long-Term Moat

Long-term proprietary assets:

- Event Graph
- Asset Graph
- Historical Event Impact Database
- Prediction / Outcome Dataset
- Source Reliability Dataset
- User Relevance Graph
- Alpha / Opportunity Models

The LLM itself is not the primary moat.
