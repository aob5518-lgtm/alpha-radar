# Entry V1.2 / Guide V1.1 — frozen 90-day coverage

Production/model base: `69a74425e68157ef634a723309d665b3996d9509`. Engineering main base `4ec1617` contains only the approved PR #21 audit addition. PR #22 remains excluded/unmerged/undeployed.

Input SHA-256: `ab818b5c304848215f2f82daf4e827b89f4e05f1718c389c6158e0dba4f3d150`.
Model-source SHA-256 (MA, evidence, Guide concatenated in runner order): `e8dea0ddb65d652f7b130a986485c22663bab612ae39624a9848b7dbe6463dbf`.

Window: 2026-07-29T13:11:21.629655+00:00 through 2026-10-27T13:11:21.629655+00:00. Exactly **34,020** closed scoring bars; BTC/ETH/SOL Bybit USDT perpetuals × 15m/1h/4h, full bounded warm-up and causal closed HTF only. No gaps, duplicate candles or future HTF injection.

Acceptance guard: **nonzero_selective_review_required**. Rules were fixed before this run. No count/return fitting. Greatest distinct READY-episode density is 1.711 per week for one instrument/period; this is descriptive, not an optimal target.

## V1 versus V1.2

| State | V1 bars | V1.2 bars |
| --- | --- | --- |
| LONG_READY | 0 | 51 |
| SHORT_READY | 0 | 32 |
| WATCH_LONG | 5 | 129 |
| WATCH_SHORT | 0 | 59 |
| WAIT | 34015 | 33691 |
| MISSED | 0 | 58 |

READY: 0 → 83 bars. WATCH: 5 → 188 bars. Distinct READY episodes: 77 (47 long / 30 short). A repeated READY bar in the same contiguous structure/origin is not counted as a new episode.

| Instrument | Period | Bars | LONG_READY | SHORT_READY | WATCH_LONG | WATCH_SHORT | WAIT | MISSED | Episodes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 15m | 8640 | 4 | 11 | 21 | 8 | 8588 | 8 | 14 |
| BTCUSDT | 1h | 2160 | 1 | 0 | 12 | 2 | 2143 | 2 | 1 |
| BTCUSDT | 4h | 540 | 2 | 0 | 1 | 0 | 531 | 6 | 2 |
| ETHUSDT | 15m | 8640 | 9 | 7 | 27 | 13 | 8578 | 6 | 16 |
| ETHUSDT | 1h | 2160 | 11 | 1 | 20 | 3 | 2118 | 7 | 12 |
| ETHUSDT | 4h | 540 | 6 | 0 | 12 | 0 | 522 | 0 | 4 |
| SOLUSDT | 15m | 8640 | 14 | 11 | 20 | 18 | 8554 | 23 | 22 |
| SOLUSDT | 1h | 2160 | 1 | 2 | 5 | 12 | 2137 | 3 | 3 |
| SOLUSDT | 4h | 540 | 3 | 0 | 11 | 3 | 520 | 3 | 3 |

## Direction and period distribution

| Period | Long READY bars | Short READY bars | Watch long | Watch short | Long episodes | Short episodes |
| --- | --- | --- | --- | --- | --- | --- |
| 15m | 27 | 29 | 68 | 39 | 25 | 27 |
| 1h | 13 | 3 | 37 | 17 | 13 | 3 |
| 4h | 11 | 0 | 24 | 3 | 9 | 0 |

Both directions appear in the frozen data. Counts need not be balanced; mirrored tests use identical rules/weights. No parameter was selected to force equal coverage.

## Representative historical reconstruction

| Instrument | Period | UTC close | Direction | Structure | Grade | Score | R:R |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BTCUSDT | 15m | 2026-08-18T16:45:00+00:00 | long | support_pullback | B | 72 | 5.188 |
| BTCUSDT | 1h | 2026-08-22T13:00:00+00:00 | long | support_pullback | B | 72 | 4.438 |
| BTCUSDT | 4h | 2026-09-30T12:00:00+00:00 | long | support_pullback | A | 84 | 1.740 |
| BTCUSDT | 15m | 2026-08-03T06:45:00+00:00 | short | resistance_rejection | A | 92 | 2.113 |
| ETHUSDT | 1h | 2026-10-26T03:00:00+00:00 | short | resistance_rejection | A | 83 | 1.547 |

