# Structural Level Engine V1.1

Version: `structural-levels-v1.1`

Trend version: `trend-regime-v1.1`

Market-state version: `market-state-v1`

## Input and no-look-ahead rules

The engine accepts normalized OHLCV candles but immediately excludes every candle where
`is_closed != true`. Candles are ordered by `open_time`. A pivot with left width `L` and right width
`R` is not confirmed until all `R` later closed candles exist. The default is `L=3`, `R=3`.
Consequently:

- the current open candle cannot create, strengthen or move a confirmed level;
- historical replay at time `t` receives only candles closed by `t`;
- future candles cannot alter a pivot that was already confirmed;
- repeating a calculation with identical inputs produces identical output.

## Pivot detection

A swing high is at least as high as all candles in its confirmation window and strictly higher than
at least one neighbor. Swing lows use the inverse rule. Equal-price plateaus resolve deterministically
to the final candle in the contiguous plateau. Pivot quality is the pivot's excursion beyond the
strongest neighboring extreme, normalized by local 14-period ATR and capped to `[0,1]`. Rejection
strength measures the relevant wick relative to ATR. Volume confirmation compares pivot volume with
its trailing 20-candle mean. Absent volume is marked unavailable and omitted from the weighted
denominator rather than treated as zero evidence.

## ATR clustering

Pivots are sorted by price. A candidate joins an existing zone when its distance from the zone's
quality-weighted center is no greater than `0.6 × max(candidate ATR, zone mean ATR)`. Otherwise it
starts a new zone. The zone exposes its minimum/maximum pivot price and quality-weighted
representative price.

## Strength score

The transparent 0–100 score is:

```text
25% confirmed pivot count (capped at four)
20% mean rejection strength
15% mean volume confirmation
15% recency
15% mean pivot quality
10% higher-timeframe confluence
```

Bands are weak `<45`, moderate `45–69`, and strong `>=70`. Volume and higher-timeframe components are
included only when those inputs are available; weights are renormalized across available evidence.
An available higher timeframe with no confluence is zero confluence, while an unavailable higher
timeframe is not evidence. These are deterministic versioned weights, not learned weights or AI.

## Support/resistance and Top 3 selection

With current price `P`, zones above `P` are resistance candidates and zones below `P` are support
candidates. Selection ranks structural strength and useful proximity. Clustering happens before the
best three candidates are displayed as R1→R3 and S1→S3. Each level exposes zone range,
representative price, score/band, confirmed pivot count, last test, percentage distance, timeframe
and higher-timeframe availability/confluence. `pivot_count` is not a retest count; true
post-formation retest semantics are deferred.

## Trend Regime V1.1

Trend requires at least 250 closed candles: 200 observations seed EMA 200 with an SMA, followed by at
least 50 warm-up observations. EMA 20 and EMA 50 use the same SMA-seeded recurrence. It combines:

- confirmed higher-high/higher-low versus lower-high/lower-low structure (25%);
- EMA 20/50/200 ordering (25%);
- five-candle EMA slopes (15%);
- price location relative to all three EMAs (15%);
- standard 14-period Wilder-smoothed ADX directional strength (10%);
- optional higher-timeframe alignment (10%).

Directional score `>=0.20` is BULLISH, `<=-0.20` is BEARISH, otherwise NEUTRAL. Strength is a bounded
0–100 combination of absolute directional agreement and ADX. Higher-timeframe alignment is omitted
and the score renormalized when that trend cannot be calculated. It describes regime, not the next
candle and not guaranteed future performance.

## Timeframes and provider behavior

Every timeframe recalculates candles, zones and trend independently. Live hierarchy is
`1m→5m→15m→1h→4h→1d→1w`; weekly has no higher timeframe. The higher-period snapshot supplies real
level confluence and trend direction only when its persisted history is available. Bybit natively
supplies every supported timeframe for the primary USDT perpetual Chart, so those bars are not
aggregated. The retained Coinbase spot adapter natively
supplies 1m/5m/15m/1h/1d granularities. The adapter aggregates complete 1h groups into UTC-aligned
4h bars and complete 1d groups into Monday 00:00 UTC-aligned 1w bars. Aggregation requires every
expected source timestamp; incomplete or gapped groups are discarded.

The Coinbase provider pages backward in chunks of at most 300 source candles, is paced below its public
limit, deduplicates overlaps, and returns at most 500 target candles. A manual, unscheduled worker
backfill task persists deeper histories; normal request handlers remain database-only.

## Testing and future backtesting

Offline tests cover right-side confirmation, plateau policy, open-candle exclusion,
replay/no-look-ahead, clustering, Top 3 bounds, determinism, timeframe identity, insufficient
history, SMA-seeded EMA, Wilder ADX intermediates, missing-evidence renormalization, paginated history
depth, weekly UTC boundaries and provider aggregation.

Future work should run versioned walk-forward evaluation over survivorship-aware histories. It must
record level creation time, first touch, rejection/break distance, maximum favorable/adverse move,
market regime, fees/slippage assumptions and provider data gaps. Parameter changes require a new
algorithm version; historical results must never be overwritten.

## Market State V1

Market State is a pure TypeScript context layer on top of, not a replacement for, Structural
Levels V1.1 and Trend Regime V1.1. The existing trend direction is mapped to bullish, neutral or
bearish exactly as calculated; Market State adds only the current phase, the next condition to wait
for, an optional reference zone and a conditional entry-window flag. It never predicts the next
candle and never emits BUY/SELL, size, leverage, target or expected-return output.

