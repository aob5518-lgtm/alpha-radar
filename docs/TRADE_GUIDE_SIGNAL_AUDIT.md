# Trade Guide signal-coverage audit

## 1. Dataset and reproducibility

Base / deployed algorithms: `69a74425e68157ef634a723309d665b3996d9509`; default **enabled SMA99**, unchanged
`ma-confluence-entry-v1` and `trade-guide-v1`. Exported read-only from canonical
stored **Bybit USDT perpetual** candles at **2026-10-27T13:11:21.629655+00:00**.
Requested scoring start: **2026-07-29T13:11:21.629655+00:00** (90 days).
Frozen input SHA-256: `ab818b5c304848215f2f82daf4e827b89f4e05f1718c389c6158e0dba4f3d150`.
The frozen input and full per-series snapshots remain local operational artifacts,
not redistributed provider candle data. The [companion JSON](TRADE_GUIDE_SIGNAL_AUDIT.json)
contains counts/metadata and derived rendering-verification results only.

| Pair/period | First close → last close (UTC)                        | Scored bars | Primary warm-up | Missing bars / gaps | Stale/missing HTF evaluations |
| ----------- | ----------------------------------------------------- | ----------- | --------------- | ------------------- | ----------------------------- |
| BTC 15m     | 2026-07-29T13:15:00+00:00 → 2026-10-27T13:00:00+00:00 | 8640        | 799             | 0 / 0               | 0                             |
| BTC 1h      | 2026-07-29T14:00:00+00:00 → 2026-10-27T13:00:00+00:00 | 2160        | 799             | 0 / 0               | 0                             |
| BTC 4h      | 2026-07-29T16:00:00+00:00 → 2026-10-27T12:00:00+00:00 | 540         | 799             | 0 / 0               | 0                             |
| ETH 15m     | 2026-07-29T13:15:00+00:00 → 2026-10-27T13:00:00+00:00 | 8640        | 799             | 0 / 0               | 0                             |
| ETH 1h      | 2026-07-29T14:00:00+00:00 → 2026-10-27T13:00:00+00:00 | 2160        | 799             | 0 / 0               | 0                             |
| ETH 4h      | 2026-07-29T16:00:00+00:00 → 2026-10-27T12:00:00+00:00 | 540         | 799             | 0 / 0               | 0                             |
| SOL 15m     | 2026-07-29T13:15:00+00:00 → 2026-10-27T13:00:00+00:00 | 8640        | 799             | 0 / 0               | 0                             |
| SOL 1h      | 2026-07-29T14:00:00+00:00 → 2026-10-27T13:00:00+00:00 | 2160        | 799             | 0 / 0               | 0                             |
| SOL 4h      | 2026-07-29T16:00:00+00:00 → 2026-10-27T12:00:00+00:00 | 540         | 799             | 0 / 0               | 0                             |

At each primary close, the unchanged production context entry point computes Levels,
Trend, Market State (including its full prefix lifecycle/markers) and Trade Setup,
then the unchanged MA and Guide functions consume that exact context. Primary and
higher history are limited to their latest **800 confirmed bars available by that
close**. Higher evidence is omitted when stale using the current Chart cache rule.
The final full-history snapshot is NEVER used to label an earlier candle. Three
pre-scoring steps warm Guide's bounded prior-READY memory. READY memory is committed
and cleared on WAIT exactly like MaChartLayer; this models a continuously mounted
default-settings session, not every possible tab reload/user setting.
Every bar compares full original and observational-probe MA/Guide outputs for equality.
No thresholds, algorithms, production configuration or database schema changed.

**As-of limitation:** this is a causal closed-bar replay of the **current stored
vintage**, not proof of what an historical browser actually received. Stored candles
were backfilled/upserted; arrival/revision history and historical client settings/
stream delivery are not fully archived. 41166 exported
primary candles have ingestion timestamps more than one interval after close
(includes warm-up). These cannot establish contemporaneous availability. No PnL,
win rate, executable fill, future return or optimal threshold is evaluated.

## 2. Continuity

