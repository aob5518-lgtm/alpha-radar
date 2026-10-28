# Entry V1.2 / Trade Guide V1.1

Production/model baseline: `69a74425e68157ef634a723309d665b3996d9509`.
Engineering base: `4ec1617e17a560e244b7c89616f3519e472b173e`, which adds only
the merged PR #21 audit tooling. PR #22 is not inherited, merged or deployed.
Versions are `ma-confluence-entry-v1.2` and `trade-guide-v1.1`.

This is deterministic, unvalidated evidence quality and signal coverage.
Scores/grades are **not probability, win rate, expected return or an execution order**.
No calibration uses future returns. Structural Levels V1.1, Trend V1.1, Market State V1,
their thresholds/ranking/replay, Trade Setup, eight-marker limit, Bybit, Events and AI
remain unchanged. There are no API/schema/migration/dependency changes.

## Execution boundary

The existing revision/generation/UUID/period-guarded technical Worker remains the
authority. MA evaluation consumes its accepted closed snapshot once per new context
or MA setting. Guide consumes that result and the existing Trade Setup. Neither
calls any technical engine, provider or prefix replay. The bounded MA/ATR/MACD
passes and confirmed-pivot target pass already existed in V1; no indicator is added.
Ticker, trade, partial candles and overlay visibility are not calculation dependencies.

The result preserves legacy `confidence_score` for existing consumers; its V1.2
meaning is **evidence points**, not confidence probability. Guide exposes
`evidence_score`, `quality_grade`, component contributions, structure origin/type
and hard failures. These are local typed presentation contracts, not backend storage.

## Layer A: hard safety

1. Exact instrument UUID + interval, coherent confirmed timestamps and matching
   optional Trade Setup. Missing history (at least 250 bars and MA seed/slope) fails.
2. Bullish Trend permits long, bearish permits short. Neutral requires matching
   market structure and directional MA slope using the existing 0.15 ATR criterion,
   and no opposite State direction. A strongly opposite State (confirmed reversal,
   sharp move or opposite level confirmation) rejects. Neutral/pullback State is
   otherwise evidence, not a universal veto.
3. Original anti-chop stays strict: last 12 bars, three closes on each MA side or
   three crossings; more than four touch bars or two touch episodes rejects.
   A flat MA loses points; flat alone does not invalidate a coherent structural setup.
4. A real closed interaction with one of the structures below must exist in the
   last three bars. A continuous zone interaction retains its original start;
   sliding the window does not manufacture a fresh origin. Guide expires the setup
   after three bars, also bounded by interval duration. No wall clock/browser storage.
5. Invalidated Trade Setup, closed stop breach, invalid/nonpositive risk, missing
   real target or reached TP1 stays WAIT. No score can override these failures.
6. Existing chase distance is one ATR beyond the selected zone edge. A coherent
   plan beyond it is MISSED. Missing/unsafe structure never becomes a fabricated
   missed opportunity. A prior READY/MISSED may carry the same immutable references
   only within the existing three-bar horizon. Intervening stop/TP breaches reject.
   MISSED evidence survives a temporary WAIT within that bound; same-interaction
   recovery cannot resurrect READY. A separate nonoverlapping/new retest origin may.
   UI and replay use the same explicit `retainGuideEvidence` reducer, including
   settings/UUID/interval guards. Pending context clears it.
7. Severe momentum safety uses existing constants: opposing histogram below
   -0.10 ATR **and** opposing histogram acceleration below -0.02 ATR. Ordinary lag
   does not veto. An opposing candle in the last three bars exceeding 1.8 times
   prior-20 positive-volume mean, whose opening price has not been reclaimed,
   vetoes. Missing/light/ordinary volume only loses points. These checks execute
   even when a previous plan is used after the current retest window ends.

## Entry structures and prices

Selection priority is MA + authoritative S1/S2 or R1/R2 overlap; then structural
support/resistance pullback; then existing swing-break retest; then standalone MA
impulse/retest. Existing level order is not reranked.

- **MA:** retain V1's 24-bar one-ATR impulse, last-three contemporary MA-zone
  interactions and MA ±0.20 ATR zone. Entry reference remains
  max(zone high, previous high) for long, mirrored for short.
- **Structural:** the selected same-period S1/S2 or R1/R2 must be touched and the
  current State must confirm that overlapping reference, or be pullback/rebound.
  MA touch is not required. The reference uses the unchanged Trade Setup zone
  formula: long low +0.75 width; short low +0.25 width. It is a reference, not a fill.
