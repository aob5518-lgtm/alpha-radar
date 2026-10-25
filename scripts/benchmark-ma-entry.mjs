/** Offline synthetic benchmark, not profitability/backtest evidence. Node 22+. */
import { calculateMaEntry } from "../apps/web/src/lib/market/ma-confluence-entry.ts";
import { normalizeClosedCandles } from "../apps/web/src/lib/market/technical-levels.ts";
import { maFixture } from "../apps/web/tests/helpers/ma-fixtures.mjs";
import {
  fixtureHistory,
  btcId,
} from "../apps/web/tests/helpers/chart-fixtures.mjs";
const snapshot = {
  ...maFixture(),
  closedCandles: normalizeClosedCandles(
    fixtureHistory("15m", btcId, 800).items,
  ),
};
for (let i = 0; i < 10; i++) calculateMaEntry(snapshot, btcId, "15m");
const samples = [];
for (let i = 0; i < 100; i++) {
  const start = performance.now();
  calculateMaEntry(snapshot, btcId, "15m");
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      input: "synthetic 800 confirmed candles",
      samples: samples.length,
      median_ms: samples[50],
      p95_ms: samples[95],
      max_ms: samples.at(-1),
      scope:
        "MA/entry only; no existing engine replay. UI toggle memoization covered by component tests.",
    },
    null,
    2,
  ),
);