0 primary continuity gaps were found. Gaps, if present, are
retained and listed in the companion JSON; never interpolated or silently fabricated.
Rows with invalid OHLC/volume, duplicate times, wrong UUID/provider, partial status or
future close fail the audit. Timing respects stored close boundaries (inclusive
millisecond closes are accepted). Missing external data is not invented.
All exported primary/higher series gap counts: BTCUSDT/1h: 0; BTCUSDT/1d: 0; BTCUSDT/15m: 0; BTCUSDT/4h: 0; ETHUSDT/1h: 0; ETHUSDT/1d: 0; ETHUSDT/15m: 0; ETHUSDT/4h: 0; SOLUSDT/1h: 0; SOLUSDT/1d: 0; SOLUSDT/15m: 0; SOLUSDT/4h: 0.

## 3. Primary state frequency

| Pair/period | Bars | LONG_READY | SHORT_READY | WATCH_LONG | WATCH_SHORT | WAIT            | MISSED     | READY episodes / day / week | Median bars between |
| ----------- | ---- | ---------- | ----------- | ---------- | ----------- | --------------- | ---------- | --------------------------- | ------------------- |
| BTC 15m     | 8640 | 0 (0.000%) | 0 (0.000%)  | 0 (0.000%) | 0 (0.000%)  | 8640 (100.000%) | 0 (0.000%) | 0 / 0 / 0                   | —                   |
| BTC 1h      | 2160 | 0 (0.000%) | 0 (0.000%)  | 0 (0.000%) | 0 (0.000%)  | 2160 (100.000%) | 0 (0.000%) | 0 / 0 / 0                   | —                   |
| BTC 4h      | 540  | 0 (0.000%) | 0 (0.000%)  | 0 (0.000%) | 0 (0.000%)  | 540 (100.000%)  | 0 (0.000%) | 0 / 0 / 0                   | —                   |
| ETH 15m     | 8640 | 0 (0.000%) | 0 (0.000%)  | 2 (0.023%) | 0 (0.000%)  | 8638 (99.977%)  | 0 (0.000%) | 0 / 0 / 0                   | —                   |
| ETH 1h      | 2160 | 0 (0.000%) | 0 (0.000%)  | 1 (0.046%) | 0 (0.000%)  | 2159 (99.954%)  | 0 (0.000%) | 0 / 0 / 0                   | —                   |
| ETH 4h      | 540  | 0 (0.000%) | 0 (0.000%)  | 0 (0.000%) | 0 (0.000%)  | 540 (100.000%)  | 0 (0.000%) | 0 / 0 / 0                   | —                   |
| SOL 15m     | 8640 | 0 (0.000%) | 0 (0.000%)  | 2 (0.023%) | 0 (0.000%)  | 8638 (99.977%)  | 0 (0.000%) | 0 / 0 / 0                   | —                   |
| SOL 1h      | 2160 | 0 (0.000%) | 0 (0.000%)  | 0 (0.000%) | 0 (0.000%)  | 2160 (100.000%) | 0 (0.000%) | 0 / 0 / 0                   | —                   |
| SOL 4h      | 540  | 0 (0.000%) | 0 (0.000%)  | 0 (0.000%) | 0 (0.000%)  | 540 (100.000%)  | 0 (0.000%) | 0 / 0 / 0                   | —                   |

Total scored bars: **34020**. READY bars: **0**;
independent READY episode starts: **0**.
Signals/day and /week count starts, not repeated adjacent READY bars. A different
READY direction or a non-READY interruption starts a new episode. Median distance
is in observed primary candle steps; undefined when fewer than two starts.
WATCH can be an MA observation with incomplete confirmation, not a promoted MA
candidate or a complete executable plan. Empirical quantiles use the lower order
statistic at index floor((n−1)×p); undefined cohorts remain unavailable, not zero.

## 4. MA funnel

Each cell is a **cumulative same-bar** pass count, in the requested diagnostic order
(not production execution precedence). Early-return/unavailable values do not pass.
Later gates masked by an earlier production return are not invented as evaluated.