- **Breakout/retest:** only existing Market State `swing_break` + `structure_held`
  evidence in a confirmed reversal supplies the observed reclaimed swing price.
  Apply the existing ±0.20 ATR interaction width; require an earlier closed break,
  a recent retest and current price-action confirmation. Short mirrors long.
  No new pivot/structure classifier is introduced.

Stop = conservative selected-zone boundary / prior retest extremum / overlapping
authoritative boundary, then **one** existing 0.25 ATR buffer. The current failure
candle cannot widen its own stop. Stops are chosen before targets/R:R, never fitted.

TP1 is the nearest forward same-period opposing zone edge or existing confirmed
swing; any target overlapping the entry zone/reference is excluded. Targets behind
the current close cause WAIT rather than skipping to a more optimistic barrier.
TP2 is the next distinct observed structure, otherwise null. No projected R multiple.

Unchanged R:R: below 1.2 WAIT; 1.2–below 1.5 WATCH; at least 1.5 READY eligible;
at least 2 favorable price-based R:R. Fees/slippage are not modeled.

## Layer B: evidence points

| Component | Fixed points |
| --- | --- |
| Trend / 20 | strong aligned 20; neutral structural 12; weak aligned 8 |
| MA / 15 | aligned + MA entry/confluence 15; aligned structural entry 10; flat/opposite 0 |
| State / 15 | support/resistance confirmed 15; pullback/rebound or aligned reversal confirmed 12; bottoming/topping 8; neutral/other 5; opposed 0 |
| MACD / 10 | strong aligned 10; mildly aligned/improving 6; neutral/unavailable 3; conflict 0 |
| Volume / 10 | expansion ≥1.8 prior mean 10; normal ≥0.8 mean 6; light ≥0.5 mean 3; weak/missing 0 |
| Structure / 15 | MA + S/R 15; clean structural 12; break/retest 10; standalone MA structure 5 |
| Price / 15 | reclaim/rejection plus previous high/low break 15; good close 10; acceptable 6; weak 0 |

Closed price confirmation needs a directional body and close beyond the relevant
zone edge. Top/bottom 35% of range is good, additionally breaking previous high/low
is strong; directional half of range is acceptable. A weak close cannot be READY.
These are V1.2 evidence rules, not modifications to the frozen State engine.

A ≥80; B 70–79; C 60–69; below 60 no letter. READY requires all safety checks,
confirmed price action, R:R ≥1.5 and ≥70 points. Coherent lesser evidence stays
WATCH with known structure, stop and target; the UI shows only the potential zone
and waiting condition, not the full READY plan. A/B/C is ordinal quality, not odds.

## UI and validation

One existing Guide surface retains the six localized states and one primary arrow.
A/B/C follows the READY/WATCH badge. One wrapping row shows localized positive,
neutral and negative evidence; numeric contributions are available on hover.
WATCH never displays a confirmed stop/TP plan. No new panel/route/indicator.

The immutable V1 MA and Guide fixtures retain production source with only relative
imports adapted; checksums and the original regression tests guard them. Old audit
probes now reference these fixtures. The accepted technical engines and identity,
Worker, viewport, socket and marker component tests remain in place.

The same frozen 90-day PR #21 input is pinned by SHA-256. See
`TRADE_GUIDE_V12_COVERAGE.md` for final counts, READY episodes, rejected examples,
measurements and limitations. A zero-READY or ≥100 weekly episodes per pair/period
result stops acceptance for review; the runner never tunes rules to a count.

## Local verification

The completed comparison has 83 READY bars / 77 distinct episodes and 188 WATCH
bars; both directions occur. Twenty historical READY samples match full and rolling
Worker contexts/score/plan exactly and pass the real TSX presentation harness;
twelve rejected records also reconstruct. See the coverage report for attribution.

```sh
pnpm web:lint
pnpm web:typecheck
pnpm web:format:check
pnpm web:test
pnpm web:build
cd apps/api
../../.venv/bin/ruff check . ../worker
../../.venv/bin/ruff format --check . ../worker
../../.venv/bin/pyright --pythonpath ../../.venv/bin/python
../../.venv/bin/pytest
```

Local results: frontend 280 tests, lint/format/types/build pass; backend 89 tests
and lint/format/types pass (one existing Starlette/AnyIO deprecation warning).
Local Docker is unavailable; the unchanged real Compose integration is executed
by GitHub Actions. The PR checks remain the authority for each pushed head.

Local standalone synthetic sample after replay: additional MA evaluation (800 bars,
100 runs) median 0.325ms / P95 0.640ms. Guide only (1,000 runs) median
0.0038–0.0091ms / P95 0.0039–0.0104ms for 320-bar READY and 800-bar WAIT cases.
These exclude the already-computed technical engines and are not production P95.
