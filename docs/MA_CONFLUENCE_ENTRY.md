# MA Confluence Entry

## V1.1 — bounded retest episode and entry-based room

Version `ma-confluence-entry-v1.1`; base main
`4ec1617e17a560e244b7c89616f3519e472b173e`. Only the following two
conceptual gates change. All `MA_RULES` numeric values/weights equal the frozen V1
oracle; original Levels/Trend/Market State/Trade Setup and Trade Guide remain unchanged.

### Retest lifecycle

`calculateMaEntry` takes optional explicit prior analysis. The existing lightweight
MA layer commits this cursor only after an accepted immutable Worker context renders.
It is not in localStorage, the backend, the Worker protocol or a position ledger.

- A current **closed** touch after the unchanged qualifying impulse starts an
  episode. Touch bar age is zero; at most **three additional closed bars** may
  confirm. Consecutive touching bars never renew its start time. A fully departed
  range followed by a new touch starts a separate episode under the unchanged
  maximum-touch/episode/chop filters.
- A trigger consumes the episode; another continuation candle does not repeatedly
  trigger the same interaction. Current-trigger diagnostics show its eligible age;
  the committed cursor is already consumed for the following candle.
- Closed MA invalidation, direction flip, materially opposite Market State direction,
  existing chop/excess-touch rejection or existing >1 ATR extension cancels it.
  No new directional/chop/chase threshold is introduced. Failure is checked before
  admitting the current candle's retest extreme. Expired/cancelled history cannot
  resurrect without a newly observed touch.
- Diagnostic fields are `retest_started_at`, `retest_age_bars`, `retest_extreme`,
  `retest_active`; stop still uses the existing current zone/prior retest extrema
  and **one** 0.25 ATR buffer. Current failure/confirmation candle extremes remain
  excluded from their own failure reference. No R:R-driven stop adjustment.

The pure cursor keeps before/after-current checkpoints. Same-timestamp higher-context
replacements re-evaluate from before-current (never age twice); source corrections,
missing steps, UUID/timeframe/settings changes reset eligibility. Its source signature
is bounded to the existing 800 bars. Full chronological folding and incremental
accepted-Worker folding deep-equal; neither calls the technical engines from MA.
Partial/ticker/trade updates are not dependencies and cannot start, age or consume it.

**Cold/session boundary:** without an accepted prior cursor, a currently observed
closed touch may start an episode; an old absent touch is not searched six bars back
and invented as an active episode. Reloads/settings changes or identity remounts can
therefore suppress delayed confirmations that a continuously mounted session would
observe. This is explicit, conservative session state, not retrospective signal
storage. Historical comparison burns in 27 pre-scoring accepted contexts and models
a continuously mounted SMA99 session, not unarchived historical browser delivery.

### Structural room / observed targets

Room anchor is the existing authoritative trigger reference:
long `max(MA-zone high, previous high)`, short its existing mirror. The confirmed
close is **not** substituted as anchor. `roomAtr` stays **0.9**.

Select the nearest confirmed opposing zone edge or swing pivot **strictly beyond
entry**, not merely beyond MA. Points/zone edges inside the planned MA/trigger
interaction range are classified in `diagnostics.entry_obstacles` as local/entry
confluence, not TP1. A genuinely forward obstacle is never skipped just because it
fails 0.9 ATR; no meaningful forward target still rejects the setup. An overlapping
zone straddling entry is not converted to a fabricated target at its farther edge.
Diagnostics expose `room_anchor` and `structural_room_atr`.

Trade Guide consumes the same reference/stop/target contracts normally; its existing
nearest-real-target logic already excludes behind-entry points. No aggregation
change or version increment is required (`trade-guide-v1`). Reached TP1, poor R:R,
invalid risk, direction conflicts and no-chase rules still reject promotion.

The exact frozen-input comparison, ablations and compact READY examples are in
`MA_ENTRY_V11_COVERAGE.md`. No PnL, profitability or win-rate claim is made.

## Historical V1 specification (frozen oracle)

Version: `ma-confluence-entry-v1`. This is a deterministic, unvalidated research
setup assistant, not a calibrated win probability, backtested strategy, execution
system, price forecast or guaranteed opportunity. The Chinese “可开多／可开空”
labels appear only with “收盘确认”, a candidate/reference label and disclaimer.
All source prices are canonical confirmed candles; no provider or AI is added.

## Scope and execution