| Gate                       | BTC 15m | BTC 1h | BTC 4h | ETH 15m | ETH 1h | ETH 4h | SOL 15m | SOL 1h | SOL 4h | Total |
| -------------------------- | ------- | ------ | ------ | ------- | ------ | ------ | ------- | ------ | ------ | ----- |
| direction available        | 6964    | 1769   | 429    | 6853    | 1796   | 448    | 7080    | 1735   | 426    | 27500 |
| MA slope aligned           | 4999    | 1328   | 319    | 4712    | 1250   | 344    | 5361    | 1318   | 379    | 20010 |
| impulse exists             | 4930    | 1322   | 319    | 4605    | 1220   | 343    | 5244    | 1288   | 379    | 19650 |
| recent retest exists       | 539     | 100    | 32     | 584     | 176    | 54     | 568     | 144    | 11     | 2208  |
| chop filter passed         | 374     | 93     | 17     | 430     | 131    | 48     | 376     | 83     | 9      | 1561  |
| retest-count filter passed | 296     | 75     | 10     | 307     | 72     | 21     | 275     | 77     | 9      | 1142  |
| MACD passed                | 51      | 18     | 1      | 76      | 11     | 11     | 64      | 20     | 2      | 254   |
| volume passed              | 22      | 9      | 0      | 33      | 4      | 4      | 31      | 12     | 0      | 115   |
| price confirmation passed  | 12      | 3      | 0      | 13      | 3      | 2      | 13      | 4      | 0      | 50    |
| real target exists         | 12      | 3      | 0      | 13      | 3      | 2      | 13      | 4      | 0      | 50    |
| structural room passed     | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |
| not overextended           | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |
| candidate score >=65       | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |
| trigger score >=80         | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |
| R:R >=1.2                  | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |
| R:R >=1.5                  | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |
| final READY                | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |

An adverse MA gate caps the production score at 64. Zero passes at score 65/80
can therefore be a consequence of earlier gates, not evidence that score thresholds
are the root cause. Likewise, a zero numeric R:R cohort means R:R was not reached,
not that changing the R:R threshold would recover those bars.

Directional episodes = contiguous non-none MA directional bias, reset on direction
change/none. Below, each episode counts once for the furthest cumulative same-bar
stage attained by any of its bars; gates are not assembled across different bars.

| Gate                       | BTC 15m | BTC 1h | BTC 4h | ETH 15m | ETH 1h | ETH 4h | SOL 15m | SOL 1h | SOL 4h | Total |
| -------------------------- | ------- | ------ | ------ | ------- | ------ | ------ | ------- | ------ | ------ | ----- |
| direction available        | 384     | 93     | 28     | 419     | 107    | 20     | 389     | 100    | 19     | 1559  |
| MA slope aligned           | 244     | 54     | 15     | 237     | 62     | 13     | 243     | 59     | 14     | 941   |
| impulse exists             | 232     | 53     | 15     | 225     | 58     | 13     | 230     | 53     | 14     | 893   |
| recent retest exists       | 127     | 25     | 6      | 130     | 38     | 7      | 118     | 34     | 3      | 488   |
| chop filter passed         | 109     | 23     | 5      | 116     | 29     | 7      | 96      | 28     | 3      | 416   |
| retest-count filter passed | 94      | 20     | 5      | 96      | 20     | 3      | 83      | 24     | 3      | 348   |
| MACD passed                | 28      | 9      | 1      | 35      | 7      | 2      | 28      | 10     | 2      | 122   |
| volume passed              | 16      | 7      | 0      | 21      | 3      | 2      | 20      | 8      | 0      | 77    |
| price confirmation passed  | 11      | 3      | 0      | 11      | 2      | 1      | 12      | 4      | 0      | 44    |
| real target exists         | 11      | 3      | 0      | 11      | 2      | 1      | 12      | 4      | 0      | 44    |
| structural room passed     | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |
| not overextended           | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |
| candidate score >=65       | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |
| trigger score >=80         | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |
| R:R >=1.2                  | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |
| R:R >=1.5                  | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |
| final READY                | 0       | 0      | 0      | 0       | 0      | 0      | 0       | 0      | 0      | 0     |

