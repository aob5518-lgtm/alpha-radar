/** Read-only diagnostic: no provider requests, credentials, or production writes.
 * Run with Node 22+ --experimental-strip-types. Optional CHART_API_URL uses the
 * canonical DB API; otherwise clearly synthetic deterministic fixtures are used.
 * CHART_BASELINE_ROOT may point to a git-archived b55e918 source tree with its
 * apps/web/node_modules linked to the existing workspace dependencies.
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { calculateTechnicalContext } from "../apps/web/src/lib/market/technical-context.ts";
import { ChartContextStore } from "../apps/web/src/lib/market/chart-context-store.ts";
import {
  btcId,
  fixtureHistory,
} from "../apps/web/tests/helpers/chart-fixtures.mjs";

const baselineRoot = process.env.CHART_BASELINE_ROOT;
const baseline = baselineRoot
  ? (
      await import(
        pathToFileURL(
          `${baselineRoot}/apps/web/src/lib/market/technical-context.ts`,
        )
      )
    ).calculateTechnicalContext
  : calculateTechnicalContext;
const api = process.env.CHART_API_URL;
const fetchTimings = [];
const histories = new Map(
  await Promise.all(
    ["15m", "1h", "4h"].map(async (interval) => {
      if (!api) return [interval, fixtureHistory(interval, btcId, 800)];
      const start = performance.now();
      const response = await fetch(
        `${api}/api/v1/market-instruments/${btcId}/history?interval=${interval}&limit=800`,
      );
      assert.equal(response.status, 200);
      const history = await response.json();
      fetchTimings.push(performance.now() - start);
      return [interval, history];
    }),
  ),
);
const history = histories.get("15m"),
  higher = histories.get("1h");
const price = Number(history.items.filter((c) => c.is_closed).at(-1).close);
baseline(history.items, price, "15m", higher.items, btcId); // JIT warm-up, not measured.
calculateTechnicalContext(history.items, price, "15m", higher.items, btcId);
const before = [],
  after = [],
  stages = [];
for (let i = 0; i < 5; i++) {
  let start = performance.now();
  const old = baseline(history.items, price, "15m", higher.items, btcId);
  before.push(performance.now() - start);
  start = performance.now();
  const current = calculateTechnicalContext(
    history.items,
    price,
    "15m",
    higher.items,
    btcId,
    (timing) => stages.push(timing),
  );
  after.push(performance.now() - start);
  assert.deepEqual(current, old); // Exact frozen algorithms, not just similar scores.
}
let fetches = 0;
const now = Date.parse(
  history.items.filter((c) => c.is_closed).at(-1).close_time,
);
const store = new ChartContextStore(
  async (id, interval) => {
    fetches++;
    return histories.get(interval);
  },
  () => now,
);
await store.load(btcId, "15m");
await store.load(btcId, "1h");
const beforeFetches = fetches,
  cached = [];
for (let i = 0; i < 10; i++) {
  const start = performance.now();
  await store.load(btcId, i % 2 ? "15m" : "1h");
  cached.push(performance.now() - start);
}
assert.equal(fetches, beforeFetches);
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const report = {
  input: api
    ? "read-only canonical production history"
    : "synthetic deterministic fixture",
  baseline_root:
    baselineRoot ?? "current engine (no historical baseline provided)",
  candles: history.items.length,
  history_fetch_ms: median(fetchTimings),
  before_total_technical_context_ms: median(before),
  after_total_technical_context_ms: median(after),
  after_stages: Object.fromEntries(
    Object.keys(stages[0]).map((key) => [
      key,
      median(stages.map((t) => t[key])),
    ]),
  ),
  cached_context_switch_ms: median(cached),
  cached_switch_history_requests: fetches - beforeFetches,
  algorithm_parity: "exact",
  note: "Cache timing is local context readiness, not browser paint. marker_replay_ms includes constituent engine work; do not sum all stages.",
};
console.log(JSON.stringify(report, null, 2));
