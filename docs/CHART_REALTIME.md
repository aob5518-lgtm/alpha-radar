# Chart confirmed context and Trade Setup V1

Base: `b55e9189cca559b5a565d4f34727b8f8ac8e7739`. No backend schema, provider,
threshold, phase, Structural Level ranking, or Analyst contract changes.

## Ownership and updates

`ChartWorkspace` owns the selected timeframe and `ChartContextStore`. The initial
history, higher history and technical snapshot are server rendered. Subsequent
timeframe changes use native URL history, preserving canonical instrument UUID and
interval, reload/deep links, modified-click links, and browser back/forward. Asset
navigation remains server-backed; its instrument-keyed workspace starts a separate
cache. Only Events, Chart and Analyst remain in primary navigation.

The workspace's memory cache key is exactly `instrumentId:interval`. Each entry keeps
at most the existing 800 confirmed candles and a revision-bound technical snapshot.
A higher-history entry is not treated as a computed lower-timeframe cache hit.
Current, fully computed entries render immediately without history fetch or replay.
Confirmed cached entries also remain usable when reconciliation is overdue; see
the degraded-mode rules below. First/expired visits fetch canonical history and the required higher history; expired
entries request a delta starting at the last cached open time rather than refetching
an already-current 800-candle page. Concurrent fetches deduplicate. A stale response
cannot overwrite a newer streamed close/correction received during that request.
Incremental reads include both `start` and the required explicit UTC `end`; browser
smoke caught the missing-bound 422, and the corrected transport returned HTTP 200.

The same-origin Next.js history transport forwards only the existing history path
and its interval/limit/start/end parameters to runtime `API_URL`. It never forwards
browser cookies/authorization or accepts an arbitrary upstream host. This avoids
cross-port CORS requirements without changing FastAPI contracts or requesting data
from providers. Pan-left pagination uses the same transport. Bounded cache trimming
advances its cursor so a remounted chart can retrieve the trimmed bars without a gap.

A confirmed current-period Kline is projected into a client-only observation with
the socket's canonical UUID and validated provider contract/interval. Provider open,
close and observation timestamps are retained; `ingested_at` is explicitly empty
and `client_stream_observation` marks that this is NOT an assertion of database
persistence. Only the backend worker writes persisted history. Confirmed bars merge
by exact timestamp, replace corrections, sort chronologically and cap to 800.
Duplicate identical closed OHLCV updates do not recompute.

One bounded pure `calculateTechnicalContext` call updates Structural Levels, Trend,
Market State, markers and derived Trade Setup. The canvas, socket and logical viewport
survive that snapshot update: only the structural price lines/marker overlay change,
and the sidebar reads the same new snapshot. An older corrected close can update its
historical bar without overwriting the current visual partial price.

A second, confirmed-only higher-period stream maintains the existing hierarchy.
Partial higher candles are ignored. A missed higher boundary is reconciled through
the DB-only incremental API when a current close reveals it is overdue; reconnect,
online and visibility resume also reconcile missed history. These are not provider
requests on each ticker/trade. Transport failures/temporary stream lease limits use
a disposed-safe, bounded 1–10 second reconnect; provider-policy rejection does not
retry. Existing Redis stream caps are unchanged (two streams per active chart), so
multiple tabs can reach the configured cap. The primary stream must receive data
before the auxiliary higher stream starts; loss of the primary stream releases the
auxiliary subscription so it cannot starve primary reconnection under that cap.

Level-table timestamps are explicitly formatted in UTC, avoiding server/browser
timezone hydration mismatch after moving the sidebar into the client workspace.

Ticker, public trade and partial Kline update only visual price/candle/status. They
never mutate cached confirmed history or trigger technical replay. The existing
800-candle lifecycle warm-up is preserved exactly: marker eligibility/selection is
still the last 160 candles and at most 8 markers. No detector/stability thresholds,
phase enum, ranking or replay outputs are retuned.

