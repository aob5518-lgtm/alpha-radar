import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  states,
  stages,
  maBlockers,
  guideBlockers,
  validateSeries,
} from "./replay.mjs";
import { verifyPresentation } from "./presentation.mjs";
const [directory, output, input, summaryOutput] = process.argv.slice(2);
assert.ok(directory && output, "Usage: report.mjs OUTPUT_DIR REPORT.md");
const audit = JSON.parse(readFileSync(join(directory, "summary.json"))),
  rows = audit.results;
assert.equal(rows.length, 9, "Expected all nine pair/timeframe runs");
for (const r of rows) {
  assert.equal(
    Object.values(r.counts).reduce((a, b) => a + b, 0),
    r.n,
  );
  assert.equal(
    Object.values(r.rr).reduce((a, b) => a + b, 0) + r.rrMissing,
    r.maTriggers,
  );
  assert.equal(r.funnel["final READY"], r.ready_bars);
  assert.equal(
    Object.values(r.guideFirst).reduce((a, b) => a + b, 0),
    r.n - r.ready_bars,
  );
  assert.ok(
    r.retest[4] <= r.retest[5] &&
      r.retest[5] <= r.retest[6] &&
      r.retest[6] <= r.only.no_retest,
  );
  for (let i = 1; i < stages.length; i++)
    assert.ok(
      r.funnel[stages[i]] <= r.funnel[stages[i - 1]],
      "Non-cumulative funnel",
    );
}
if (input) {
  const bytes = readFileSync(input),
    data = JSON.parse(bytes);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    audit.input_sha256,
  );
  audit.input_series = data.series.map((s) => ({
    symbol: s.symbol,
    id: s.id,
    interval: s.interval,
    count: s.candles.length,
    first: s.candles[0]?.open_time,
    last: s.candles.at(-1)?.close_time,
    gaps: validateSeries(s, Date.parse(data.exported_at)),
  }));
  writeFileSync(
    join(directory, "summary.json"),
    JSON.stringify(audit, null, 2) + "\n",
  );
}
const sum = (fn) => rows.reduce((a, r) => a + fn(r), 0);
const table = (heads, body) =>
  [heads, heads.map(() => "---"), ...body]
    .map((row) => "| " + row.join(" | ") + " |")
    .join("\n");
const label = (r) => r.symbol.replace("USDT", "") + " " + r.interval;
const fmt = (n) =>
  n === null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(3);
const grouped = (name, keys) =>
  table(
    ["Gate", ...rows.map(label), "Total"],
    keys.map((k) => [
      k,
      ...rows.map((r) => r[name][k]),
      sum((r) => r[name][k]),
    ]),
  );
const allSamples = rows.flatMap(
  (r) =>
    JSON.parse(
      readFileSync(join(directory, r.symbol + "-" + r.interval + ".json")),
    ).samples,
);
const ui = allSamples.map(verifyPresentation);
if (summaryOutput)
  writeFileSync(
    summaryOutput,
    JSON.stringify({ ...audit, presentation: ui }, null, 2) + "\n",
  );
writeFileSync(
  join(directory, "presentation.json"),
  JSON.stringify(ui, null, 2) + "\n",
);
const stateTable = table(
  [
    "Pair/period",
    "Bars",
    ...states,
    "READY episodes / day / week",
    "Median bars between",
  ],
  rows.map((r) => [
    label(r),
    r.n,
    ...states.map(
      (s) => `${r.counts[s]} (${((100 * r.counts[s]) / r.n).toFixed(3)}%)`,
    ),
    `${r.ready_episodes} / ${fmt(r.signals_per_day)} / ${fmt(r.signals_per_week)}`,
    fmt(r.median_candles_between_ready),
  ]),
);
const blockerTable = (raw, first, keys) =>
  table(
    ["Reason", "Raw output occurrences", "First decisive"],
    [...keys]
      .sort((a, b) => sum((r) => r[first][b]) - sum((r) => r[first][a]))
      .map((k) => [k, sum((r) => r[raw][k]), sum((r) => r[first][k])]),
  );