The companion `TRADE_GUIDE_V12_EPISODES.json` contains **every** distinct READY episode: exact UUID/period/time, origin/type, entry/stop/real TP1/TP2 and provenance, R:R, grade/points, hard status and all seven contributions (including MACD, volume and State).

The companion `TRADE_GUIDE_V12_REVIEW.json` contains 20 positive and 12 rejected compact records. Each includes exact source-hash/window bounds, accepted levels/Trend/State, diagnostics and reasons. Positive samples were reconstructed without future bars, compared against archived prices/grade and passed the actual TSX primary badge/arrow/tooltip/identity harness. Each also matched an actual rolling-800 Worker checkpoint/append exactly, including score, grade and complete plan. Chart/socket dependencies are mocked. This is not a deployed browser smoke.

## Rejection / anti-chop diagnostics

| Gate / pending reason | Bars (overlapping diagnostics) |
| --- | --- |
| no_retest | 11925 |
| trend_conflict | 6207 |
| excess_retests | 4481 |
| repeated_crosses | 4207 |
| macd_conflict | 3298 |
| opposing_volume | 3169 |
| expired | 1952 |
| invalidated | 1422 |
| poor_rr | 933 |
| target_reached | 913 |
| level_failed | 274 |
| no_target | 171 |
| confirmation_pending | 107 |
| watch_rr | 81 |
| overextended | 58 |

Hard failures cannot be compensated by 100 evidence points. Regression tests cover repeated crosses, excess MA touches, absent structure/stop/target, stop failure, opposite confirmed reversal, severe MACD acceleration/explosive opposition, poor R:R and chase. Partial input leaves the entire score/grade/plan unchanged. Explicit bounded MISSED evidence prevents same-interaction resurrection after temporary WAIT. Growing/rolling Worker prefixes equal full replay exactly; stale UUID/period/revision results remain rejected.

## Performance

| Instrument | Period | Additional MA + Guide median ms | p90 ms | max ms |
| --- | --- | --- | --- | --- |
| BTCUSDT | 15m | 0.215 | 0.585 | 5.397 |
| BTCUSDT | 1h | 0.206 | 0.557 | 4.070 |
| BTCUSDT | 4h | 0.204 | 0.545 | 1.341 |
| ETHUSDT | 15m | 0.206 | 0.564 | 10.428 |
| ETHUSDT | 1h | 0.231 | 0.620 | 1.777 |
| ETHUSDT | 4h | 0.309 | 0.846 | 15.925 |
| SOLUSDT | 15m | 0.177 | 0.490 | 1.856 |
| SOLUSDT | 1h | 0.179 | 0.521 | 1.680 |
| SOLUSDT | 4h | 0.203 | 0.555 | 1.734 |

These local wall-clock samples include scheduling contention with parallel historical replay; they exclude the unchanged expensive technical engines and are not production P95. No engine rerun or Worker protocol change was introduced. The standalone synthetic benchmark commands below separately measure MA and Guide.

## Reproduce

```sh
node --experimental-strip-types scripts/audit/coverage-v12.mjs INPUT.json /tmp/v12-coverage 3
node --experimental-strip-types scripts/audit/review-v12.mjs INPUT.json /tmp/v12-coverage/comparison.json docs/TRADE_GUIDE_V12
node scripts/audit/report-v12.mjs docs/TRADE_GUIDE_V12
node --experimental-strip-types scripts/benchmark-ma-entry.mjs
node --experimental-strip-types scripts/benchmark-trade-guide.mjs
```

Original V1 reports/fixtures remain immutable. The runner asserts the original V1 totals and rejects input/model hash drift. No raw provider dataset, production configuration or secret is committed.

## Limits

The private input is the current stored/backfilled vintage. Historical arrivals/revisions and actual browser deliveries were not archived; this is causal closed-prefix replay of that vintage, not proof of what a user saw then. Grades are uncalibrated ordinal evidence quality. R:R is price geometry before fees/slippage; no PnL, returns or win rate was computed. Coverage alone does not validate profitability. No deployment or production-trading threshold change is authorized by this report.
