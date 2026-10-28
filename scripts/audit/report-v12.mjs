/** Derived report from completed comparison/review, no providers, rule selection or PnL. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
const [prefix] = process.argv.slice(2);
assert.ok(prefix, "OUTPUT_PREFIX produced by review-v12.mjs");
const summary = JSON.parse(readFileSync(prefix + "_SUMMARY.json"));
const episodes = JSON.parse(readFileSync(prefix + "_EPISODES.json")).episodes;
const review = JSON.parse(readFileSync(prefix + "_REVIEW.json"));
const ready = (version) =>
  summary.totals[version].LONG_READY + summary.totals[version].SHORT_READY;
const watch = (version) =>
  summary.totals[version].WATCH_LONG + summary.totals[version].WATCH_SHORT;
const table = (headers, rows) =>
  [
    "| " + headers.join(" | ") + " |",
    "| " + headers.map(() => "---").join(" | ") + " |",
    ...rows.map((r) => "| " + r.join(" | ") + " |"),
  ].join("\n");
const counts = Object.keys(summary.totals.v1);
const rows = summary.results.map((r) => [
  r.symbol,
  r.interval,
  r.n,
  ...counts.map((s) => r.counts.v12[s]),
  r.ready_episodes,
]);
const byTime = ["15m", "1h", "4h"].map((interval) => {
  const r = summary.results.filter((r) => r.interval === interval);
  return [
    interval,
    ...["LONG_READY", "SHORT_READY", "WATCH_LONG", "WATCH_SHORT"].map((s) =>
      r.reduce((n, x) => n + x.counts.v12[s], 0),
    ),
    r.reduce((n, x) => n + x.ready_long, 0),
    r.reduce((n, x) => n + x.ready_short, 0),
  ];
});
const density = Math.max(
  ...summary.results.map((r) => r.ready_episodes / (90 / 7)),
);
const positive = review.reviews.filter((r) => r.hard_gate_status === "passed");
const selected = [];
for (const dir of ["long", "short"])
  for (const tf of ["15m", "1h", "4h"]) {
    const row = positive.find((r) => r.direction === dir && r.timeframe === tf);
    if (row) selected.push(row);
  }
const sampleRows = selected.map((r) => [
  r.instrument,
  r.timeframe,
  r.timestamp,
  r.direction,
  r.entry_structure,
  r.grade,
  r.score,
  r.RR.toFixed(3),
]);
const blocks = Object.entries(
  summary.results.reduce((a, r) => {
    for (const [key, n] of Object.entries(r.rejected))
      a[key] = (a[key] ?? 0) + n;
    return a;
  }, {}),
).sort((a, b) => b[1] - a[1]);
const text = [
  "# Entry V1.2 / Guide V1.1 — frozen 90-day coverage",
  "",
  "Production/model base: `" +
    summary.production_base_sha +
    "`. Engineering main base `4ec1617` contains only the approved PR #21 audit addition. PR #22 remains excluded/unmerged/undeployed.",
  "",
  "Input SHA-256: `" + summary.input_sha256 + "`.",
  "Model-source SHA-256 (MA, evidence, Guide concatenated in runner order): `" +
    summary.model_sha256 +
    "`.",
  "",
  "Window: " +
    summary.requested_start +
    " through " +
    summary.exported_at +
    ". Exactly **34,020** closed scoring bars; BTC/ETH/SOL Bybit USDT perpetuals × 15m/1h/4h, full bounded warm-up and causal closed HTF only. No gaps, duplicate candles or future HTF injection.",
  "",
  "Acceptance guard: **" +
    summary.acceptance +
    "**. Rules were fixed before this run. No count/return fitting. Greatest distinct READY-episode density is " +
    density.toFixed(3) +
    " per week for one instrument/period; this is descriptive, not an optimal target.",
  "",
  "## V1 versus V1.2",
  "",
  table(
    ["State", "V1 bars", "V1.2 bars"],
    counts.map((s) => [s, summary.totals.v1[s], summary.totals.v12[s]]),
  ),
  "",
  "READY: " +
    ready("v1") +
    " → " +
    ready("v12") +
    " bars. WATCH: " +
    watch("v1") +
    " → " +
    watch("v12") +
    " bars. Distinct READY episodes: " +
    episodes.length +
    " (" +
    episodes.filter((e) => e.direction === "long").length +
    " long / " +
    episodes.filter((e) => e.direction === "short").length +
    " short). A repeated READY bar in the same contiguous structure/origin is not counted as a new episode.",
  "",
  table(["Instrument", "Period", "Bars", ...counts, "Episodes"], rows),
  "",
  "## Direction and period distribution",
  "",
  table(
    [
      "Period",
      "Long READY bars",
      "Short READY bars",
      "Watch long",
      "Watch short",
      "Long episodes",
      "Short episodes",
    ],
    byTime,
  ),
  "",
  summary.totals.v12.LONG_READY === 0 || summary.totals.v12.SHORT_READY === 0
    ? "**Directional asymmetry requires review:** only one READY direction occurred. Mirrored native synthetic structural/MA/breakout tests pass; no sign-specific branch/weight is used. Inspect the actual rejected cohorts below before merge; do not tune counts."
    : "Both directions appear in the frozen data. Counts need not be balanced; mirrored tests use identical rules/weights. No parameter was selected to force equal coverage.",
  "",
  "## Representative historical reconstruction",
  "",
  table(
    [
      "Instrument",
      "Period",
      "UTC close",
      "Direction",
      "Structure",
      "Grade",
      "Score",
      "R:R",
    ],
    sampleRows,
  ),
  "",
  "The companion `" +
    prefix.split("/").at(-1) +
    "_EPISODES.json` contains **every** distinct READY episode: exact UUID/period/time, origin/type, entry/stop/real TP1/TP2 and provenance, R:R, grade/points, hard status and all seven contributions (including MACD, volume and State).",
  "",
  "The companion `" +
    prefix.split("/").at(-1) +
    "_REVIEW.json` contains " +
    review.positive_count +
    " positive and " +
    review.rejected_count +
    " rejected compact records. Each includes exact source-hash/window bounds, accepted levels/Trend/State, diagnostics and reasons. Positive samples were reconstructed without future bars, compared against archived prices/grade and passed the actual TSX primary badge/arrow/tooltip/identity harness. Each also matched an actual rolling-800 Worker checkpoint/append exactly, including score, grade and complete plan. Chart/socket dependencies are mocked. This is not a deployed browser smoke.",
  "",
  "## Rejection / anti-chop diagnostics",
  "",
  table(["Gate / pending reason", "Bars (overlapping diagnostics)"], blocks),
  "",
  "Hard failures cannot be compensated by 100 evidence points. Regression tests cover repeated crosses, excess MA touches, absent structure/stop/target, stop failure, opposite confirmed reversal, severe MACD acceleration/explosive opposition, poor R:R and chase. Partial input leaves the entire score/grade/plan unchanged. Explicit bounded MISSED evidence prevents same-interaction resurrection after temporary WAIT. Growing/rolling Worker prefixes equal full replay exactly; stale UUID/period/revision results remain rejected.",
  "",
  "## Performance",
  "",
  table(
    [
      "Instrument",
      "Period",
      "Additional MA + Guide median ms",
      "p90 ms",
      "max ms",
    ],
    summary.results.map((r) => [
      r.symbol,
      r.interval,
      r.aggregation_ms.median.toFixed(3),
      r.aggregation_ms.p90.toFixed(3),
      r.aggregation_ms.max.toFixed(3),
    ]),
  ),
  "",
  "These local wall-clock samples include scheduling contention with parallel historical replay; they exclude the unchanged expensive technical engines and are not production P95. No engine rerun or Worker protocol change was introduced. The standalone synthetic benchmark commands below separately measure MA and Guide.",
  "",
  "## Reproduce",
  "",
  "```sh",
  "node --experimental-strip-types scripts/audit/coverage-v12.mjs INPUT.json /tmp/v12-coverage 3",
  "node --experimental-strip-types scripts/audit/review-v12.mjs INPUT.json /tmp/v12-coverage/comparison.json docs/TRADE_GUIDE_V12",
  "node scripts/audit/report-v12.mjs docs/TRADE_GUIDE_V12",
  "node --experimental-strip-types scripts/benchmark-ma-entry.mjs",
  "node --experimental-strip-types scripts/benchmark-trade-guide.mjs",
  "```",
  "",
  "Original V1 reports/fixtures remain immutable. The runner asserts the original V1 totals and rejects input/model hash drift. No raw provider dataset, production configuration or secret is committed.",
  "",
  "## Limits",
  "",
  "The private input is the current stored/backfilled vintage. Historical arrivals/revisions and actual browser deliveries were not archived; this is causal closed-prefix replay of that vintage, not proof of what a user saw then. Grades are uncalibrated ordinal evidence quality. R:R is price geometry before fees/slippage; no PnL, returns or win rate was computed. Coverage alone does not validate profitability. No deployment or production-trading threshold change is authorized by this report.",
  "",
].join("\n");
writeFileSync(prefix + "_COVERAGE.md", text);
console.log(
  JSON.stringify({
    bars: 34020,
    ready_bars: ready("v12"),
    episodes: episodes.length,
    peak_weekly_density: density,
  }),
);
