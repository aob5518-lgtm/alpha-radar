/** Same frozen PR21 input; closed-prefix causal comparison, never future-return fitting.
 * node --experimental-strip-types scripts/audit/coverage-v12.mjs INPUT OUTPUT [workers=3]
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from "node:worker_threads";
import { join } from "node:path";
import { calculateTechnicalContext } from "../../apps/web/src/lib/market/technical-context.ts";
import { calculateTradeSetup } from "../../apps/web/src/lib/market/trade-setup.ts";
import { calculateMaEntry } from "../../apps/web/src/lib/market/ma-confluence-entry.ts";
import {
  calculateTradeGuide,
  guideReady,
  retainGuideEvidence,
} from "../../apps/web/src/lib/market/trade-guide.ts";
import { calculateMaEntry as v1Ma } from "../../apps/web/tests/fixtures/ma-entry-v1/ma-confluence-entry.ts";
import { calculateTradeGuide as v1Guide } from "../../apps/web/tests/fixtures/ma-entry-v1/trade-guide.ts";
import {
  higherMarketInterval,
  intervalSeconds,
} from "../../apps/web/src/lib/market/intervals.ts";
import { validateSeries, higherAt, states, distribution } from "./replay.mjs";
const count = () => Object.fromEntries(states.map((s) => [s, 0]));
const modelFiles = [
  "ma-confluence-entry.ts",
  "entry-evidence.ts",
  "trade-guide.ts",
];
const modelHash = () =>
  createHash("sha256")
    .update(
      modelFiles
        .map((file) =>
          readFileSync(
            new URL("../../apps/web/src/lib/market/" + file, import.meta.url),
            "utf8",
          ),
        )
        .join("\n"),
    )
    .digest("hex");
export function coverage(series, higher, start, end, progress = () => {}) {
  const gaps = validateSeries(series, end),
    higherGaps = validateSeries(higher, end);
  assert.equal(gaps.length, 0);
  assert.equal(higherGaps.length, 0);
  const counts = { v1: count(), v12: count() },
    rejected = {},
    episodes = [],
    examples = [],
    timing = [];
  let prior,
    oldPrior,
    lastReady = "",
    n = 0,
    htfMissing = 0;
  for (let i = 249; i < series.candles.length; i++) {
    const bar = series.candles[i],
      time = Date.parse(bar.close_time);
    if (time < start - 3 * intervalSeconds[series.interval] * 1000) continue;
    const candles = series.candles.slice(Math.max(0, i - 799), i + 1);
    const htf = higherAt(higher.candles, time, higher.interval);
    if (!htf) htfMissing++;
    const snapshot = calculateTechnicalContext(
      candles,
      Number(bar.close),
      series.interval,
      htf,
      series.id,
    );
    const setup = calculateTradeSetup(snapshot, series.id, series.interval);
    const old = v1Ma(snapshot, series.id, series.interval);
    const baseline = v1Guide(
      snapshot,
      old,
      setup,
      series.id,
      series.interval,
      oldPrior,
    );
    if (guideReady(baseline)) oldPrior = baseline;
    else if (baseline.state === "WAIT") oldPrior = undefined;
    const before = performance.now();
    const ma = calculateMaEntry(snapshot, series.id, series.interval);
    const guide = calculateTradeGuide(
      snapshot,
      ma,
      setup,
      series.id,
      series.interval,
      prior,
    );
    const elapsed = performance.now() - before;
    prior = retainGuideEvidence(prior, guide);
    if (time < start) continue;
    timing.push(elapsed);
    counts.v1[baseline.state]++;
    counts.v12[guide.state]++;
    n++;
    const failures = guide.hard_failures.length
      ? guide.hard_failures
      : guide.reason_codes;
    if (!guideReady(guide))
      for (const f of failures) rejected[f] = (rejected[f] ?? 0) + 1;
    const key = guideReady(guide)
      ? guide.direction +
        ":" +
        guide.entry_structure +
        ":" +
        guide.structure_origin
      : "";
    const record = {
      instrument: series.symbol,
      market_instrument_id: series.id,
      timeframe: series.interval,
      timestamp: guide.confirmed_at,
      state: guide.state,
      direction: guide.direction,
      entry_structure: guide.entry_structure,
      structure_origin: guide.structure_origin,
      entry_zone: [guide.entry_zone_low, guide.entry_zone_high],
      entry: guide.reference_entry_price,
      stop: guide.stop_price,
      TP1: guide.tp1_price,
      TP1_source: guide.tp1_source,
      TP2: guide.tp2_price,
      TP2_source: guide.tp2_source,
      RR: guide.reward_risk_tp1,
      grade: guide.quality_grade,
      score: guide.evidence_score,
      hard_gate_status: guide.hard_failures.length ? "rejected" : "passed",
      hard_failures: guide.hard_failures,
      evidence: guide.evidence,
    };
    const example = () => ({
      ...record,
      reasons: guide.reason_codes,
      ma_failures: ma.hard_failures,
      window: {
        start: candles[0].open_time,
        end: bar.close_time,
        count: candles.length,
        higher_end: htf?.at(-1)?.close_time ?? null,
      },
      trend: snapshot.trend,
      state_context: snapshot.state,
      supports: snapshot.supports,
      resistances: snapshot.resistances,
      ma: {
        value: ma.ma_value,
        slope: ma.ma_slope,
        histogram: ma.diagnostics.histogram,
        volume_ratio: ma.diagnostics.volume_ratio,
      },
    });
    if (key && key !== lastReady) {
      episodes.push(record);
      if (examples.filter((e) => e.hard_gate_status === "passed").length < 20)
        examples.push(example());
    }
    if (
      !key &&
      examples.filter((e) => e.hard_gate_status === "rejected").length < 6 &&
      !examples.some((e) => e.hard_failures[0] === guide.hard_failures[0])
    )
      examples.push(example());
    lastReady = key;
    if (n % 1000 === 0)
      progress({
        symbol: series.symbol,
        interval: series.interval,
        n,
        ready: counts.v12.LONG_READY + counts.v12.SHORT_READY,
      });
  }
  return {
    symbol: series.symbol,
    interval: series.interval,
    n,
    counts,
    episodes,
    examples,
    rejected,
    htfMissing,
    gaps,
    higherGaps,
    aggregation_ms: distribution(timing),
  };
}
if (!isMainThread) {
  const { series, higher, start, end, sourceHash } = workerData;
  assert.equal(modelHash(), sourceHash, "Model changed during audit");
  parentPort.postMessage({
    result: coverage(series, higher, start, end, (p) =>
      parentPort.postMessage({ progress: p }),
    ),
  });
} else if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [input, directory, parallel = "3"] = process.argv.slice(2);
  assert.ok(input && directory, "INPUT OUTPUT [workers=3]");
  const bytes = readFileSync(input),
    data = JSON.parse(bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(
    hash,
    "ab818b5c304848215f2f82daf4e827b89f4e05f1718c389c6158e0dba4f3d150",
  );
  assert.equal(data.base_sha, "69a74425e68157ef634a723309d665b3996d9509");
  const sourceHash = modelHash();
  const start = Date.parse(data.requested_start),
    end = Date.parse(data.exported_at),
    queue = [];
  for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT"])
    for (const interval of ["15m", "1h", "4h"]) {
      const series = data.series.find(
        (s) => s.symbol === symbol && s.interval === interval,
      );
      const higher = data.series.find(
        (s) =>
          s.symbol === symbol && s.interval === higherMarketInterval[interval],
      );
      assert.ok(series && higher);
      queue.push({ series, higher, start, end, sourceHash });
    }
  const results = [];
  mkdirSync(directory, { recursive: true });
  async function consume() {
    while (queue.length) {
      const task = queue.shift(),
        key = task.series.symbol + "-" + task.series.interval;
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL(import.meta.url), {
          workerData: task,
        });
        let received = false;
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code || !received) reject(new Error(key + " exited " + code));
        });
        worker.on("message", (m) => {
          if (m.progress) console.log(JSON.stringify(m.progress));
          else {
            received = true;
            resolve(m.result);
          }
        });
      });
      writeFileSync(
        join(directory, key + ".json"),
        JSON.stringify(result, null, 2) + "\n",
      );
      results.push(result);
      console.log(JSON.stringify({ completed: key, counts: result.counts }));
    }
  }
  assert.ok(Number(parallel) >= 1 && Number(parallel) <= 4);
  await Promise.all(Array.from({ length: Number(parallel) }, consume));
  results.sort((a, b) =>
    (a.symbol + a.interval).localeCompare(b.symbol + b.interval),
  );
  const totals = { v1: count(), v12: count() };
  for (const r of results)
    for (const version of ["v1", "v12"])
      for (const s of states) totals[version][s] += r.counts[version][s];
  assert.equal(
    results.reduce((sum, r) => sum + r.n, 0),
    34020,
  );
  const frozen = JSON.parse(
    readFileSync(
      new URL("../../docs/TRADE_GUIDE_SIGNAL_AUDIT.json", import.meta.url),
    ),
  );
  // Original report remains immutable. Assert its cohort total independently below.
  assert.ok(frozen);
  assert.deepEqual(totals.v1, {
    LONG_READY: 0,
    SHORT_READY: 0,
    WATCH_LONG: 5,
    WATCH_SHORT: 0,
    WAIT: 34015,
    MISSED: 0,
  });
  const ready = totals.v12.LONG_READY + totals.v12.SHORT_READY;
  const excessive = results.some((r) => r.episodes.length / (90 / 7) >= 100);
  assert.equal(modelHash(), sourceHash, "Model changed during audit");
  const summary = {
    format: "alpha-radar-v12-coverage-v1",
    production_base_sha: data.base_sha,
    input_sha256: hash,
    model_sha256: sourceHash,
    requested_start: data.requested_start,
    exported_at: data.exported_at,
    totals,
    acceptance:
      ready === 0
        ? "STOP_ZERO_READY"
        : excessive
          ? "STOP_EXCESSIVE_READY"
          : "nonzero_selective_review_required",
    results,
  };
  writeFileSync(
    join(directory, "comparison.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({ done: directory, totals, acceptance: summary.acceptance }),
  );
}
