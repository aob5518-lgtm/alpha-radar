# MA Confluence Entry V1.1 — frozen-input coverage comparison

## Outcome — zero-READY stop condition reached

**Coverage was NOT restored.** All four fixed modes produced zero LONG_READY and
zero SHORT_READY on the exact 90-day dataset. This implementation is a Draft for
review, not a production-accepted coverage fix. No additional gate is loosened;
no automatic merge or deployment is authorized.

V1: WATCH_LONG 5, WATCH_SHORT 0, WAIT 34,015. V1.1: WATCH_LONG 13,
WATCH_SHORT 1, WAIT 34,006. READY and MISSED are zero in both versions.

## Scope and provenance

Base main (audit PR #21 squash): `4ec1617e17a560e244b7c89616f3519e472b173e`. No deployment.
MA version: `ma-confluence-entry-v1.1`; Trade Guide remains `trade-guide-v1`.
Frozen input SHA-256: `ab818b5c304848215f2f82daf4e827b89f4e05f1718c389c6158e0dba4f3d150` (identical to the V1 audit).
Scoring: 2026-07-29T13:11:21.629655+00:00 through 2026-10-27T13:11:21.629655+00:00; BTC/ETH/SOL × 15m/1h/4h,
34,020 confirmed scored candles; original zero-gap primary/higher inputs retained.
No provider fetch, partial bars, fabricated candles, future pivots, PnL or win-rate
analysis. Current stored-vintage/arrival limitations remain those of the original
[V1 audit](TRADE_GUIDE_SIGNAL_AUDIT.md).

Each prefix computes unchanged Levels/Trend/Market State/Setup once. Four MA modes
consume that same context and the same unchanged Guide. V1 uses the frozen source;
its per-pair counts and complete funnels are checked exactly against PR #21.
Both native V1 and native V1.1 outputs are checked against observational probes on
every bar. The two ablations swap only original/current target-room blocks; no
runtime flags or alternative production strategies are introduced.

## Exact two changes

1. A confirmed observed retest starts an explicit episode after the unchanged
   impulse. Age 0 touch plus at most 3 additional closed bars; no contiguous-touch
   renewal. Trigger consumes it. Stop breach, trend flip/material State conflict,
   existing chop/excess-touch or extension cancels it; separate departed/re-entered
   touch can replace it. Cursor identity/settings/source-revision checks and
   before-current checkpoint preserve deterministic same-bar HTF recomputation.
2. Room uses existing trigger/reference entry, not confirmed close. Nearest real
   opposing point must lie beyond planned entry; inside/overlapping entry structures
   are local obstacles/confluence, not TP1. A true forward obstacle is never skipped
   to improve room. **0.9 ATR stays unchanged.**

Stop formulas/buffer and Guide R:R **1.2 / 1.5 / 2.0** do not change. MA slope,
impulse/chop/touch/MACD/volume/price/score constants all deep-equal the V1 oracle.
No original Levels/Trend/State/Setup, phase enum or Worker protocol/cache changes.

**Session boundary:** episode cursor is committed by MaChartLayer only on accepted
confirmed context, not browser clocks, localStorage or backend persistence. Cold
loads do not invent delayed episodes from absent old touches; only a current closed
touch can initialize them. Reload/settings/remount may therefore omit a confirmation
seen by a continuously mounted chart. Replay burns in 27 contexts before scoring;
this is not proof of historical client delivery. Full chronological and incremental
Worker folding use the same explicit state sequence, not a stateless back-search.

## V1 vs V1.1 — all nine combinations

| Pair/period | Version | LONG_READY | SHORT_READY | WATCH_LONG | WATCH_SHORT | WAIT | MISSED |
| ----------- | ------- | ---------- | ----------- | ---------- | ----------- | ---- | ------ |
| BTC 15m     | v1      | 0          | 0           | 0          | 0           | 8640 | 0      |
| BTC 15m     | v11     | 0          | 0           | 2          | 0           | 8638 | 0      |
| BTC 1h      | v1      | 0          | 0           | 0          | 0           | 2160 | 0      |
| BTC 1h      | v11     | 0          | 0           | 1          | 0           | 2159 | 0      |
| BTC 4h      | v1      | 0          | 0           | 0          | 0           | 540  | 0      |
| BTC 4h      | v11     | 0          | 0           | 0          | 0           | 540  | 0      |
| ETH 15m     | v1      | 0          | 0           | 2          | 0           | 8638 | 0      |
| ETH 15m     | v11     | 0          | 0           | 5          | 0           | 8635 | 0      |
| ETH 1h      | v1      | 0          | 0           | 1          | 0           | 2159 | 0      |
| ETH 1h      | v11     | 0          | 0           | 2          | 0           | 2158 | 0      |
| ETH 4h      | v1      | 0          | 0           | 0          | 0           | 540  | 0      |
| ETH 4h      | v11     | 0          | 0           | 1          | 0           | 539  | 0      |
| SOL 15m     | v1      | 0          | 0           | 2          | 0           | 8638 | 0      |
| SOL 15m     | v11     | 0          | 0           | 2          | 0           | 8638 | 0      |
| SOL 1h      | v1      | 0          | 0           | 0          | 0           | 2160 | 0      |
| SOL 1h      | v11     | 0          | 0           | 0          | 1           | 2159 | 0      |
| SOL 4h      | v1      | 0          | 0           | 0          | 0           | 540  | 0      |
| SOL 4h      | v11     | 0          | 0           | 0          | 0           | 540  | 0      |

## Attribution ablation (READY closed-bar observations)

| Pair/period | V1 READY L/S | Episode only L/S | Room only L/S | V1.1 L/S |
| ----------- | ------------ | ---------------- | ------------- | -------- |
| BTC 15m     | 0/0          | 0/0              | 0/0           | 0/0      |
| BTC 1h      | 0/0          | 0/0              | 0/0           | 0/0      |
| BTC 4h      | 0/0          | 0/0              | 0/0           | 0/0      |
| ETH 15m     | 0/0          | 0/0              | 0/0           | 0/0      |
| ETH 1h      | 0/0          | 0/0              | 0/0           | 0/0      |
| ETH 4h      | 0/0          | 0/0              | 0/0           | 0/0      |
| SOL 15m     | 0/0          | 0/0              | 0/0           | 0/0      |
| SOL 1h      | 0/0          | 0/0              | 0/0           | 0/0      |
| SOL 4h      | 0/0          | 0/0              | 0/0           | 0/0      |

Modes are diagnostic, fixed in advance, not parameter searches. Differences are
not additive causal/PnL contributions; the gates interact. Exact same-confirmation
attribution for V1.1 episode starts: {"episode_only":0,"room_only":0,"combination_required":0,"either_independently":0,"already_v1":0}.
Each actual READY confirmation is independently re-evaluated with bounded pre-scoring
cursor warm-up; another mode's continuing READY is not mistaken for an absent
signal just because its episode started earlier. Fields are included in compact records.

## Complete per-pair funnel (V1 → V1.1)

Same requested cumulative same-bar gate order. Early returned/unmeasured stages
are not fabricated as passes. Full raw/first-blocker and four-mode per-pair funnels
remain in [machine-readable comparison](MA_ENTRY_V11_COMPARISON.json).
Early-return availability can change upstream observed-pass counts even where
the numeric feature/threshold is frozen: V1 level_failed exits before the probe,
while an expired/cancelled V1.1 episode may continue as observation. This is not
evidence that slope/MACD/volume thresholds were changed or relaxed.

| Gate                       | BTC 15m     | BTC 1h      | BTC 4h    | ETH 15m     | ETH 1h      | ETH 4h    | SOL 15m     | SOL 1h      | SOL 4h    | Total         |
| -------------------------- | ----------- | ----------- | --------- | ----------- | ----------- | --------- | ----------- | ----------- | --------- | ------------- |
| direction available        | 6964 → 6964 | 1769 → 1769 | 429 → 429 | 6853 → 6853 | 1796 → 1796 | 448 → 448 | 7080 → 7080 | 1735 → 1735 | 426 → 426 | 27500 → 27500 |
| MA slope aligned           | 4999 → 5015 | 1328 → 1340 | 319 → 319 | 4712 → 4733 | 1250 → 1256 | 344 → 346 | 5361 → 5401 | 1318 → 1322 | 379 → 379 | 20010 → 20111 |
| impulse exists             | 4930 → 4945 | 1322 → 1333 | 319 → 319 | 4605 → 4623 | 1220 → 1226 | 343 → 345 | 5244 → 5278 | 1288 → 1290 | 379 → 379 | 19650 → 19738 |
| recent retest exists       | 539 → 208   | 100 → 44    | 32 → 5    | 584 → 190   | 176 → 51    | 54 → 15   | 568 → 165   | 144 → 54    | 11 → 5    | 2208 → 737    |
| chop filter passed         | 374 → 208   | 93 → 44     | 17 → 5    | 430 → 190   | 131 → 51    | 48 → 15   | 376 → 165   | 83 → 54     | 9 → 5     | 1561 → 737    |
| retest-count filter passed | 296 → 208   | 75 → 44     | 10 → 5    | 307 → 190   | 72 → 51     | 21 → 15   | 275 → 165   | 77 → 54     | 9 → 5     | 1142 → 737    |
| MACD passed                | 51 → 19     | 18 → 1      | 1 → 0     | 76 → 17     | 11 → 4      | 11 → 6    | 64 → 10     | 20 → 3      | 2 → 1     | 254 → 61      |
| volume passed              | 22 → 5      | 9 → 0       | 0 → 0     | 33 → 3      | 4 → 2       | 4 → 2     | 31 → 3      | 12 → 2      | 0 → 0     | 115 → 17      |
| price confirmation passed  | 12 → 3      | 3 → 0       | 0 → 0     | 13 → 0      | 3 → 1       | 2 → 0     | 13 → 0      | 4 → 0       | 0 → 0     | 50 → 4        |
| real target exists         | 12 → 3      | 3 → 0       | 0 → 0     | 13 → 0      | 3 → 1       | 2 → 0     | 13 → 0      | 4 → 0       | 0 → 0     | 50 → 4        |
| structural room passed     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0         |
| not overextended           | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0         |
| candidate score >=65       | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0         |
| trigger score >=80         | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0         |
| R:R >=1.2                  | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0         |
| R:R >=1.5                  | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0         |
| final READY                | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0       | 0 → 0       | 0 → 0     | 0 → 0         |

## Aggregate four-mode funnel

| Gate                       | v1    | episode_only | room_only | v11   |
| -------------------------- | ----- | ------------ | --------- | ----- |
| direction available        | 27500 | 27500        | 27500     | 27500 |
| MA slope aligned           | 20010 | 20111        | 20010     | 20111 |
| impulse exists             | 19650 | 19738        | 19650     | 19738 |
| recent retest exists       | 2208  | 737          | 2208      | 737   |
| chop filter passed         | 1561  | 737          | 1561      | 737   |
| retest-count filter passed | 1142  | 737          | 1142      | 737   |
| MACD passed                | 254   | 61           | 254       | 61    |
| volume passed              | 115   | 17           | 115       | 17    |
| price confirmation passed  | 50    | 4            | 50        | 4     |
| real target exists         | 50    | 4            | 50        | 4     |
| structural room passed     | 0     | 0            | 1         | 0     |
| not overextended           | 0     | 0            | 0         | 0     |
| candidate score >=65       | 0     | 0            | 0         | 0     |
| trigger score >=80         | 0     | 0            | 0         | 0     |
| R:R >=1.2                  | 0     | 0            | 0         | 0     |
| R:R >=1.5                  | 0     | 0            | 0         | 0     |
| final READY                | 0     | 0            | 0         | 0     |

## READY examples and distribution

V1.1 READY bars: **0**; episode starts / compact snapshots: **0**.
LONG bars: 0; SHORT bars: 0.
Episode starts count a new READY direction or transition from non-READY, not every
repeated READY observation. All starts are exported in
[compact records](MA_ENTRY_V11_READY_EPISODES.json), never raw provider candle sets.

| Timeframe | LONG_READY bars | SHORT_READY bars | READY episode starts |
| --------- | --------------- | ---------------- | -------------------- |
| 15m       | 0               | 0                | 0                    |
| 1h        | 0               | 0                | 0                    |
| 4h        | 0               | 0                | 0                    |

No READY exists, so there are no qualifying historical examples to fabricate or
present. Positive/negative synthetic regression fixtures remain explicitly test-only.

## Acceptance answers

1. Any READY? **NO**, 0 bars, 0 episode starts.
2. Which change recovered it? **NONE.** Neither episode-only, room-only nor their
   combination recovered READY. Room-only let one bar pass room, but that bar
   failed the unchanged overextension gate. Combined lifecycle eligibility is
   narrower (2,208 → 737 at cumulative retest), not a broad filter relaxation;
   its four bars reaching price-confirmation/target all fail room. These are
   measured results, not a reason to loosen another gate or lower R:R.
3. Both directions? Long 0, short 0.
4. Timeframes? Exact distribution above; missing cohorts remain unavailable.
5. Anti-chop? **PASS.** Existing bad-pattern fixtures remain rejected: flat MA,
   repeated crossings, excess touches, no impulse, MACD conflict, weak/missing
   volume, invalidated retest, chase, missing real target and poor R:R.
6. R:R/stop rule changed? **NO** — values/formulas remain frozen; retest membership
   and target/anchor semantics are the two explicitly authorized changes.

**STOP: corrected semantics still yield zero READY. No additional gates are loosened.**

## Verification

Local lint/typecheck/format/build passed; backend ruff check/format and pyright
(0 errors) passed, pytest 89 passed (existing Starlette deprecation warning).
Expanded frontend suite **281 passed** and includes mirrored 1/2/3-bar confirmation, fourth-bar expiry,
invalidation/conflict/chop/extension, separate episodes, same-bar HTF rewind,
source correction/identity resets, partial safety, immutable numeric rules and
115-step growing/rolling-800 prewarmed Worker equivalence. Final-head normal CI is
recorded on the PR after it completes.

Synthetic 320-bar pure-MA diagnostic (100 local runs, not production P95):
V1 median 0.414ms; V1.1 median 0.696ms, P95 1.118ms. No technical-engine replay
was added to the interactive MA path. The first implementation Actions run
(40528690827) passed frontend/backend/real Compose integration. Local Docker is
unavailable, so local Compose success is not claimed; final-head CI remains required.
No deployment, migration, provider fetch or production write occurred.
