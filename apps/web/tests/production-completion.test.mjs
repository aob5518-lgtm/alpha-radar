import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { analystResponseSchema } from "../src/lib/ai/schema.ts";
import { AnalystLimiter } from "../src/lib/ai/rate-limit.ts";
import { updateLivePartialCandle } from "../src/lib/market/live-candle.ts";
import {
  latestLogicalRange,
  mergeOlderCandles,
  preserveLogicalRange,
} from "../src/lib/market/chart-history.ts";

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

class MemoryAnalystStore {
  constructor() {
    this.clientCounts = new Map();
    this.globalCount = 0;
    this.active = new Set();
  }

  async acquire(input) {
    const clientCount = this.clientCounts.get(input.clientId) ?? 0;
    if (clientCount >= input.clientLimit) return "client_rate";
    if (this.globalCount >= input.globalLimit) return "global_rate";
    if (this.active.size >= input.concurrencyLimit) return "global_concurrency";
    this.clientCounts.set(input.clientId, clientCount + 1);
    this.globalCount += 1;
    this.active.add(input.token);
    return null;
  }

  async release(token) {
    this.active.delete(token);
  }
}

test("AI limiter enforces per-client rate and global concurrency", async () => {
  const rateStore = new MemoryAnalystStore();
  const rateLimiter = new AnalystLimiter(rateStore, {
    clientLimit: 1,
    globalLimit: 10,
    concurrencyLimit: 3,
    windowMs: 60_000,
    leaseMs: 120_000,
  });
  const first = await rateLimiter.acquire("198.51.100.1");
  await rateLimiter.release(first);
  const rateRejected = await rateLimiter.acquire("198.51.100.1");
  assert.equal(rateRejected.reason, "client_rate");

  const globalStore = new MemoryAnalystStore();
  const globalLimiter = new AnalystLimiter(globalStore, {
    clientLimit: 10,
    globalLimit: 1,
    concurrencyLimit: 10,
    windowMs: 60_000,
    leaseMs: 120_000,
  });
  const globalActive = await globalLimiter.acquire("198.51.100.1");
  await globalLimiter.release(globalActive);
  assert.equal(
    (await globalLimiter.acquire("198.51.100.2")).reason,
    "global_rate",
  );

  const concurrencyStore = new MemoryAnalystStore();
  const concurrencyLimiter = new AnalystLimiter(concurrencyStore, {
    clientLimit: 10,
    globalLimit: 10,
    concurrencyLimit: 1,
    windowMs: 60_000,
    leaseMs: 120_000,
  });
  const active = await concurrencyLimiter.acquire("198.51.100.1");
  const concurrencyRejected = await concurrencyLimiter.acquire("198.51.100.2");
  assert.equal(concurrencyRejected.reason, "global_concurrency");
  await concurrencyLimiter.release(active);
  assert.equal(
    (await concurrencyLimiter.acquire("198.51.100.2")).acquired,
    true,
  );
});

test("analyst route rehydrates canonical context and injects platform levels", async () => {
  const source = await readFile(
    new URL("../src/app/api/analyst/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /getTechnicalMarketContext/);
  assert.match(source, /market_instrument_id/);
  assert.match(source, /getMarketInstrument\(instrumentId\)/);
  assert.match(source, /getTechnicalMarketContext\(instrument\.id/);
  assert.match(source, /getRecentEventsForAsset/);
  assert.match(source, /result\.key_resistance = market\.snapshot/);
  assert.match(source, /result\.key_support = market\.snapshot/);
  assert.match(source, /readBoundedJson\(request, 16_384\)/);
  assert.match(source, /request_too_large/);
  assert.match(source, /status: 413/);
  assert.match(source, /status: 429/);
  assert.match(source, /rate_limiter_status: limiterStatus/);
  assert.match(source, /finally/);
});

test("live chart uses instrument-specific provider Klines without changing closed-candle engine input", async () => {
  const chart = await readFile(
    new URL("../src/components/structural-market-chart.tsx", import.meta.url),
    "utf8",
  );
  const engine = await readFile(
    new URL("../src/lib/market/technical-levels.ts", import.meta.url),
    "utf8",
  );
  assert.match(chart, /new WebSocket/);
  assert.match(chart, /market-instruments/);
  assert.match(chart, /type === "trade"/);
  assert.match(chart, /type === "price"/);
  assert.match(chart, /loadOlder/);
  assert.match(chart, /candle\.is_closed/);
  assert.match(chart, /candleSeries\.update/);
  assert.match(engine, /filter\(\(candle\) => candle\.is_closed\)/);
});

test("live partial candles use the first tick as open across consecutive boundaries", () => {
  let candle = updateLivePartialCandle(null, 100, 60, "1m");
  candle = updateLivePartialCandle(candle, 105, 90, "1m");
  assert.deepEqual(candle, {
    time: 60,
    open: 100,
    high: 105,
    low: 100,
    close: 105,
  });

  candle = updateLivePartialCandle(candle, 90, 120, "1m");
  assert.deepEqual(candle, {
    time: 120,
    open: 90,
    high: 90,
    low: 90,
    close: 90,
  });
  candle = updateLivePartialCandle(candle, 95, 180, "1m");
  assert.equal(candle.open, 95);
  assert.equal(candle.time, 180);
});

test("older history prepends deterministically without moving the viewport", () => {
  const make = (time) => ({ open_time: time });
  const current = [make("2026-10-03T02:00:00Z"), make("2026-10-03T03:00:00Z")];
  const older = [make("2026-10-03T01:00:00Z"), make("2026-10-03T02:00:00Z")];
  const merged = mergeOlderCandles(current, older);
  assert.deepEqual(
    merged.map((item) => item.open_time),
    ["2026-10-03T01:00:00Z", "2026-10-03T02:00:00Z", "2026-10-03T03:00:00Z"],
  );
  assert.deepEqual(preserveLogicalRange({ from: 4, to: 12 }, 1), {
    from: 5,
    to: 13,
  });
  assert.deepEqual(latestLogicalRange(800), { from: 600, to: 799 });
});

test("Core 3 client localization is safe during server rendering", async () => {
  const client = await readFile(
    new URL("../src/lib/i18n/client.ts", import.meta.url),
    "utf8",
  );
  const eventsPage = await readFile(
    new URL("../src/app/events/page.tsx", import.meta.url),
    "utf8",
  );
  const analystPage = await readFile(
    new URL("../src/app/analyst/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(client, /typeof document === "undefined"/);
  assert.match(
    eventsPage,
    /<EventsWorkspace events=\{events\.items\} locale=\{locale\}/,
  );
  assert.match(analystPage, /locale=\{locale\}/);
});
