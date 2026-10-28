# Trade Guide V1

Frozen V1 specification. The proposed Guide V1.1 / Entry V1.2 contract is documented
in [TRADE_GUIDE_V12.md](TRADE_GUIDE_V12.md), with the original V1 preserved for audit.

Version `trade-guide-v1`, base main `f6fef543952763eee5d450db963b3279117e352c`.
This is an unvalidated deterministic aggregation/presentation layer, not an order,
execution service, price forecast, calibrated win probability or profit guarantee.
No original Structural Levels V1.1, Trend V1.1, Market State V1, Trade Setup V1 or
MA Confluence Entry V1 algorithm/threshold/output is changed.

## Confirmed input and execution

`MaChartLayer` memoizes aggregation immediately after MA calculation on the accepted
immutable technical Worker snapshot. The existing Worker/store identity, generation,
revision and stale-REST guards remain the authority. There is no second worker pipeline,
provider call, historical replay or technical-engine invocation. ATR is recovered from
the authoritative MA zone width (`width / (2 * MA_RULES.zoneAtr)`); no indicator is added
or recalculated. Targets consume existing structural levels and MA's already-selected
observed target, including its confirmed-pivot provenance.

Only a new accepted confirmed context, exact identity, Trade Setup or MA setting changes
aggregation. Ticker/trade/partial state stays inside the existing canvas. Overlay
visibility is not a calculation dependency. Settings remain SMA99 by default, SMA/EMA
10–250; the four visibility keys and localStorage format are preserved.

## Decision precedence

The typed output has exactly one primary state: `LONG_READY`, `SHORT_READY`,
`WATCH_LONG`, `WATCH_SHORT`, `WAIT`, `MISSED`.

1. Missing/disabled MA, nonmatching UUID/timeframe, differing confirmed timestamps,
   invalidation, directional conflict or noisy evidence fail closed to WAIT. Both Trend
   and Market State must match the MA direction (neutral is not READY). A conflicting
   candidate Trade Setup is also rejected. Flat/repeated-cross/excess-retest or
   MACD-conflict/unseeded evidence stays WAIT, not a second trading recommendation.
2. Known missing targets / insufficient room stay WAIT. No target or reference is
   invented to promote a setup. Invalid MA risk is rejected **before** considering
   structural stop boundaries; a farther stop cannot rescue an invalid input.
3. LONG_READY requires MA `trigger_long`, all coherent current references, a positive
   risk, a real TP1, R:R >=1.5 and no material extension. SHORT_READY mirrors it.
4. A coherent observe/candidate setup stays WATCH while confirmation/participation is
   incomplete. An observation may expose only the existing MA potential zone; absent
   trigger/stop/risk stays null and never becomes a complete plan. A valid trigger
   with R:R from 1.2 to below 1.5 is capped at WATCH.
5. R:R below 1.2, nonfinite/nonpositive risk, reached TP1 or invalidation stays WAIT
   with cleared plan references. No risk-fitting, fallback target or optimistic fill.

The reference entry is the MA trigger reference, which can differ from the MA zone
edge; it is **not** the current visual quote or a promised executable fill.

## Stop and observed targets

MA invalidation already includes the prior controlled retest extremum and 0.25 ATR
buffer. Keep that value if it covers the overlapping same-period support/resistance
boundary. If a relevant overlapping structural boundary lies farther out, use that
boundary with the existing MA invalidation buffer once, before R:R evaluation.
Long uses the lower boundary; short the higher. Never widen/tighten a stop in response
to a failed R:R test. A close through the selected stop invalidates the plan.

Select the nearest positive opposing level edge strictly beyond reference entry:
resistance low for long, support high for short; include the MA's already-confirmed
observed target. Prefer the canonical R/S label when the MA target equals that edge,
otherwise preserve `swing-high` / `swing-low`. Deduplicate identical prices. TP2 is
the next available meaningful **structural** barrier, not an invented R multiple.
No new second-pivot detector is run. TP2 remains null if none is available. A target
already reached by the confirmed close cannot yield READY.

Long risk/reward are entry-minus-stop and TP1-minus-entry; short mirrors them.
R:R >=2 is labeled favorable reward/risk only, never increased certainty. Values are
price-based, before fees/slippage, not historical profitability evidence.

## Bounded MISSED evidence

Extension is measured from the relevant entry-zone edge using the existing
`MA_RULES.maximumExtensionAtr * ATR` distance; no unrelated chase threshold is added.
A current otherwise READY plan outside that bound becomes MISSED, not READY.

MA can deliberately clear references after extension. To avoid inventing a replacement
entry engine, aggregation accepts an **explicit optional prior READY output** from the
same committed chart session. It must match exact UUID, timeframe and MA settings;
its origin must still exist within the existing three-bar retest horizon, bounded
by both closed-bar count and interval duration. No intervening confirmed close may
have crossed its stop or reached TP1; current conflict/noise/invalidation still wins.
The prior authoritative zone/stop/targets are immutable; they are not retrofitted.
The original setup candle remains the evidence origin while confirmed_at identifies
the new observation. MISSED has no primary entry plan or ready marker.

The pure function is deterministic for its explicit inputs, including prior evidence.
The layer records only committed READY results in memory, never wall-clock/localStorage
trade state. Identity/timeframe changes remount it; WAIT/pending context clears it.
Reloads/first visits do not fabricate a previously valid plan: without such evidence,
an MA output with cleared overextended references stays WAIT. This is not persisted
position management or a historical signal/backtest engine.

## UI and marker

One primary badge and deterministic localized next action follows instrument/price.
WATCH shows a potential zone and waiting condition, not stop/TP as a confirmed plan.
READY shows entry, reference, stop, TP1/TP2 (missing TP2 as unavailable) and R:R.
MISSED explicitly says not to chase the corresponding side. MA score/reasons,
Market State, Trend and legacy Setup are compact secondary input details, not
competing primary recommendations.

The existing entry overlay key now controls one primary Guide arrow, `多/空`.
It replaces the redundant MA trigger label in this product path. Click/tap/hover
opens the same authoritative plan with key reasons. Market State markers remain
behind their independent toggle and keep their unchanged maximum of eight;
the single Guide marker is a separate presentation signal. Both tooltip state and
rendering guard exact identity and current confirmation. Toggle changes retain
canvas, viewport, socket and calculations.

## Verification

`pnpm web:test` covers mirrored READY/WATCH/MISSED, exact R:R boundaries, meaningful
stop/no double buffer, nearest observed targets/provenance, no TP2, invalidation,
missing targets, conflicting/neutral/noisy input, bounded prior evidence, partial
exclusion, identity/confirmation mismatch, Worker late-result/generation rejection,
real TSX controls/markers/tooltips and bilingual primary/secondary presentation.
Existing frozen-production engine-equivalence tests remain unchanged.

`node --experimental-strip-types scripts/benchmark-trade-guide.mjs` measures the
additional pure aggregation only, on explicitly synthetic precomputed contexts.
No production latency or win-rate claim is implied. Full frontend/backend/Compose
CI and production build remain required; this PR is not deployed before review.

Local Node sample (1,000 runs each): 320-bar LONG_READY/SHORT_READY aggregation
median 0.0028–0.0029ms, P95 0.0029–0.0032ms; 800-bar WAIT path median 0.0047ms,
P95 0.0050ms. These exclude the already-computed MA/technical engines and are not
production P95 measurements.
