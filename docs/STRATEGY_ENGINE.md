# Strategy & Opportunity Product Foundation

## Scope and integrity

This is a bilingual presentation foundation, not a predictive trading system. Every strategic
object and metric is deterministic Demo/Sample data at the fixed Radar snapshot. No model runs,
real ranking, probability calibration, return promise, wallet execution, automatic trading,
scraping, notifications or saved plans are implemented. Fictional projects are not claims about
real companies or future successful protocols. Even FACT blocks describe fictional fixture facts,
not fetched real-world evidence.

Required future intelligence chain:

```text
Information -> Article -> Story Cluster -> Event -> Theme -> Opportunity
             -> Strategy -> Monitoring -> Outcome
```

The preview does not bypass source integrity or the existing foundation roadmap. Real scoring
requires sourced data, provenance, versioned inputs and historical validation. The future Outcome
dataset will support calibration; demo bands are not a permanent numeric confidence contract.

## Contracts

Presentation contracts live in `packages/types/src/strategy.ts`. They reuse Radar LocalizedText,
Horizon, ImpactLevel and categorical confidence for display only. They are not backend canonical
Event storage or database schema proposals.

`OrdinalBand` describes generic low/medium/high demo dimensions; `ProbabilityBand` describes
demo probability presentation, and `ConfidenceLevel` is reserved for confidence. These are
independent semantic contracts despite sharing initial labels, not calibrated numeric measures.

| Object | Purpose and boundary |
| --- | --- |
| Theme | Stable demo ID/slug, name, description, stage; nine ordinal presentation dimensions. No real theme scoring model or ranking. |
| Opportunity | Theme ID, type, lifecycle, canonical affected Asset UUIDs, project/catalyst IDs, thesis, counter-thesis, invalidation, watch-next, horizon, reward/risk/cost/crowding/confidence bands. No BUY/SELL fields. |
| EarlyProject | Fictional product/token stages and nine growth/activity/funding/moat/attention dimensions. Fundamentals acceleration plus attention lag is only a research hypothesis. |
| AirdropOpportunity | Project/opportunity references, token status, official distribution status, points status, speculative basis and cost/risk/reward bands. `not_announced` never implies eligibility; `none` means no distribution basis. Even demo `confirmed` would require terms, not a guarantee. |
| Catalyst | Type, nullable scheduled UTC date, date certainty, asset magnitude, explicitly demo probability band, priced-in state, preparation window and status. Fixture dates are not official schedules. |
| StrategyPlaybook | Opportunity, evidence, catalysts, bull/base/bear scenarios, research-entry conditions, invalidation, risks, monitoring, horizon, capital band and preparation action. |
| CycleReadiness | Regime, eight independent ordinal dimensions, evidence, counter-evidence, confidence and conditional scenario window. No inferred date for the next bull market. |
| BullMarketPhase | Seven illustrative preparation phases with signals, typical behavior, research, risks and exit considerations. Not a mandatory chronological sequence. |
| ExitFramework | Review triggers, profit-taking preparation, risk-reduction/invalidation conditions and time stop. No target prices or executable instructions. |
| Outcome | Strategy ID, hypothesis, nullable observation window, result, nullable return/drawdown/thesis correctness, lessons and nullable model version. All demo outcomes are unobserved; there is no real performance tracking. |

Theme stages: emerging, early, accelerating, crowded, mature, declining.

Opportunity lifecycle: discovered, researching, watching, preparing, active, maturing, crowded,
exit_watch, closed, invalidated. The displayed lifecycle is descriptive, not a transition engine.
Plans and monitoring are research checklists; no state change or persistence is implied.

Preparation actions: Research, Watch, Prepare, Interact, Wait, Avoid. Interact is a conceptual
research action, never a wallet transaction or an enabled execution button.

Cycle regimes: accumulation, early_expansion, expansion, euphoria, distribution, contraction.
Crypto market cycles are historical patterns, not deterministic four-year laws. Illustrative
phases can overlap, reverse or be skipped. Bitcoin halving does not guarantee a bull market.

## Routes and integration

- `/discover/themes`: stage filter and `theme` ID/slug detail query.
- `/discover/opportunities`: theme/stage/type filters, optional canonical `asset` UUID and
  `opportunity` detail query; explicit lifecycle display.
- `/discover`: retains existing Asset discovery, adds fictional Projects filtered by `project`
  or `theme`. Discover groups Themes, Projects, Opportunities.
- `/strategy`: overview, curated demo opportunities (not ranked), theme/catalyst/project/incentive
  watches, risk/exit watch, cycle readiness, playbooks and plans. `playbook`, `catalyst` and
  `opportunity` queries select records; anchors locate the relevant section.
- `/strategy/cycle`: cycle evidence/counter-evidence and bull-market preparation phases.

Strategy groups Cycle, Playbooks, Plans with only one new top-level navigation item. Query links
are URL-encoded, work after refresh and use stable IDs. Unknown references produce an empty/reset
state, never a fabricated record. Static demo pages have no network loading dependency; existing
Asset loading/error/not-found states remain unchanged.

Radar linkage uses a separate typed `RadarStrategyReference` fixture adapter keyed by existing demo
event ID. It adds no backend Event relation. Asset links use canonical UUIDs resolved from the
existing catalog, not a new Asset type or duplicate instrument model. Asset pages retain the
persisted quote, provider, freshness and history independently of demo strategy context. Market
prices are never used to manufacture strategy bands or outcomes.

All strategic cards distinguish FACT, ANALYSIS, SCENARIO, MODEL OUTPUT, COUNTERPOINT and
INVALIDATION. Shared disclosure and per-record Demo markers remain visible; expandable evidence
blocks expose the full distinction. Both locales follow the glossary and existing locale cookie.

## Risk discipline

- Popular is not profitable.
- Tokenless does not imply a future airdrop.
- Halving does not guarantee a bull market.
- High growth does not imply a good valuation.

Source confidence, analysis confidence, event importance, asset impact, probability, priced-in
state and opportunity are different concepts. This preview deliberately does not combine them
into an Alpha Score. Future real scoring must preserve sourced evidence and calibrated uncertainty.

## Verification and deferred work

Offline frontend tests cover stages, lifecycle, scenarios, all six analysis labels, demo markers,
airdrop semantics, nullable probability/date/performance boundaries, canonical relationships,
deep-link round trips and bilingual label parity. Existing Sprint 1/2 and Radar tests/Compose
integration remain intact. An additional stdlib-only SSR integration check verifies both locale
responses, demo distinctions, selected-record deep links, unknown-reference states, unique HTML IDs,
UTC catalyst display, and persisted Asset Market alongside strategy context. Run it against a seeded
stack with `python scripts/verify-strategy-shell.py` (optional `WEB_URL` override).
`allowImportingTsExtensions` supports the no-emit frontend's offline Node fixture tests without
adding a test runtime dependency. No backend dependencies or migration history change.

Deferred: real source/Event linkage, project adapters, persisted user plans, transition rules,
monitoring delivery, numeric scoring/calibration, observed outcomes and performance tracking.
Stop at product foundation; do not implement real strategy scoring in this sprint.
