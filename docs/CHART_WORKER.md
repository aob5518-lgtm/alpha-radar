# Chart performance architecture V1.1

Base: `1ca729cf5c8e3f91a1bcd2f217d5986287f22fe5`. This is an execution/cache
change, not a trading-model version change. Structural Levels V1.1, Trend V1.1,
Market State V1, phase vocabulary, ranking, lifecycle thresholds, eight-marker
maximum and Trade Setup formulas remain unchanged. No provider, schema, AI,
ingestion, infrastructure upgrade or new dependency is introduced.

## Browser execution boundary

`ChartWorkspace` supplies a `TechnicalWorkerClient` to `ChartContextStore`.
History merge, REST health, live visualization, URL changes and React stay on the
main thread. The injected store's `context()` never executes technical engines:
it returns canonical candles/last valid context and queues serializable input.
Canvas rendering does not require a completed snapshot. The bilingual analysis
loading message is nonblocking; unavailable analysis is not replaced with a
made-up state, level or entry. Ticker/trade/partial messages do not request work.

The module Worker receives UUID, interval, generation, revision, confirmed candles,
eligible HTF candles and confirmed close. It returns snapshot, Trade Setup, timings
and the same identity/generation/revision. The client has one active request and
one coalesced latest pending request, preventing an unbounded queue. Application
requires exact selected UUID/interval **and** latest generation. The store also
checks entry identity and history/HTF revision. If HTF currency expires during a
job, it schedules a replacement without the expired evidence. Disposal guards
old worker ports, pending microtasks, results and timers.

Worker construction, calculation, message decoding or a 30-second watchdog failure
recreates the worker once. Repeated failure preserves valid analysis/candles and
shows a retry warning. Manual retry resets that allowance. There is no interactive
synchronous calculation fallback. The original synchronous entry point remains
available for SSR/Analyst and tests; the browser workspace always injects a worker.
React Strict Mode effect replay does not dispose a reused client prematurely.

## Equivalent full replay and incremental replay

`TechnicalSeries` computes prefix-stable ATR, SMA-seeded EMA20/50/200, Wilder ADX
and confirmed pivots once per replay origin. Each prefix consumes only its own
series prefix and pivots whose three right confirmation bars already exist.
Clustering, selection scores, tie-breaking and all formulas retain the original
operation order. Final HTF confluence is still used only for the final prefix.
Malformed numeric inputs retain the original normalization/replay fallback.

`MarketStateReplayState` contains algorithm/replay version, timeframe, exact source
fingerprint, lifecycle cursor, before-final cursor and historical transition rows.
It is worker-local and is never stored in PostgreSQL or browser storage. Historical
rows/cursor are calculated **without** final-only HTF evidence. A clone of the
before-final cursor applies the authoritative final snapshot. Thus yesterday's
final HTF evidence never contaminates tomorrow's historical prefix.

A matching closed-history append advances only the newly added prefix; a changed
HTF input only replaces final evaluation. Corrections to any semantic historical
field, changed origin/version, missing state or nonmatching identity rebuild
deterministically. State/marker selection uses the unchanged 160-bar eligibility
window and priority order, and never exceeds eight markers.

### The rolling-800 boundary is not an innocuous append

Dropping the oldest candle changes EMA/ATR seeds, pivot indices, every prefix's
recency score and lifecycle warm-up. Blindly continuing the old cursor would drift
from production. After posting a result, the worker prepares **one next-origin**
799-bar checkpoint in a separate background task. A later normal 800-bar update
advances that checkpoint by one bar. If the checkpoint is unavailable or corrections
invalidate it, the request takes the equivalent optimized full-rebuild path.

This deliberately does not claim that all replay CPU disappears: the next-origin
checkpoint still costs a full replay in the worker after publication (about 49ms
on the local synthetic benchmark). It is outside the result's critical path and
never blocks browser navigation. Bursts of corrections or missed checkpoint work
can still require a full worker rebuild. Correctness takes priority over a false
incremental speed claim. Only one checkpoint per cached identity is retained.

## Cache and recovery

