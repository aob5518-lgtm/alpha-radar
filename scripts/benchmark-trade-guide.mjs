/** Offline aggregation-only benchmark. Synthetic input, not a trading backtest. */
import { calculateTradeGuide } from "../apps/web/src/lib/market/trade-guide.ts";
import { calculateMaEntry } from "../apps/web/src/lib/market/ma-confluence-entry.ts";
import { normalizeClosedCandles } from "../apps/web/src/lib/market/technical-levels.ts";
import { maFixture } from "../apps/web/tests/helpers/ma-fixtures.mjs";
import {
  btcId,
  fixtureHistory,
} from "../apps/web/tests/helpers/chart-fixtures.mjs";
const snapshot = maFixture();
snapshot.closedCandles = [
  ...normalizeClosedCandles(fixtureHistory("15m", btcId, 800).items).slice(
    0,
    480,
  ),
  ...snapshot.closedCandles,
];
const measurements = [];
for (const context of [maFixture(), maFixture("short"), snapshot]) {
  const ma = calculateMaEntry(context, btcId, "15m"),
    samples = [];
  for (let i = 0; i < 1100; i++) {
    const start = performance.now();
    calculateTradeGuide(context, ma, undefined, btcId, "15m");
    if (i >= 100) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  measurements.push({
    bars: context.closedCandles.length,
    state: calculateTradeGuide(context, ma, undefined, btcId, "15m").state,
    samples: samples.length,
    median_ms: samples[500],
    p95_ms: samples[950],
    max_ms: samples.at(-1),
  });
}
console.log(
  JSON.stringify(
    {
      input: "synthetic precomputed MA/confirmed context",
      measurements,
      scope: "aggregation only; no existing engine replay",
    },
    null,
    2,
  ),
);