## 5. Blocker ranking

MA raw counts are the exact emitted adverse reason codes (including simultaneous
reasons); first decisive is their **actual production insertion order**, not this
report's table ordering. A closed level failure returns early with only level_failed.
Weak confirmation is decisive for trigger promotion even when a candidate survives.

| Reason            | Raw output occurrences | First decisive |
| ----------------- | ---------------------- | -------------- |
| no_retest         | 21613                  | 16712          |
| trend_conflict    | 8768                   | 8768           |
| flat_ma           | 4806                   | 4806           |
| repeated_crosses  | 4102                   | 1389           |
| near_obstruction  | 26948                  | 880            |
| excess_retests    | 4463                   | 675            |
| level_failed      | 436                    | 436            |
| overextended      | 20852                  | 257            |
| no_impulse        | 2444                   | 92             |
| macd_conflict     | 15238                  | 5              |
| no_target         | 0                      | 0              |
| weak_confirmation | 22596                  | 0              |
| weak_volume       | 17871                  | 0              |
| missing_volume    | 0                      | 0              |
| macd_unready      | 0                      | 0              |

Guide deliberately returns one reason at its first blocking branch. Thus raw and
first-decisive counts coincide; unvisited downstream gates are **not** claimed to
have passed or failed. A zero poor_rr can mean no setup reached R:R evaluation.

| Reason               | Raw output occurrences | First decisive |
| -------------------- | ---------------------- | -------------- |
| noise                | 19047                  | 19047          |
| no_target            | 6624                   | 6624           |
| unavailable          | 6520                   | 6520           |
| invalidated          | 1824                   | 1824           |
| confirmation_pending | 5                      | 5              |
| conflict             | 0                      | 0              |
| invalid_risk         | 0                      | 0              |
| poor_rr              | 0                      | 0              |
| watch_rr             | 0                      | 0              |
| extended             | 0                      | 0              |
| target_reached       | 0                      | 0              |
| context_mismatch     | 0                      | 0              |
| identity_mismatch    | 0                      | 0              |

## 6. Retest-window audit

Strict denominator: the **only** emitted MA adverse reason is no_retest. Check for
an actual historical touch in trailing 4/5/6 bars, after the unchanged original
impulse, against its contemporary MA/ATR zone. Nested windows overlap. This is
coverage only: do not recalculate the impulse, stop, score or predict READY under a
different model; no production retestLookback was changed.

| Pair/period | Only no_retest | Touch within 4 / 5 / 6 bars |
| ----------- | -------------- | --------------------------- |
| BTC 15m     | 0              | 0 / 0 / 0                   |
| BTC 1h      | 0              | 0 / 0 / 0                   |
| BTC 4h      | 0              | 0 / 0 / 0                   |
| ETH 15m     | 0              | 0 / 0 / 0                   |
| ETH 1h      | 0              | 0 / 0 / 0                   |
| ETH 4h      | 0              | 0 / 0 / 0                   |
| SOL 15m     | 0              | 0 / 0 / 0                   |
| SOL 1h      | 0              | 0 / 0 / 0                   |
| SOL 4h      | 0              | 0 / 0 / 0                   |

## 7–9. Volume, MACD and confirmation-only rejection

MA-only count requires the named reason to be the sole adverse gate, otherwise
confirmed/fresh, and raw score plus only that rule's existing missing score weight
to reach 80. Guide-READY count additionally passes the **unchanged** Guide with
the observed zone/trigger/stop/target restored and just that single failed gate
counterfactually accepted. These are explicitly hypothetical coverage diagnostics,
not additional actual signals, new thresholds, or profitability evidence.
For confirmation, isolate previous-high/low break versus close-location; directional
candle and MA-zone break must already pass, and the other price condition must pass.