const coverage = table(
  [
    "Pair/period",
    "First close → last close (UTC)",
    "Scored bars",
    "Primary warm-up",
    "Missing bars / gaps",
    "Stale/missing HTF evaluations",
  ],
  rows.map((r) => [
    label(r),
    `${r.firstTime} → ${r.lastTime}`,
    r.n,
    r.warmup_bars,
    `${r.gaps.reduce((n, g) => n + g.missing, 0)} / ${r.gaps.length}`,
    r.htfMissing,
  ]),
);
const retest = table(
  ["Pair/period", "Only no_retest", "Touch within 4 / 5 / 6 bars"],
  rows.map((r) => [
    label(r),
    r.only.no_retest,
    `${r.retest[4]} / ${r.retest[5]} / ${r.retest[6]}`,
  ]),
);
const only = table(
  [
    "Pair/period",
    "Volume only MA / Guide READY",
    "MACD only MA / Guide READY",
    "Previous break only MA / Guide READY",
    "Close location only MA / Guide READY",
  ],
  rows.map((r) => [
    label(r),
    ...["volume", "macd", "previous_break", "close_location"].map(
      (k) => `${r.only[k]} / ${r.counterReady[k]}`,
    ),
  ]),
);
const volume = table(
  ["Pair/period", "weak_volume n", "Min", "P25", "Median", "P75", "P90", "Max"],
  rows.map((r) => [
    label(r),
    r.volume.n,
    ...["min", "p25", "median", "p75", "p90", "max"].map((k) =>
      fmt(r.volume[k]),
    ),
  ]),
);
const rr = table(
  [
    "Pair/period",
    "MA triggers",
    "RR not reached",
    "<1",
    "[1,1.2)",
    "[1.2,1.5)",
    "[1.5,2)",
    ">=2",
    "Lost only poor_rr / downgraded watch_rr",
  ],
  rows.map((r) => [
    label(r),
    r.maTriggers,
    r.rrMissing,
    ...Object.values(r.rr),
    `${r.rrLost} / ${r.rrDowngraded}`,
  ]),
);
const firstRanking = [...maBlockers].sort(
  (a, b) => sum((r) => r.maFirst[b]) - sum((r) => r.maFirst[a]),
);
const report = `# Trade Guide signal-coverage audit

## 1. Dataset and reproducibility

Base / deployed algorithms: \`${audit.base_sha}\`; default **enabled SMA99**, unchanged
\`ma-confluence-entry-v1\` and \`trade-guide-v1\`. Exported read-only from canonical
stored **Bybit USDT perpetual** candles at **${audit.exported_at}**.
Requested scoring start: **${audit.requested_start}** (90 days).
Frozen input SHA-256: \`${audit.input_sha256}\`.
The frozen input and full per-series snapshots remain local operational artifacts,
not redistributed provider candle data. The [companion JSON](TRADE_GUIDE_SIGNAL_AUDIT.json)
contains counts/metadata and derived rendering-verification results only.

${coverage}

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
stream delivery are not fully archived. ${sum((r) => r.late_ingested_candles)} exported
primary candles have ingestion timestamps more than one interval after close
(includes warm-up). These cannot establish contemporaneous availability. No PnL,
win rate, executable fill, future return or optimal threshold is evaluated.

## 2. Continuity

${sum((r) => r.gaps.length)} primary continuity gaps were found. Gaps, if present, are
retained and listed in the companion JSON; never interpolated or silently fabricated.
Rows with invalid OHLC/volume, duplicate times, wrong UUID/provider, partial status or
future close fail the audit. Timing respects stored close boundaries (inclusive
millisecond closes are accepted). Missing external data is not invented.
All exported primary/higher series gap counts: ${audit.input_series?.map((s) => `${s.symbol}/${s.interval}: ${s.gaps.length}`).join("; ") ?? "see input validation"}.

## 3. Primary state frequency

${stateTable}

Total scored bars: **${sum((r) => r.n)}**. READY bars: **${sum((r) => r.ready_bars)}**;
independent READY episode starts: **${sum((r) => r.ready_episodes)}**.
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

${grouped("funnel", stages)}

An adverse MA gate caps the production score at 64. Zero passes at score 65/80
can therefore be a consequence of earlier gates, not evidence that score thresholds
are the root cause. Likewise, a zero numeric R:R cohort means R:R was not reached,
not that changing the R:R threshold would recover those bars.

Directional episodes = contiguous non-none MA directional bias, reset on direction
change/none. Below, each episode counts once for the furthest cumulative same-bar
stage attained by any of its bars; gates are not assembled across different bars.

${grouped("episodes", stages)}

## 5. Blocker ranking

MA raw counts are the exact emitted adverse reason codes (including simultaneous
reasons); first decisive is their **actual production insertion order**, not this
report's table ordering. A closed level failure returns early with only level_failed.
Weak confirmation is decisive for trigger promotion even when a candidate survives.

${blockerTable("maRaw", "maFirst", maBlockers)}

Guide deliberately returns one reason at its first blocking branch. Thus raw and
first-decisive counts coincide; unvisited downstream gates are **not** claimed to
have passed or failed. A zero poor_rr can mean no setup reached R:R evaluation.

${blockerTable("guideRaw", "guideFirst", guideBlockers)}

## 6. Retest-window audit

Strict denominator: the **only** emitted MA adverse reason is no_retest. Check for
an actual historical touch in trailing 4/5/6 bars, after the unchanged original
impulse, against its contemporary MA/ATR zone. Nested windows overlap. This is
coverage only: do not recalculate the impulse, stop, score or predict READY under a
different model; no production retestLookback was changed.

${retest}

## 7–9. Volume, MACD and confirmation-only rejection

MA-only count requires the named reason to be the sole adverse gate, otherwise
confirmed/fresh, and raw score plus only that rule's existing missing score weight
to reach 80. Guide-READY count additionally passes the **unchanged** Guide with
the observed zone/trigger/stop/target restored and just that single failed gate
counterfactually accepted. These are explicitly hypothetical coverage diagnostics,
not additional actual signals, new thresholds, or profitability evidence.
For confirmation, isolate previous-high/low break versus close-location; directional
candle and MA-zone break must already pass, and the other price condition must pass.

${only}

Weak-volume current / preceding 20-positive-bar mean volume distribution (not the
stricter production maximum-of-three baselines). Ratios above 0.8 can still fail
because of recent pullback/explosive opposing volume. All volume/macd raw counts
and full per-series first blockers are retained in the companion JSON.

${volume}

## 10. R:R

Only actual MA trigger bars are included. RR not reached means an earlier Guide
branch returned before a numeric ratio existed. No missing values are imputed.
Poor_rr / watch_rr counts are actual Guide outputs, not simultaneous hidden gates.
The request's final '=2.0' bucket is interpreted as **>=2.0**, with 2.0 included once.

${rr}

## 11. Real presentation verification

${
  ui.length
    ? `${ui.length} historical READY snapshots passed the actual StructuralMarketChart and