The exact V1 phase vocabulary is `slow_decline`, `slow_rise`, `sharp_drop`, `sharp_rise`,
`bottoming`, `topping`, `reversal_attempt_up`, `reversal_attempt_down`,
`reversal_confirmed_up`, `reversal_confirmed_down`, `pullback`, `rebound`, `support_confirmed`,
`resistance_confirmed`, `up_exhaustion` and `down_exhaustion`. Overlap resolves in this documented
order: level confirmation, reversal confirmation/attempt, stabilization, exhaustion, acceleration,
controlled retracement, then gradual pressure. This ordering and every threshold below are part of
`market-state-v1`.

The engine uses a maximum of 800 closed candles. ATR uses the existing 14-period Wilder series. A
sharp move requires a three-candle net move of at least 1.5 ATR plus recent true-range expansion of
at least 1.15 times the prior 20-candle ATR baseline. Gradual pressure uses eight candles, at least
0.8 ATR net movement, at least 60% directionally progressing closes and mean true range no greater
than 1.15 ATR. Stabilization requires a preceding 1.5 ATR directional move, three-candle confirmation,
no more than 0.25 ATR additional extreme extension, at least 0.35 ATR movement away from the extreme,
and either range contraction to 0.9 of the prior range or meaningful rejection wick evidence.

Reversal attempts break a confirmed micro swing by 0.1 ATR after recent stabilization. Confirmation
requires at least two subsequent closed candles to retain the reclaimed/lost structure within a 0.2
ATR buffer. Controlled pullback/rebound size is 0.35–1.5 ATR over three candles with no more than
1.2 ATR range expansion. S1/R1 confirmation reuses the existing zone bounds, allows a 0.1 ATR touch
buffer and rejects a candidate after a 0.15 ATR material break that is not quickly reclaimed.
Exhaustion requires a 12-candle extension of at least 3 ATR, deterministic weighted evidence at or
above 0.65, and actual weakening through fading swing progress, failed breakout, or rejection wick
without continued acceleration. Missing volume never invalidates a state; V1 does not require volume
because comparable volume is not guaranteed for every retained candle.

`next_wait` is deterministic. Sharp moves wait for stabilization; stabilization and reversal
attempts wait for reversal confirmation; confirmed upward/downward reversals wait for a pullback or
rebound; pullbacks/rebounds wait for support/resistance; exhaustion waits for the corresponding
controlled retracement. Neutral price near S1/R1 waits for that zone; neutral range-middle price
waits for a better location. `entry_window_candidate` is true only when bullish support confirmation
or bearish resistance confirmation matches the Trend direction and price is within 1 ATR of the
zone. It is a condition, not an order.

Historical annotations replay closed-candle prefixes and only record meaningful confirmed phase
transitions. The chart selects at most eight recent/strong markers from a bounded 160-candle replay
window. Every marker retains the exact market-instrument UUID, timeframe, confirmation timestamp,
reference zone and structured deterministic evidence. Ticker, public-trade and `confirm=false`
Kline updates remain visual only and cannot change Market State, entry-window state or markers.

### Confirmation stability and interaction markers

The raw V1 detector, phase vocabulary and all thresholds remain unchanged. A deterministic
closed-prefix lifecycle reducer follows classification. Sharp moves and reversal attempts can
replace an active confirmation immediately, as can a new detected confirmation. Support/resistance
confirmation is retained during the same valid zone interaction instead of alternating with
pullback/rebound noise. Other confirmations retain their initial evidence for at least three
closed-candle steps; ordinary phase exit then requires two consecutive matching raw results.
Actual invalidation bypasses that hold: support/resistance closes through the existing 0.15 ATR
failure buffer, bottoming/topping extend beyond their confirmation-window extreme by the existing
0.25 ATR extension allowance, and confirmed reversals close through their evidenced swing by the
existing 0.2 ATR hold buffer. Exhaustion loses its short hold when its observed extreme is extended
by that same allowance. Direction, next-wait and entry conditions are still calculated for the
current closed candle; retained evidence is not a fresh confirmation or an order.

Confirmation markers are emitted once per phase/interaction, even if a short intervening phase
temporarily exits the state. Zone identity uses kind and overlapping bounds (with the existing
0.1 ATR touch allowance for minor boundary drift), not mutable S1/R1 rank or rounded IDs.
A level episode resets when the close materially leaves its zone by more
than the existing 0.75 ATR near-zone distance or breaches the failure buffer; a later qualifying
test/reclaim can then emit a new marker. Non-level episodes reset after price moves more than
the existing 1.5 ATR material-move distance from confirmation, or stabilization/reversal structure
is invalidated. Exhaustion noise does not itself rearm markers. Distances use ATR frozen at episode
confirmation, avoiding rearming through ATR fluctuation alone. No new detector thresholds, wall-clock
cooldown, browser storage or backend persistence are introduced.
The raw detector's lingering recent test cannot emit another level marker while price is already
outside the interaction zone; departure alone is not a new confirmation.

State and markers share one replay, using only each historical prefix's candles and technical
snapshot. Earlier prefixes within the existing 800-candle calculation bound warm up lifecycle
state; marker selection remains within the existing 160-candle replay window and maximum eight.
Identical closed inputs produce identical results, independent of live partial candles.

For neutral direction with only the range-location fallback (or no usable phase evidence), the
Chart hides the directional slow-rise/slow-decline phase label. Its primary presentation is
Range / 震荡 with the existing better-location wait, or support/resistance wait when near a zone.
Strong detected phases remain visible and the underlying V1 phase contract is unchanged.

Chart transient UI state is scoped to the exact market-instrument UUID and timeframe. Identity
changes clear marker detail/pinning, reset displayed price to the new server price and reset stream
status until the new stream updates it. The page also keys the client chart by that identity.
Tooltip rendering independently rejects mismatched marker UUIDs or timeframes, and callbacks from
disposed streams cannot overwrite new-identity state. None of this changes calculated states,
markers, levels, trend or replay semantics.
