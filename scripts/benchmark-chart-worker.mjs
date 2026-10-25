/** Offline, reproducible comparison against the frozen reviewed production oracle.
 * Synthetic inputs; not production timing or investment-model validation.
 * node --experimental-strip-types scripts/benchmark-chart-worker.mjs
 */
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { calculateTechnicalContext as oracle } from "../apps/web/tests/fixtures/production-v1/technical-context.ts";
import { calculateTechnicalContext } from "../apps/web/src/lib/market/technical-context.ts";
import { TechnicalWorkerEngine } from "../apps/web/src/lib/market/technical-worker-engine.ts";
import {
  fixtureHistory,
  btcId,
} from "../apps/web/tests/helpers/chart-fixtures.mjs";

const source = fixtureHistory("15m", btcId, 810).items;
const candles = source.slice(0, 800),
  price = Number(candles.at(-1).close);
const request = {
  market_instrument_id: btcId,
  timeframe: "15m",
  candles,
  confirmedClose: price,
  generation: 1,
  revision: "benchmark",
};
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const before = [],
  after = [],
  incremental = [],
  prewarm = [],
  stages = [];
oracle(candles, price, "15m", undefined, btcId);
calculateTechnicalContext(candles, price, "15m", undefined, btcId);
for (let i = 0; i < 5; i++) {
  let start = performance.now();
  const expected = oracle(candles, price, "15m", undefined, btcId);
  before.push(performance.now() - start);
  start = performance.now();
  const actual = calculateTechnicalContext(
    candles,
    price,
    "15m",
    undefined,
    btcId,
    (t) => stages.push(t),
  );
  after.push(performance.now() - start);
  assert.deepEqual(actual, expected);
}
const engine = new TechnicalWorkerEngine();
engine.compute(request);
for (let i = 0; i < 8; i++) {
  const current = {
    ...request,
    candles: source.slice(i, i + 800),
    generation: i,
    confirmedClose: Number(source[i + 799].close),
  };
  let start = performance.now();
  engine.prewarm(current);
  prewarm.push(performance.now() - start);
  const next = {
    ...current,
    candles: source.slice(i + 1, i + 801),
    confirmedClose: Number(source[i + 800].close),
  };
  start = performance.now();
  const result = engine.compute(next);
  incremental.push(performance.now() - start);
  assert.equal(result.incremental, true);
  assert.deepEqual(
    result.snapshot,
    oracle(next.candles, next.confirmedClose, "15m", undefined, btcId),
  );
}
// Separate real OS worker runs the same engine. Event-loop heartbeats measure
// responsiveness during computation, not a fake synchronous worker callback.
const worker = new Worker(
  new URL("./benchmark-chart-worker-thread.mjs", import.meta.url),
  {
    execArgv: [
      "--experimental-strip-types",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
    ],
  },
);
let last = performance.now(),
  maxGap = 0;
const heartbeat = setInterval(() => {
  const now = performance.now();
  maxGap = Math.max(maxGap, now - last);
  last = now;
}, 5);
const started = performance.now();
const workerResult = await new Promise((resolve, reject) => {
  worker.once("message", resolve);
  worker.once("error", reject);
  worker.postMessage(request);
});
const roundtrip = performance.now() - started;
clearInterval(heartbeat);
await worker.terminate();
assert.deepEqual(
  workerResult.snapshot,
  oracle(candles, price, "15m", undefined, btcId),
);
console.log(
  JSON.stringify(
    {
      input:
        "synthetic 800 closed candles; Node, local host; medians of 5 full / 8 incremental samples",
      production_baseline: "1ca729c",
      before_full_ms: median(before),
      after_full_ms: median(after),
      marker_replay_ms: median(stages.map((s) => s.marker_replay_ms)),
      incremental_ms: median(incremental),
      next_origin_prewarm_ms: median(prewarm),
      worker_compute_ms: workerResult.timings.worker_compute_ms,
      worker_roundtrip_with_startup_ms: roundtrip,
      main_thread_before_block_ms: median(before),
      main_thread_during_worker_max_heartbeat_gap_ms: maxGap,
      stages: stages[2],
    },
    null,
    2,
  ),
);