## TradeSetupCandidateV1 (`trade-setup-v1`)

The shared presentation contract contains canonical UUID/timeframe, direction
`long/short/wait`, status `candidate/waiting`, nullable reference/entry zone/reference
price, structured reason and the selected period's last confirmed timestamp. It is
not an order, sizing rule, target, return forecast or guaranteed entry.

- Long requires bullish Trend and Market State direction, `support_confirmed`, and
  a currently authoritative support zone overlapping the confirmed reference.
- Short mirrors that rule with bearish direction and `resistance_confirmed`.
- Pullback/rebound without confirmation, reversal attempts, reversal confirmation
  alone, neutral/unavailable Trend and mere S1/R1 proximity remain `wait`.
- Candidate requires the existing `entry_window_candidate` plus matching direction
  and the confirmed close within the existing `entryMaximumExtensionAtr` distance
  from support's high edge / resistance's low edge. Extension returns to waiting;
  the fixed reference price does not chase price.
- A disappeared/non-overlapping current zone or confirmed break beyond the existing
  `levelFailureBufferAtr` removes the setup, zone and price. Mutable S1/R1 rank alone
  never identifies a physical zone. ATR uses the existing 14-period implementation.
- Waiting/neutral contexts may expose a meaningful current reference as **Watch
  zone / 关注区域** only, with no entry price. Range-middle context has no invented zone.

For authoritative bounds `low/high`, `mid = (low + high) / 2`:

```text
Long preferred reference  = (mid + high) / 2 = low + 0.75 × (high - low)
Short preferred reference = (mid + low)  / 2 = low + 0.25 × (high - low)
```

These are deterministic reference prices inside the zone, not exchange-tick-rounded
execution prices. They are never dynamically optimized/back-fit. Extension/failure
use the latest **confirmed close**, not live price; thus direction, status, zone and
reference price remain frozen through partial updates. English/Chinese copy labels
directional bias, candidate/watch zone, reference entry price and waiting/candidate
window, with an explicit non-execution disclosure.

Identity change clears prior view/detail/pin/live status before a new chart appears.
Chart and Trade Setup render guards independently require exact UUID and timeframe;
disposed sockets, async fetches and reconnect callbacks cannot overwrite another
identity. The client canvas keeps the PR #15 identity key/guard discipline.

## Diagnostics and measurements

Development JSON logs record `history_fetch_ms`, `structural_levels_ms`,
`trend_regime_ms`, `market_state_ms`, `marker_replay_ms` and
`total_technical_context_ms`. The first two engine timings aggregate their work
across the bounded replay. `marker_replay_ms` includes constituent engine work;
do not sum all stages. Server history timing covers the slower of the concurrent
current/higher history reads, excluding quote/instrument reads. A separate development `chart_timeframe_switch` log records computed-cache
hit and commit readiness. No per-ticker/trade logging or user monitoring dashboard.

Read-only measurements on 2026-10-12 (Node 24, this development host, five timed
engine runs; baseline archived from the base SHA):

| Input/path | Before | After | Qualification |
| --- | ---: | ---: | --- |
| 800 deterministic fixture candles, full context | 442.76 ms | 449.55 ms | Median, diagnostics enabled after; exact output equality |
| 800 canonical production candles, full context | 722.08 ms | 739.56 ms | Median, exact output equality, not an algorithm speed claim |
| Current computed-context cache switch | Full recomputation above | 0.007 ms | Local median lookup/readiness, zero new history requests, not browser paint |
| Hydrated browser cached 1h → 15m | — | 11.1–11.5 ms | Development browser commit samples, not a production percentile |
| Browser first 1h computed-context visit | — | 3.98 s | Required higher-history fetch plus one bounded replay; not a cache hit |
| Existing production main 15m page request | 7.39 s | — | Single full HTTP roundtrip sample; different path/environment than cache lookup |