TradeGuidePanel TSX path, using canvas/socket test doubles only. Verified Chinese
primary label, exact identity, Guide marker, click tooltip and stale-identity guard.
No market values or states were fabricated for those snapshots.

${table(
  ["Pair/period", "Confirmed UTC", "State", "Marker", "Stop", "TP1", "RR"],
  ui.map((u) => [
    u.symbol + "/" + u.interval,
    u.confirmed_at,
    u.state,
    u.marker,
    fmt(u.stop),
    fmt(u.tp1),
    fmt(u.rr),
  ]),
)}`
    : `No historical READY was produced in this dataset, so there are no real READY
snapshots to present; that requested empirical rendering test is **not applicable**.
Unchanged-engine deterministic long/short test fixtures pass the real Chart/panel/
marker/tooltip path (clearly synthetic tests, not historical opportunities). This
does not prove absence of every possible UI defect; it does not establish a READY
suppression defect either.`
}

## 12. Conclusion

Pending final interpretation after reviewing the aggregate coverage results.
First-decisive ranking begins: ${firstRanking.slice(0, 3).join(", ")}.
Do not interpret a rare heuristic trigger as a calibrated investment opportunity.
No rule is changed or optimized by this audit.

## Checks and rerun

See [audit tooling instructions](../scripts/audit/README.md). Rerun with the same
frozen input to reproduce all deterministic counts (worker timings excluded).
Normal frontend/backend/integration CI remains required; no deployment is authorized.
`;
writeFileSync(output, report);
console.log(
  JSON.stringify({
    report: output,
    historical_ready_rendered: ui.length,
    total_bars: sum((r) => r.n),
    ready_bars: sum((r) => r.ready_bars),
    firstRanking,
  }),
);
