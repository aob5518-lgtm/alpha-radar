import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { analystResponseSchema } from "../src/lib/ai/schema.ts";

test("AI response schema requires every grounded response section", () => {
  assert.equal(analystResponseSchema.type, "object");
  assert.equal(analystResponseSchema.additionalProperties, false);
  for (const field of [
    "market_state",
    "trend",
    "key_resistance",
    "key_support",
    "important_recent_events",
    "bull_case",
    "bear_case",
    "trigger_conditions",
    "invalidation_and_risk",
    "watch_next",
  ]) {
    assert.ok(analystResponseSchema.required.includes(field));
  }
});

test("analyst route rehydrates canonical context and injects platform levels", async () => {
  const source = await readFile(
    new URL("../src/app/api/analyst/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /getTechnicalMarketContext/);
  assert.match(source, /getRecentEventsForAsset/);
  assert.match(source, /result\.key_resistance = market\.snapshot/);
  assert.match(source, /result\.key_support = market\.snapshot/);
});

test("live chart updates an open candle without changing closed-candle engine input", async () => {
  const chart = await readFile(
    new URL("../src/components/structural-market-chart.tsx", import.meta.url),
    "utf8",
  );
  const engine = await readFile(
    new URL("../src/lib/market/technical-levels.ts", import.meta.url),
    "utf8",
  );
  assert.match(chart, /new WebSocket/);
  assert.match(chart, /candleSeries\.update\(current\)/);
  assert.match(engine, /filter\(\(candle\) => candle\.is_closed\)/);
});
