import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { states, stages } from "./replay.mjs";
import { verifyPresentation } from "./presentation.mjs";
import { compareSeries } from "./compare-v11.mjs";
import { createHash } from "node:crypto";
const [directory, input] = process.argv.slice(2);
assert.ok(directory);
const comparison = JSON.parse(readFileSync(join(directory, "comparison.json")));
const rows = comparison.series,
  keys = ["v1", "episode_only", "room_only", "v11"];
assert.equal(rows.length, 9);
const sum = (key, read) => rows.reduce((n, r) => n + read(r.results[key]), 0);
const table = (head, body) =>
  [head, head.map(() => "---"), ...body]
    .map((r) => "| " + r.join(" | ") + " |")
    .join("\n");
const label = (r) => r.symbol.replace("USDT", "") + " " + r.interval;
for (const row of rows)
  for (const key of keys) {
    const r = row.results[key];
    assert.equal(
      Object.values(r.counts).reduce((a, b) => a + b, 0),
      row.scored,
    );
    assert.equal(r.episodes.length, r.ready_episodes);
    for (const e of r.episodes) {
      const s = e.direction === "long" ? 1 : -1;
      assert.ok(s * (e.reference_entry - e.stop) > 0);
      assert.ok(s * (e.tp1 - e.reference_entry) > 0);
      assert.ok(e.rr >= 1.5);
      if (key === "v11") {
        assert.ok(e.retest_age >= 0 && e.retest_age <= 3);
        assert.ok(e.structural_room_atr >= 0.9);
        assert.ok(
          !e.ma_reasons.some((reason) =>
            [
              "flat_ma",
              "trend_conflict",
              "repeated_crosses",
              "excess_retests",
              "no_impulse",
              "no_retest",
              "near_obstruction",
              "no_target",
              "weak_confirmation",
              "weak_volume",
              "missing_volume",
              "macd_conflict",
              "macd_unready",
              "overextended",
              "level_failed",
            ].includes(reason),
          ),
        );
      }
    }
  }
const episodes = rows
  .flatMap((r) => r.results.v11.episodes)
  .sort(
    (a, b) =>
      a.timestamp.localeCompare(b.timestamp) ||
      a.instrument.localeCompare(b.instrument) ||
      a.timeframe.localeCompare(b.timeframe),
  );
const attribution = {
  episode_only: 0,
  room_only: 0,
  combination_required: 0,
  either_independently: 0,
  already_v1: 0,
};
if (episodes.length) {
  assert.ok(
    input,
    "Frozen input required for exact same-candle READY attribution",
  );
  const bytes = readFileSync(input),
    data = JSON.parse(bytes);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    comparison.input_sha256,
  );
  for (const e of episodes) {
    const primary = data.series.find(
      (s) => s.id === e.market_instrument_id && s.interval === e.timeframe,
    );
    const higher = data.series.find(
      (s) =>
        s.id === e.market_instrument_id &&
        s.interval === { "15m": "1h", "1h": "4h", "4h": "1d" }[e.timeframe],
    );
    const time = Date.parse(e.timestamp),
      series = {
        ...primary,
        candles: primary.candles.filter(
          (c) => Date.parse(c.close_time) <= time,
        ),
      };
    // Re-evaluate only this confirmation and its bounded cursor warm-up, never
    // infer same-candle causality from a different variant's episode-start count.
    const check = compareSeries(
      series,
      higher,
      time,
      Date.parse(comparison.end),
    );
    assert.equal(check.scored, 1);
    const state = (key) =>
      Object.entries(check.results[key].counts).find(([, n]) => n === 1)[0];
    e.ablation_at_confirmation = Object.fromEntries(
      keys.map((k) => [k, state(k)]),
    );
    assert.equal(
      state("v11"),
      e.direction === "long" ? "LONG_READY" : "SHORT_READY",
    );
    const ready = (k) =>
      state(k) === "LONG_READY" || state(k) === "SHORT_READY";
    e.recovered_by = ready("v1")
      ? "already_v1"
      : ready("episode_only") && ready("room_only")
        ? "either_independently"
        : ready("episode_only")
          ? "episode_only"
          : ready("room_only")
            ? "room_only"
            : "combination_required";
    attribution[e.recovered_by]++;
  }
}
const allSamples = rows.flatMap(
  (r) =>
    JSON.parse(
      readFileSync(join(directory, r.symbol + "-" + r.interval + ".json")),
    ).results.v11.samples,
);
allSamples.sort(
  (a, b) =>
    a.guide.confirmed_at.localeCompare(b.guide.confirmed_at) ||
    a.guide.market_instrument_id.localeCompare(b.guide.market_instrument_id) ||
    a.guide.timeframe.localeCompare(b.guide.timeframe),
);
const picked = [],
  groups = new Set();