| Pair/period | Volume only MA / Guide READY | MACD only MA / Guide READY | Previous break only MA / Guide READY | Close location only MA / Guide READY |
| ----------- | ---------------------------- | -------------------------- | ------------------------------------ | ------------------------------------ |
| BTC 15m     | 0 / 0                        | 0 / 0                      | 0 / 0                                | 0 / 0                                |
| BTC 1h      | 0 / 0                        | 0 / 0                      | 0 / 0                                | 0 / 0                                |
| BTC 4h      | 0 / 0                        | 0 / 0                      | 0 / 0                                | 0 / 0                                |
| ETH 15m     | 0 / 0                        | 0 / 0                      | 0 / 0                                | 0 / 0                                |
| ETH 1h      | 0 / 0                        | 0 / 0                      | 0 / 0                                | 0 / 0                                |
| ETH 4h      | 0 / 0                        | 0 / 0                      | 0 / 0                                | 0 / 0                                |
| SOL 15m     | 0 / 0                        | 0 / 0                      | 0 / 0                                | 0 / 0                                |
| SOL 1h      | 0 / 0                        | 0 / 0                      | 0 / 0                                | 0 / 0                                |
| SOL 4h      | 0 / 0                        | 0 / 0                      | 0 / 0                                | 0 / 0                                |

Weak-volume current / preceding 20-positive-bar mean volume distribution (not the
stricter production maximum-of-three baselines). Ratios above 0.8 can still fail
because of recent pullback/explosive opposing volume. All volume/macd raw counts
and full per-series first blockers are retained in the companion JSON.

| Pair/period | weak_volume n | Min   | P25   | Median | P75   | P90   | Max   |
| ----------- | ------------- | ----- | ----- | ------ | ----- | ----- | ----- |
| BTC 15m     | 4540          | 0.088 | 0.388 | 0.557  | 0.741 | 1.091 | 3.739 |
| BTC 1h      | 1178          | 0.087 | 0.374 | 0.547  | 0.735 | 1.142 | 4.018 |
| BTC 4h      | 272           | 0.125 | 0.331 | 0.535  | 0.752 | 1.050 | 2.554 |
| ETH 15m     | 4525          | 0.066 | 0.372 | 0.539  | 0.738 | 1.060 | 8.691 |
| ETH 1h      | 1202          | 0.100 | 0.381 | 0.537  | 0.734 | 1.070 | 2.478 |
| ETH 4h      | 276           | 0.160 | 0.376 | 0.552  | 0.744 | 0.996 | 2.077 |
| SOL 15m     | 4543          | 0.066 | 0.378 | 0.535  | 0.728 | 1.011 | 4.375 |
| SOL 1h      | 1102          | 0.119 | 0.438 | 0.581  | 0.750 | 1.051 | 5.201 |
| SOL 4h      | 233           | 0.207 | 0.440 | 0.610  | 0.750 | 0.911 | 1.854 |

## 10. R:R

Only actual MA trigger bars are included. RR not reached means an earlier Guide
branch returned before a numeric ratio existed. No missing values are imputed.
Poor_rr / watch_rr counts are actual Guide outputs, not simultaneous hidden gates.
The request's final '=2.0' bucket is interpreted as **>=2.0**, with 2.0 included once.

| Pair/period | MA triggers | RR not reached | <1  | [1,1.2) | [1.2,1.5) | [1.5,2) | >=2 | Lost only poor_rr / downgraded watch_rr |
| ----------- | ----------- | -------------- | --- | ------- | --------- | ------- | --- | --------------------------------------- |
| BTC 15m     | 0           | 0              | 0   | 0       | 0         | 0       | 0   | 0 / 0                                   |
| BTC 1h      | 0           | 0              | 0   | 0       | 0         | 0       | 0   | 0 / 0                                   |
| BTC 4h      | 0           | 0              | 0   | 0       | 0         | 0       | 0   | 0 / 0                                   |
| ETH 15m     | 0           | 0              | 0   | 0       | 0         | 0       | 0   | 0 / 0                                   |
| ETH 1h      | 0           | 0              | 0   | 0       | 0         | 0       | 0   | 0 / 0                                   |
| ETH 4h      | 0           | 0              | 0   | 0       | 0         | 0       | 0   | 0 / 0                                   |
| SOL 15m     | 0           | 0              | 0   | 0       | 0         | 0       | 0   | 0 / 0                                   |
| SOL 1h      | 0           | 0              | 0   | 0       | 0         | 0       | 0   | 0 / 0                                   |
| SOL 4h      | 0           | 0              | 0   | 0       | 0         | 0       | 0   | 0 / 0                                   |

