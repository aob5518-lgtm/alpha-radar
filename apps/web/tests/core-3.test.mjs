import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  analystHref,
  parseAnalystHandoff,
} from "../src/lib/market/analyst-context.ts";
import {
  marketIntervals,
  parseMarketInterval,
} from "../src/lib/market/intervals.ts";
import {
  calculateTechnicalSnapshot,
  calculateTrendRegime,
  clusterPivots,
  detectConfirmedPivots,
  normalizeClosedCandles,
} from "../src/lib/market/technical-levels.ts";
import { formatEventSchedule } from "../src/lib/events/time.ts";

function candle(index, close, options = {}) {
  const open = options.open ?? close - 0.25;
  return {
    market_instrument_id: "instrument",
    provider: "test",
    interval: options.interval ?? "1h",
    open_time: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    close_time: new Date(Date.UTC(2026, 0, 1, index + 1)).toISOString(),
    open: String(open),
    high: String(options.high ?? Math.max(open, close) + 1),
    low: String(options.low ?? Math.min(open, close) - 1),
    close: String(close),
    volume: String(options.volume ?? 100 + index),
    quote_volume: null,
    is_closed: options.isClosed ?? true,
    provider_timestamp: null,
    ingested_at: new Date(Date.UTC(2026, 0, 1, index + 1)).toISOString(),
    quality_flags: [],
  };
}

test("Core 3 navigation has exactly Events, Chart and AI Analyst", async () => {
  const source = await readFile(
    new URL("../src/components/app-shell.tsx", import.meta.url),
    "utf8",
  );
  const routeBlock =
    source.match(/const routes = \[(.*?)\] as const;/s)?.[1] ?? "";
  assert.deepEqual(
    [...routeBlock.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]),
    ["/events", "/chart", "/analyst"],
  );
  for (const removed of [
    "/discover",
    "/strategy",
    "/assets",
    "/watchlist",
    "/alerts",
    "/radar",
  ]) {
    assert.equal(routeBlock.includes(removed), false);
  }
});

test("legacy product routes redirect and internal source audit remains reachable", async () => {
  const source = await readFile(
    new URL("../next.config.ts", import.meta.url),
    "utf8",
  );
  for (const route of [
    "/radar",
    "/discover",
    "/strategy",
    "/watchlist",
    "/alerts",
    "/assets",
  ]) {
    assert.ok(source.includes(`source: "${route}"`), route);
  }
  assert.equal(source.includes('source: "/radar/:path*"'), false);
});

test("event schedule never invents a time for null or date-only values", () => {
  assert.deepEqual(formatEventSchedule(null, "en", "Unknown"), {
    value: "Unknown",
    hasAnnouncedTime: false,
    timezone: "UTC",
  });
  assert.equal(
    formatEventSchedule("2026-10-02", "en", "Time not announced")
      .hasAnnouncedTime,
    false,
  );
  const timestamp = formatEventSchedule(
    "2026-10-02T12:30:00Z",
    "en",
    "Unknown",
  );
  assert.equal(timestamp.hasAnnouncedTime, true);
  assert.match(timestamp.value, /UTC/);
});

test("all seven chart timeframes parse independently", () => {
  assert.deepEqual(marketIntervals, [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h",
    "1d",
    "1w",
  ]);
  for (const interval of marketIntervals)
    assert.equal(parseMarketInterval(interval), interval);
  assert.equal(parseMarketInterval("bad"), "1h");
});

test("pivots require right-side confirmation and open candles are excluded", () => {
  const source = [10, 11, 12, 16, 12, 11, 10].map((value, index) =>
    candle(index, value, {
      high: value + (index === 3 ? 2 : 0.5),
      low: value - 0.5,
    }),
  );
  const incomplete = detectConfirmedPivots(
    normalizeClosedCandles(source.slice(0, 5)),
    {
      pivotLeft: 2,
      pivotRight: 2,
    },
  );
  const confirmed = detectConfirmedPivots(normalizeClosedCandles(source), {
    pivotLeft: 2,
    pivotRight: 2,
  });
  assert.equal(
    incomplete.some((pivot) => pivot.index === 3),
    false,
  );
  assert.equal(
    confirmed.some((pivot) => pivot.index === 3 && pivot.side === "high"),
    true,
  );
  assert.equal(
    normalizeClosedCandles([...source, candle(8, 999, { isClosed: false })])
      .length,
    source.length,
  );
});