Main-thread history/snapshot/setup/request/analysis-health entries use exact
`UUID:interval`, at most 800 bars each, and a 16-entry LRU. Selected identity and
its current HTF entry are protected. Worker replay cache is separately bounded at
16 identities, each with current replay and at most one next-origin checkpoint.
Evicted entries rebuild; no cross-identity fallback exists. Inactive computed
contexts are reused immediately on return, with background reconciliation.

The independent primary/higher REST handling and 2/5/10/30-second history retries
from the resilience hotfix are included, not a dependency on an unmerged branch.
Primary cached bars remain usable under `degraded` health; stale HTF is omitted.
The total transport deadline is 25 seconds including body reads. History retry
does not rebuild canvas/sockets. Confirmed streams keep advancing history and
request worker analysis during REST failure. Partial streams remain visual-only.

Adjacent-timeframe prefetch is intentionally not enabled (optional in the request):
the selected chart takes priority; no seven-timeframe/provider fan-out is added.

## Diagnostics and reproducible measurements

Development logs include existing history/structural/trend/state/replay times plus
`worker_queue_ms`, `worker_compute_ms`, `incremental_update_ms`,
`timeframe_switch_to_candles_ms` and `timeframe_switch_to_analysis_ms`. Queue time
includes message delivery/clone overhead. A supported Long Task observer reports
page-wide tasks over 50ms with an explicit non-attribution warning: unrelated
layout/rendering is not automatically a technical-engine regression. No dashboard.

Run from the repository root with Node 22+:

```sh
node --experimental-strip-types scripts/benchmark-chart-worker.mjs
```

Local Node 24 measurements, synthetic 800 confirmed candles, same frozen production
oracle, medians of five full/eight incremental samples, exact snapshot equality:

| Measurement | Before | After |
| --- | ---: | ---: |
| Full context | 483.74ms | 58.24ms |
| Full marker replay | included in full replay above | 56.45ms |
| Normal append using next-origin checkpoint | full replay | 2.72ms |
| Background next-origin checkpoint | none | 48.99ms |
| Worker cold compute / startup-inclusive roundtrip | main-thread execution | 72.01ms / 100.37ms |
| Main-thread full compute block / heartbeat gap during real separate-thread compute | 483.74ms compute block | 5.69ms max heartbeat gap |

Heartbeat latency is a responsiveness diagnostic, not identical to CPU time or a
browser Long Task measurement. Timed stage sample: structural 37.90ms, trend 8.77ms,
state 6.81ms, replay 56.45ms, total 58.23ms; nested stages must not be summed.

Local production-build Chromium smoke against an explicitly synthetic localhost
API (not live market data): cold 4h candles/analysis 313/336ms; warm cached switches
32–43ms; history-only cached 1h candles 33ms and analysis 108ms. Actual bundled Web
Worker full compute samples 57–64ms, no page errors or >50ms Long Tasks observed in
that run. With worker result delivery held for two seconds, Events/Analyst navigation
completed in 56/48ms including automation overhead. These are individual samples,
not production p95 or guarantees on other hardware.

Production has not been deployed or retested by this PR. The supplied historical
production timings (919ms history, about 4.8s replay) are motivation, **not** a
comparable before/after test on this host. After review, a production smoke should
collect canonical history HTTP latency, web response latency and browser worker
timings together. PostgreSQL query-only timing is unavailable in existing Chart
instrumentation; do not infer it from HTTP latency or upgrade hardware without data.

## Verification boundary

Test-only frozen engines under `tests/fixtures/production-v1` retain the reviewed
production oracle, independent of optimized engines (only timing/interval helpers
are shared). Deep-equality tests cover full snapshots and Trade Setup, BTC/ETH
15m/1h, directional/range/sharp histories, support/resistance confirmations, missing
volume, changing HTF, seed boundaries, corrections, partial exclusion, many sequential
appends and rolling origins. Worker/store/component tests cover generation and
identity races, errors/recreation, candles-before-analysis, pending-worker navigation,
restored contexts, LRU bounds and REST/stream ordering. Existing algorithm, Events,
AI and integration checks remain required. One pre-existing GitHub transport test
now pins its fixture observation clock; no production source behavior changes.