## 11. Real presentation verification

No historical READY was produced in this dataset, so there are no real READY
snapshots to present; that requested empirical rendering test is **not applicable**.
Unchanged-engine deterministic long/short test fixtures pass the real Chart/panel/
marker/tooltip path (clearly synthetic tests, not historical opportunities). This
does not prove absence of every possible UI defect; it does not establish a READY
suppression defect either.

## 12. Conclusion

**RULES TOO RESTRICTIVE — a signal-coverage diagnosis, not evidence that relaxation
would be safe, profitable, or improve prediction.** This dataset produced no MA
candidate/trigger and no LONG_READY/SHORT_READY. There were only five WATCH_LONG
bar observations (not five independent investment opportunities), and 34,015 WAIT.
No prior READY exists from which MISSED could arise in the continuous-session replay.

The absence originates in the unchanged engine before presentation. No historical
READY was suppressed by a demonstrated UI defect; the conditional historical-READY
rendering exercise has no samples. Synthetic positive controls still render both
directions through the real Chart/panel/marker/tooltip logic. This cannot rule out
every unobserved product defect or establish that markets had no economic opportunity.

At most two gates warrant **subsequent reviewed investigation**, not changes now:

1. **Three-bar recent retest:** cumulative coverage falls from 19,650 impulse bars
   to 2,208 retest bars; no_retest is emitted 21,613 times and first decisive 16,712
   times. However, the strict no_retest-only cohort is empty, so 4/5/6-bar touch
   recoveries are all zero under that denominator. This does **not** show that
   increasing the window alone would recover a valid READY setup.
2. **Structural room / target anchoring:** all 50 bars reaching the preceding
   price-confirmation + real-target stages fail room. near_obstruction appears
   26,948 times (overlapping other reasons), first decisive 880 times. Production
   selects the nearest observed opposing barrier ahead of MA, then measures room
   from the more conservative close/trigger/zone edge. That exact existing policy
   merits inspection; these counts do not select a replacement policy or threshold.

Volume-only, MACD-only and isolated confirmation-condition recovery cohorts are
all empty once the other major checks are held fixed. R:R has **no actual MA-trigger
cohort**; the absence cannot be attributed to its 1.2/1.5 thresholds from these data.
Guide no_target includes MA near_obstruction/insufficient room, not just a missing
observed target (MA no_target itself is zero). The filters overlap heavily: raw
reason counts are not additive causal contributions, and first-reason ranking
depends on the documented production precedence.

Do not conclude NO QUALIFYING MARKET OPPORTUNITIES in the economic sense, claim a
win rate, or tune on future PnL. All production algorithms/thresholds remain frozen.

## Checks and rerun

See [audit tooling instructions](../scripts/audit/README.md). Rerun with the same
frozen input to reproduce all deterministic counts (worker timings excluded).
Local verification: `pnpm web:lint`, `pnpm web:typecheck`, `pnpm web:format:check`,
`pnpm web:test` (**258 passed**), `pnpm web:build`; backend `ruff check . ../worker`,
`ruff format --check . ../worker`, `pyright --pythonpath ../../.venv/bin/python`
(0 errors), `pytest` (**89 passed**, existing Starlette deprecation warning).
Audit tools additionally pass Node syntax checks, standalone Prettier and six
focused deterministic tests. A first full GitHub Actions run passed frontend,
backend and real Compose integration; final-head CI is reported on the PR.
Local Docker is unavailable, so local Compose execution is not claimed.
No deployment, migration, provider fetch, PnL analysis or production write occurred.