test("ATR-relative clustering merges nearby levels and leaves separated zones", () => {
  const base = {
    index: 10,
    time: "2026-01-01T00:00:00Z",
    side: "high",
    atr: 100,
    pivotQuality: 0.8,
    rejectionStrength: 0.7,
    volumeConfirmation: 0.6,
  };
  const zones = clusterPivots(
    [
      { ...base, price: 70850 },
      { ...base, index: 20, price: 70900 },
      { ...base, index: 30, price: 72000 },
    ],
    40,
    0.6,
  );
  assert.equal(zones.length, 2);
  assert.equal(zones[0].pivots.length, 2);
});

test("technical calculation is deterministic, timeframe-specific and non-repainting", () => {
  const closes = Array.from(
    { length: 260 },
    (_, index) => 100 + index * 0.12 + Math.sin(index / 4) * 4,
  );
  const source = closes.map((value, index) => candle(index, value));
  const first = calculateTechnicalSnapshot(source, closes.at(-1), "1h");
  const repeated = calculateTechnicalSnapshot(source, closes.at(-1), "1h");
  const withOpenSpike = calculateTechnicalSnapshot(
    [...source, candle(261, 10000, { high: 12000, isClosed: false })],
    closes.at(-1),
    "1h",
  );
  assert.deepEqual(first, repeated);
  assert.deepEqual(first, withOpenSpike);
  const daily = calculateTechnicalSnapshot(source, closes.at(-1), "1d");
  assert.ok(daily.supports.every((level) => level.timeframe === "1d"));
  assert.ok(first.supports.every((level) => level.timeframe === "1h"));
  assert.ok(first.resistances.length <= 3 && first.supports.length <= 3);
});

test("historical replay does not change already-confirmed pivots with future candles", () => {
  const source = Array.from({ length: 100 }, (_, index) =>
    candle(index, 100 + Math.sin(index / 3) * 8),
  );
  const prefix = detectConfirmedPivots(
    normalizeClosedCandles(source.slice(0, 70)),
  );
  const full = detectConfirmedPivots(normalizeClosedCandles(source)).filter(
    (pivot) => pivot.index < 67,
  );
  assert.deepEqual(prefix, full);
});

test("trend regime handles insufficient, rising, flat and volatile markets", () => {
  const insufficient = normalizeClosedCandles(
    Array.from({ length: 50 }, (_, index) => candle(index, 100)),
  );
  assert.equal(calculateTrendRegime(insufficient).direction, "unavailable");

  const rising = normalizeClosedCandles(
    Array.from({ length: 260 }, (_, index) =>
      candle(index, 100 + index * 0.5 + Math.sin(index) * 0.2),
    ),
  );
  assert.equal(calculateTrendRegime(rising).direction, "bullish");

  const flat = normalizeClosedCandles(
    Array.from({ length: 260 }, (_, index) =>
      candle(index, 100 + Math.sin(index / 2) * 0.1),
    ),
  );
  assert.notEqual(calculateTrendRegime(flat).direction, "unavailable");

  const volatile = normalizeClosedCandles(
    Array.from({ length: 260 }, (_, index) =>
      candle(index, 100 + Math.sin(index / 2) * 15),
    ),
  );
  const volatileRegime = calculateTrendRegime(volatile);
  assert.ok(volatileRegime.strength >= 0 && volatileRegime.strength <= 100);
});

test("Chart handoff carries only asset identity and timeframe", () => {
  const href = analystHref("canonical-uuid", "4h");
  assert.equal(href, "/analyst?asset=canonical-uuid&interval=4h&from=chart");
  assert.deepEqual(
    parseAnalystHandoff({
      asset: "canonical-uuid",
      interval: "4h",
      from: "chart",
    }),
    { asset: "canonical-uuid", interval: "4h", fromChart: true },
  );
  assert.equal(parseAnalystHandoff({ interval: "1h" }), null);
});

test("Core 3 copy has English and Simplified Chinese parity", async () => {
  const [english, chinese] = await Promise.all([
    readFile(new URL("../messages/en.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
    readFile(new URL("../messages/zh-CN.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
  ]);
  for (const key of ["events", "chart", "analyst"]) {
    assert.deepEqual(Object.keys(chinese[key]), Object.keys(english[key]));
  }
  assert.equal(english.nav.events, "Events");
  assert.equal(chinese.nav.events, "事件");
});