Integrated performance base main is `8b5eb27a0417ab5867a78283179ec006e5a2bbbe`
(squashed PR #18). The four existing engines execute in the identity/revision-guarded
technical Web Worker; their returned snapshots and rules remain unchanged. A pure
`calculateMaEntry` consumes the accepted immutable context in a lightweight memoized
main-thread presentation layer. Its sub-millisecond synthetic cost does not justify
a second async pipeline or copying the context back into the Worker on setting changes.
See `CHART_WORKER.md` for the heavy execution boundary and equivalence tests.

While the first Worker result is pending, candles, overlay controls and navigation
render without MA/setup claims. An empty retained MA series receives the first
accepted result without rebuilding the chart/socket. New confirmed results recalculate
MA once; visibility, price/trade/partial state do not. Worker failure keeps the existing
nonblocking analysis warning/retry behavior, not synchronous technical replay.

The extra calculation is bounded to 800 confirmed bars: rolling-sum SMA, existing
SMA-seeded EMA recurrence, Wilder ATR14, one MACD pass and the existing bounded
confirmed-pivot detector. No prefix replay is introduced. Only confirmed-context,
identity or MA-setting changes recalculate it; price/trade/partial updates remain
inside the existing canvas. Visibility changes do not calculate any engine.

## Indicators and controls

- Exactly one MA line: default **SMA99**. Secondary settings allow integer periods
  **10–250** and SMA/EMA. Changes commit on blur/Enter, not every keystroke.
- MACD is an internal filter only, **12/26/9**. DIF = seeded EMA12 − seeded EMA26;
  DEA is EMA9 of valid DIF observations; histogram = DIF − DEA (not doubled).
  Missing seeds are null, never zero evidence. No existing MACD panel is present
  on this base, so this feature does not invent one or add a new panel.
- MA values/line are confirmed-only. Insufficient history leaves unavailable
  values as `—`; available MA history can display even while trend is unavailable.
- Independent levels/Market State markers/MA/entry overlays default on. A versioned
  validated localStorage record persists preferences/settings per browser. Denied
  storage still permits working controls. No signals or financial data are persisted.
- Hiding levels/markers never deletes cached technical context. Only drawing changes;
  chart, viewport and sockets are retained. Hiding MA does not hide entry overlays,
  and hiding entries does not hide Market State markers. The summary remains visible.

## Exact V1 rules

Constants and weights are centralized in `MA_RULES`; they are conservative V1
design choices, not parameters fitted to screenshots or measured returns.
The short side mirrors the long side throughout.

1. **Direction**: existing bullish/bearish Trend sets long/short bias. A neutral
   Trend needs strength ≥50 plus matching +1/−1 market structure. Unavailable
   Trend or neutral without that evidence stays `no_setup`.
2. **Slope**: `(MA[t] − MA[t−10]) / ATR14[t]`. Rising ≥0.15; falling ≤−0.15;
   otherwise flat. Long requires rising and short falling. Flat/opposite slope blocks
   promotion; the current directional bias can remain observation-only.
3. **Zone**: `MA ± 0.20 × ATR14`. It is an interaction range, not an exact tick.
4. **Chop**: over the last 12 closed bars, ≥3 closes on each side of their own MA,
   **or** ≥3 side switches, blocks promotion. Equal closes do not count as switches.
5. **Retests**: bar range intersecting its contemporary MA zone counts as a touch.
   More than four touch bars or more than two separate touch episodes in 12 bars
   blocks promotion. Consecutive touching bars share one episode.
6. **Impulse**: within the previous 24 bars, before the final three-bar retest window,
   find direction-aligned close/MA separation ≥1 contemporaneous ATR. At least one
   zone interaction must occur after that impulse within the last three closed bars.
7. **No chase**: current directional close/MA separation >1 ATR blocks promotion.
8. **Space/target**: select the nearest opposing structural-zone edge or confirmed
   swing pivot ahead of the MA (existing pivot policy, three right closed bars).
   Long uses resistance low/high pivot; short uses support high/low pivot. Available
   room from the more conservative of confirmed close, trigger and entry-zone edge
   must be ≥0.9 ATR. Missing targets or already-crossed/too-close targets block
   promotion. No projected target, fixed return or minimum-profit promise is invented.
9. **MACD**: directional histogram ≥−0.10 ATR and directional histogram change
   ≥−0.02 ATR. Thus slight disagreement is tolerated, but materially opposing or
   weakening momentum blocks promotion. MACD alone never creates a setup.
10. **Volume**: at least 10 positive observations in the preceding 20 bars; current
    positive volume ≥0.8 × the maximum of their mean, previous-three-bar mean and
    any opposing pullback bar exceeding 1.8 × that 20-bar mean. Missing/zero/weak
    confirmation volume blocks promotion; absence is not fabricated as confirmation.
11. **Price confirmation**: long candle bullish, closes at/above the larger of MA-zone
    high and previous high, and in the top 35% of its range. Short is bearish, closes
    at/below the smaller of MA-zone low and previous low, and in the bottom 35%.
    A weak close may remain a candidate, never “可开多／空”.

Optional confluence is overlap with S1/S2 or R1/R2, **or** matching existing
support/resistance-confirmed Market State. It is not required. We do not hard-require
all structural factors or create a second Trend/Market State classifier.

## States, score and price references

States are `disabled`, `no_setup`, `observe_long/short`, `candidate_long/short`,
`trigger_long/short`, `invalidated`. Direction is long/short/none, separately from
state. The version/UUID/timeframe, confirmation time, MA/slope/zone, reasons,
explanation lines and numerical diagnostics are preserved in the typed output.

Rule-match weights: trend 20, slope 15, impulse 15, retest 10, price confirmation 15,
MACD 10, volume 10, structural confluence 5. **This heuristic score is not win rate**.
A/B/C tiers use ≥80 / ≥65 / lower. An adverse gate caps the score at 64 and leaves
only observation (or invalidation); references are null. At ≥65 with all filters
passing, expose a candidate zone. Trigger requires ≥80, actual closed confirmation,
and a fresh interaction: prior close not already beyond its MA-zone edge, or the
current bar is itself a new zone test. Below threshold remains observation.

- Entry zone is the current MA zone, not a claim of executable liquidity.
- Trigger reference: long `max(zone high, previous high)`; short
  `min(zone low, previous low)`.
- Invalidation: long `min(zone low, prior retest lows) −0.25 ATR`; short
  `max(zone high, prior retest highs) +0.25 ATR`. Prior retests exclude the current
  confirmation/failure candle, so it cannot move its own failure reference outward.
  A closed breach with a recent interaction returns `invalidated` and clears active
  zone/trigger/target references. Wick-only pierces do not constitute closed failure.
- First target is the observed opposing structure from rule 8, never an invented
  risk/reward multiple. It is a reference, not a return prediction.

This output describes the **current closed-bar setup**, not a persisted trade or
position-management lifecycle. Re-evaluate after each confirmed context; references
can update with authoritative MA/ATR/structure. Only the latest confirmed trigger
marker is displayed, with optional zone edges; this is not a historical signal
performance overlay. It does not generate orders, sizing or leverage.

## Identity, safety and validation

The existing workspace/context/REST/stream guards are retained. The MA line, entry
marker and entry-zone drawing additionally reject mismatched UUID/timeframe. New
calculation has no async callbacks that could race a new identity. Changing timeframe
keys the layer; settings/preferences restore locally but old setup data does not.
Partial/ticker/trade updates cannot promote a signal or repaint confirmed references.

Tests cover mirrored long/short positives, chop, excessive touches, no impulse,
structural obstruction, MACD conflict, weak/zero/missing volume, failed retests,
no target, insufficient history, chase rejection, partial exclusion, exact identity,
MA seeds/settings, storage validation/denial and actual component overlay behavior.
Visibility tests count calculations and verify retained canvas/socket objects.
Existing technical-engine/identity/REST/stream suites remain unchanged in behavior.

Run `node --experimental-strip-types scripts/benchmark-ma-entry.mjs` for an offline,
synthetic 800-bar benchmark. It measures the **additional MA engine only**, not the
Worker's improvements or production p95. No profitability, calibration
or live-signal effectiveness claim is made. Those require versioned historical /
walk-forward validation with fees and slippage in a future separately approved task.

Local Node 24 sample (100 synthetic 800-bar runs): median 0.325ms, P95 0.623ms,
max 0.972ms. Local production-build Chromium toggles completed in 26–48ms including
automation overhead; persistence, EMA50 setting changes, timeframe switches and a
390px viewport without horizontal overflow passed with no page errors. These are
individual synthetic development measurements, not production guarantees.

The only backend-file change pins the observation clock in an existing fixed-date
GitHub transport fixture test, whose 14-day window otherwise expires over time.
No ingestion or backend production code changes are included.