for (const s of allSamples) {
  const key =
    s.guide.market_instrument_id +
    ":" +
    s.guide.timeframe +
    ":" +
    s.guide.direction;
  if (!groups.has(key)) {
    picked.push(s);
    groups.add(key);
  }
}
for (const s of allSamples)
  if (picked.length < 20 && !picked.includes(s)) picked.push(s);
const selected = picked.slice(0, 20),
  rendered = selected.map(verifyPresentation);
const representative = selected.map((s) =>
  episodes.find(
    (e) =>
      e.market_instrument_id === s.guide.market_instrument_id &&
      e.timeframe === s.guide.timeframe &&
      e.timestamp === s.guide.confirmed_at,
  ),
);
assert.ok(representative.every(Boolean));
writeFileSync(
  "docs/MA_ENTRY_V11_READY_EPISODES.json",
  JSON.stringify(
    {
      input_sha256: comparison.input_sha256,
      selection:
        "Every V1.1 READY episode start; no PnL fields; derived context only",
      episodes,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  "docs/MA_ENTRY_V11_REPRESENTATIVE.json",
  JSON.stringify(
    {
      selection:
        "First available per instrument/timeframe/direction, then chronological fill; maximum 20; no outcome-based selection",
      examples: representative,
      presentation: rendered,
    },
    null,
    2,
  ) + "\n",
);
const publicComparison = structuredClone(comparison);
for (const row of publicComparison.series)
  for (const key of keys.filter((k) => k !== "v11"))
    row.results[key].episodes = row.results[key].episodes.map((e) => ({
      instrument: e.instrument,
      market_instrument_id: e.market_instrument_id,
      timeframe: e.timeframe,
      timestamp: e.timestamp,
      direction: e.direction,
    }));
writeFileSync(
  "docs/MA_ENTRY_V11_COMPARISON.json",
  JSON.stringify(publicComparison, null, 2) + "\n",
);
const totalReady = sum(
  "v11",
  (r) => r.counts.LONG_READY + r.counts.SHORT_READY,
);
const frequency = table(
  ["Pair/period", "Version", ...states],
  rows.flatMap((r) =>
    ["v1", "v11"].map((k) => [
      label(r),
      k,
      ...states.map((s) => r.results[k].counts[s]),
    ]),
  ),
);
const ablation = table(
  [
    "Pair/period",
    "V1 READY L/S",
    "Episode only L/S",
    "Room only L/S",
    "V1.1 L/S",
  ],
  rows.map((r) => [
    label(r),
    ...keys.map(
      (k) =>
        `${r.results[k].counts.LONG_READY}/${r.results[k].counts.SHORT_READY}`,
    ),
  ]),
);
const funnel = table(
  ["Gate", ...rows.map(label), "Total"],
  stages.map((s) => [
    s,
    ...rows.map(
      (r) => `${r.results.v1.funnel[s]} → ${r.results.v11.funnel[s]}`,
    ),
    `${sum("v1", (r) => r.funnel[s])} → ${sum("v11", (r) => r.funnel[s])}`,
  ]),
);
const modes = table(
  ["Gate", ...keys],
  stages.map((s) => [s, ...keys.map((k) => sum(k, (r) => r.funnel[s]))]),
);
const distribution = table(
  ["Timeframe", "LONG_READY bars", "SHORT_READY bars", "READY episode starts"],
  ["15m", "1h", "4h"].map((tf) => [
    tf,
    ...["LONG_READY", "SHORT_READY"].map((s) =>
      rows
        .filter((r) => r.interval === tf)
        .reduce((a, r) => a + r.results.v11.counts[s], 0),
    ),
    rows
      .filter((r) => r.interval === tf)
      .reduce((a, r) => a + r.results.v11.ready_episodes, 0),
  ]),
);
const sampleTable = table(
  [
    "Instrument",
    "Period",
    "Confirmed UTC",
    "Direction",
    "MA",
    "Entry",
    "Stop",
    "TP1",
    "TP2",
    "RR",
    "Retest age",
    "Room ATR",
  ],
  representative.map((e) => [
    e.instrument,
    e.timeframe,
    e.timestamp,
    e.direction,
    e.ma.toFixed(4),
    e.reference_entry.toFixed(4),
    e.stop.toFixed(4),
    e.tp1.toFixed(4),
    e.tp2?.toFixed(4) ?? "—",
    e.rr.toFixed(3),
    e.retest_age,
    e.structural_room_atr.toFixed(3),
  ]),
);
const text = `# MA Confluence Entry V1.1 — frozen-input coverage comparison

## Scope and provenance

Base main (audit PR #21 squash): \`${comparison.base_main}\`. No deployment.
MA version: \`ma-confluence-entry-v1.1\`; Trade Guide remains \`trade-guide-v1\`.
Frozen input SHA-256: \`${comparison.input_sha256}\` (identical to the V1 audit).
Scoring: ${comparison.start} through ${comparison.end}; BTC/ETH/SOL × 15m/1h/4h,
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

${frequency}

## Attribution ablation (READY closed-bar observations)

${ablation}

Modes are diagnostic, fixed in advance, not parameter searches. Differences are
not additive causal/PnL contributions; the gates interact. Exact same-confirmation
attribution for V1.1 episode starts: ${JSON.stringify(attribution)}.
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

${funnel}

## Aggregate four-mode funnel

${modes}

## READY examples and distribution

V1.1 READY bars: **${totalReady}**; episode starts / compact snapshots: **${episodes.length}**.
LONG bars: ${sum("v11", (r) => r.counts.LONG_READY)}; SHORT bars: ${sum("v11", (r) => r.counts.SHORT_READY)}.
Episode starts count a new READY direction or transition from non-READY, not every
repeated READY observation. All starts are exported in
[compact records](MA_ENTRY_V11_READY_EPISODES.json), never raw provider candle sets.

${distribution}

${
  representative.length
    ? `The following ${representative.length} examples are selected without looking at future
outcomes. First available per pair/period/direction, then fill up to 20. Each passed
the real Chart/panel/Guide-marker/click-tooltip and stale-identity rendering guards
with external canvas/socket mocks only. They are historical replay examples, not
claims that a real historical browser saw them or that an order could execute.

${sampleTable}

[Full representative context fields and rendering checks](MA_ENTRY_V11_REPRESENTATIVE.json).
Manual qualitative review is requested, not substituted with automated profitability claims.`
    : `No READY exists, so there are no qualifying historical examples to fabricate or
present. Positive/negative synthetic regression fixtures remain explicitly test-only.`
}

## Acceptance answers

1. Any READY? **${totalReady ? "YES" : "NO"}**, ${totalReady} bars, ${episodes.length} episode starts.
2. Which change recovered it? Fixed ablations and exact same-confirmation attribution above.
3. Both directions? Long ${sum("v11", (r) => r.counts.LONG_READY)}, short ${sum("v11", (r) => r.counts.SHORT_READY)}.
4. Timeframes? Exact distribution above; missing cohorts remain unavailable.
5. Anti-chop? Existing bad-pattern fixtures remain required and unmodified.
6. R:R/stop rule changed? **NO** — values/formulas remain frozen; retest membership
   and target/anchor semantics are the two explicitly authorized changes.

${totalReady ? "No profitability/return/win-rate inference follows. No subsequent gate tuning is authorized." : "**STOP: corrected semantics still yield zero READY. No additional gates are loosened.**"}

## Verification

Pending final normal lint/format/type/test/build and frontend/backend/Compose CI.
No deployment or automatic merge is authorized.
`;
writeFileSync("docs/MA_ENTRY_V11_COVERAGE.md", text);
console.log(
  JSON.stringify({
    totalReady,
    episodes: episodes.length,
    representative: representative.length,
  }),
);