The improvement is avoiding network/full replay on a current cached switch, not
retuning the engines. A first/dirty timeframe still pays bounded calculation cost
and API latency. Memory cache is not persisted across reloads. No walk-forward or
profitability validation is claimed. `scripts/benchmark-chart.mjs` reproduces CPU/
cache measurements with fixtures by default; optional `CHART_API_URL` reads canonical
history only and `CHART_BASELINE_ROOT` compares an archived source tree exactly.

Browser smoke observed a real Bybit 1m close advance confirmation from 11:41 to
11:42 UTC without reload (Trend strength 46 → 47), then tested cached switching,
browser back/forward, English/Chinese copy and closed-history recovery through 12:30
UTC after stream lease-limit retries. Primary-first subscription restored Live/Partial
without changing the existing caps.
Unit/component regression covers current/higher closed updates, duplicates, cache
and fetch races, identity reset/guards, partial safety, setup rules and formulas.
Compose integration additionally exercises the same-origin transport against seeded
real PostgreSQL history while retaining existing checks.

## History refresh resilience

Primary and higher REST reads start independently (primary first). A primary result
is published without waiting for higher reconciliation. A failed/slow higher request
cannot reject usable primary context. A confirmed primary cache is usable only for
its exact UUID/interval after the existing history validation/closed-candle merge;
being overdue alone does not make it unsafe. No arbitrary new expiry/model threshold
is introduced. With no confirmed primary bars, initial fetch failure remains a hard
error. With cached bars, the chart stays rendered and reconciles in the background.

Refresh health is `healthy` when primary and required higher histories satisfy the
existing closed-boundary currency check, `degraded` when primary is usable but a
source is overdue/missing, and `failed` when no usable primary history exists.
Degraded UI is a small nonblocking bilingual warning, not a loading/error overlay:
“历史同步暂时延迟，当前图表继续使用最近确认数据。” The manual retry remains available.

Higher history contributes evidence **only** while the original `isCurrent` rule
holds. Expired higher evidence invalidates the cached calculation revision and is
omitted from the next context calculation, including an immediately rendered cached
switch. Missing higher evidence uses the engines' existing missing-input behavior;
no higher prices, direction, confluence or replacement weight rules are invented.

The selected-identity `ChartHistoryReconciler` retries REST only, after completed
unsuccessful reconciliation, at 2/5/10/30 seconds (then 30 seconds indefinitely).
Success resets backoff; manual retry resets it and starts immediately unless an
existing request is already in flight. Online/visibility/stream resume can reconcile
early. Pending requests remain deduplicated. Cleanup cancels retry timers and guards
late publications; it does not recreate a chart or websocket. Existing stream retry
and identity guards remain separate and unchanged.

The same-origin history transport has a bounded **25-second total deadline** covering
both headers and body. Timeout returns HTTP 503 `history_timeout`; network failure
returns HTTP 503 `history_unavailable`. Existing upstream validation/status responses
are preserved. Only fixed canonical path/query fields go upstream; the client `role`
diagnostic hint is not forwarded. No credentials or upstream error bodies are logged.

Ticker/trade/partial candles remain visual-only throughout a REST outage. Valid
confirmed closes merge and recompute context immediately from available confirmed
bars; higher failure cannot freeze that path. A newer stream correction still wins
over a slower REST response. Healthy/degraded transitions never force socket/chart
recreation or reset visual price. Unusable initial history still cannot start a
chart from invented bars. Memory cache remains local to the instrument-keyed workspace.

Production JSON diagnostics are `chart_history_refresh_failed`,
`chart_history_refresh_recovered`, and `chart_context_degraded`. Each includes
`market_instrument_id`, `timeframe`, `role` (`primary`/`higher`), `incremental`,
`elapsed_ms`, and `error_type`. Failures/recoveries are source-scoped; degraded logs
are transition-scoped, not emitted per tick/render. A valid streamed close can record
`ConfirmedStreamRecovery`. Error messages, private URLs, response bodies and secrets
are excluded. These logs add no dashboard or algorithm/performance refactor.
