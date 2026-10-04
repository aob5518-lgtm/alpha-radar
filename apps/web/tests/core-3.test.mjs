import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  analystHref,
  parseAnalystHandoff,
} from "../src/lib/market/analyst-context.ts";
import {
  higherMarketInterval,
  marketIntervals,
  parseMarketInterval,
} from "../src/lib/market/intervals.ts";
import {
  calculateSeededEma,
  calculateTechnicalSnapshot,
  calculateTrendRegime,
  calculateWilderAdx,
  clusterPivots,
  detectConfirmedPivots,
  normalizeClosedCandles,
} from "../src/lib/market/technical-levels.ts";
import { calculateTechnicalContext } from "../src/lib/market/technical-context.ts";
import { formatEventSchedule } from "../src/lib/events/time.ts";
import {
  presentEvent,
  resolveSelectedEvent,
} from "../src/lib/events/presentation.ts";

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
  assert.deepEqual(higherMarketInterval, {
    "1m": "5m",
    "5m": "15m",
    "15m": "1h",
    "1h": "4h",
    "4h": "1d",
    "1d": "1w",
    "1w": null,
  });
});

test("equal-price pivot plateaus resolve to the final plateau candle", () => {
  const highs = [10, 11, 15, 15, 15, 11, 10];
  const source = highs.map((high, index) =>
    candle(index, high - 1, { high, low: high - 2 }),
  );
  const highPivots = detectConfirmedPivots(normalizeClosedCandles(source), {
    pivotLeft: 2,
    pivotRight: 2,
  }).filter((pivot) => pivot.side === "high");
  assert.deepEqual(
    highPivots.map((pivot) => pivot.index),
    [4],
  );
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

test("missing volume and higher-timeframe inputs are omitted, not scored as zero", () => {
  const base = {
    index: 10,
    time: "2026-01-01T00:00:00Z",
    side: "high",
    atr: 100,
    pivotQuality: 0.8,
    rejectionStrength: 0.7,
  };
  const unavailable = clusterPivots(
    [{ ...base, price: 70_850, volumeConfirmation: null }],
    40,
    0.6,
  )[0];
  const explicitZero = clusterPivots(
    [{ ...base, price: 70_850, volumeConfirmation: 0 }],
    40,
    0.6,
    [],
  )[0];
  assert.equal(unavailable.volumeEvidenceAvailable, false);
  assert.equal(unavailable.higherTimeframeAvailable, false);
  assert.equal(explicitZero.volumeEvidenceAvailable, true);
  assert.equal(explicitZero.higherTimeframeAvailable, true);
  assert.ok(unavailable.strength > explicitZero.strength);
});

test("EMA uses an SMA seed and Wilder ADX exposes standard intermediates", () => {
  assert.deepEqual(calculateSeededEma([1, 2, 3, 4, 5], 3), [
    null,
    null,
    2,
    3,
    4,
  ]);
  const values = [
    { high: 30, low: 28, close: 29 },
    { high: 32, low: 29, close: 31 },
    { high: 31, low: 28, close: 29 },
    { high: 34, low: 30, close: 33 },
    { high: 35, low: 32, close: 34 },
    { high: 34, low: 30, close: 31 },
  ];
  const normalized = values.map((value, index) => ({
    openTime: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    closeTime: new Date(Date.UTC(2026, 0, index + 2)).toISOString(),
    open: value.close,
    ...value,
    volume: 100,
    isClosed: true,
  }));
  const adx = calculateWilderAdx(normalized, 3);
  assert.deepEqual(adx.trueRange, [2, 3, 3, 5, 3, 4]);
  assert.deepEqual(adx.plusDm, [0, 2, 0, 3, 1, 0]);
  assert.deepEqual(adx.minusDm, [0, 0, 1, 0, 0, 2]);
  assert.ok(Math.abs(adx.smoothedTrueRange[3] - 11) < 1e-9);
  assert.ok(Math.abs(adx.smoothedPlusDm[3] - 5) < 1e-9);
  assert.ok(Math.abs(adx.smoothedMinusDm[3] - 1) < 1e-9);
  assert.ok(Math.abs(adx.plusDi[3] - 45.4545454545) < 1e-6);
  assert.ok(Math.abs(adx.minusDi[3] - 9.0909090909) < 1e-6);
  assert.ok(Math.abs(adx.dx[3] - 66.6666666667) < 1e-6);
  assert.ok(Math.abs(adx.adx[5] - 49.4444444444) < 1e-6);
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

test("available higher-timeframe history is wired into level and trend evidence", () => {
  const current = Array.from({ length: 260 }, (_, index) =>
    candle(index, 100 + index * 0.1 + Math.sin(index / 3) * 5),
  );
  const higher = Array.from({ length: 260 }, (_, index) =>
    candle(index, 100 + index * 0.2 + Math.sin(index / 4) * 8, {
      interval: "4h",
    }),
  );
  const currentPrice = Number(current.at(-1).close);
  const withoutHigher = calculateTechnicalContext(current, currentPrice, "1h");
  const withHigher = calculateTechnicalContext(
    current,
    currentPrice,
    "1h",
    higher,
  );
  const levels = [...withHigher.supports, ...withHigher.resistances];
  assert.ok(levels.length > 0);
  assert.ok(levels.every((level) => level.higher_timeframe_available));
  assert.ok(
    [...withoutHigher.supports, ...withoutHigher.resistances].every(
      (level) => !level.higher_timeframe_available,
    ),
  );
  assert.notEqual(withHigher.trend.breakdown.higher_timeframe_alignment, null);
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
  const notEnoughWarmup = normalizeClosedCandles(
    Array.from({ length: 249 }, (_, index) => candle(index, 100 + index)),
  );
  assert.equal(calculateTrendRegime(notEnoughWarmup).direction, "unavailable");

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
  assert.equal(
    calculateTrendRegime(rising, "bullish").breakdown
      .higher_timeframe_alignment,
    1,
  );
});

test("Chart handoff carries exact market instrument identity and timeframe", () => {
  const href = analystHref("canonical-uuid", "4h");
  assert.equal(
    href,
    "/analyst?instrument=canonical-uuid&interval=4h&from=chart",
  );
  assert.deepEqual(
    parseAnalystHandoff({
      instrument: "canonical-uuid",
      interval: "4h",
      from: "chart",
    }),
    { instrument: "canonical-uuid", interval: "4h", fromChart: true },
  );
  assert.equal(parseAnalystHandoff({ interval: "1h" }), null);
});

test("zh-CN Events use deterministic Chinese presentation while English is unchanged", () => {
  const event = {
    id: "event-1",
    title: "Consumer Price Index — September 2026",
    event_type: "cpi",
    status: "scheduled",
    scheduled_date: "2026-10-14",
    scheduled_at: "2026-10-14T12:30:00Z",
    scheduled_timezone: "America/New_York",
    actual_release_at: null,
    detected_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    importance: "critical",
    summary: "FACT: Original canonical summary.",
    why_it_matters: "ANALYSIS: Original canonical analysis.",
    actual: null,
    forecast: null,
    previous: null,
    affected_assets: [],
    impact_analysis: {},
    bull_case: "SCENARIO: Original bull case.",
    bear_case: "SCENARIO: Original bear case.",
    watch_next: ["Official release", "Market reaction"],
    sources: [
      {
        source_id: "source-1",
        source_document_id: "document-1",
        source_name: "U.S. Bureau of Labor Statistics Release Calendar",
        title: "Calendar",
        canonical_url: "https://www.bls.gov/schedule/",
        published_at: null,
      },
    ],
  };
  const english = presentEvent(event, "en");
  const chinese = presentEvent(event, "zh-CN");

  assert.equal(english.title, event.title);
  assert.equal(english.summary, event.summary);
  assert.equal(english.sourceNames["document-1"], event.sources[0].source_name);
  assert.match(chinese.title, /美国消费者价格指数（CPI）/);
  assert.equal(chinese.status, "待公布");
  assert.equal(chinese.importance, "极高");
  assert.match(chinese.summary, /^事实：/);
  assert.match(chinese.whyItMatters, /^分析：/);
  assert.match(chinese.bullCase, /^情景：/);
  assert.equal(chinese.sourceNames["document-1"], "美国劳工统计局（BLS）");
});

test("empty Event filters clear stale selected detail", () => {
  assert.equal(resolveSelectedEvent([], "stale-event"), null);
});

test("Crypto Event presentation labels official facts and social signals conservatively", () => {
  const base = {
    id: "crypto-1",
    title: "Protocol upgrade announced",
    category: "crypto",
    event_type: "protocol_upgrade",
    status: "completed",
    importance: "high",
    summary: "FACT: Official source published an upgrade.",
    signal: "SIGNAL: Attention may change.",
    why_it_matters: "ANALYSIS: Market structure must confirm impact.",
    risk: "RISK: Adoption and price are not guaranteed.",
    recommended_action: "wait_for_confirmation",
    opportunity_signal: "wait",
    confidence: "medium",
    contract_address: null,
    bull_case: null,
    bear_case: null,
    watch_next: [],
    affected_assets: [],
    sources: [
      {
        source_document_id: "doc",
        source_name: "Official Protocol",
        source_type: "protocol",
        evidence_role: "fact",
      },
    ],
  };
  const official = presentEvent(base, "zh-CN");
  const social = presentEvent(
    {
      ...base,
      event_type: "influential_social",
      sources: [
        { ...base.sources[0], source_type: "social", evidence_role: "signal" },
      ],
    },
    "zh-CN",
  );
  assert.match(official.title, /协议升级/);
  assert.equal(official.action, "等待确认");
  assert.equal(official.opportunitySignal, "等待");
  assert.match(social.summary, /帖子本身/);
  assert.match(social.risk, /不得据此推断代币发行或价格上涨/);
  assert.equal(social.contractAddress, null);
});

test("Chart quick switches preserve timeframe and use instrument URLs", async () => {
  const source = await readFile(
    new URL("../src/components/chart-asset-selector.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /BTC.*ETH.*SOL.*XRP.*BNB.*DOGE/s);
  assert.match(source, /ADA.*SUI.*LINK.*AVAX.*LTC.*BCH/s);
  assert.match(source, /instrument=.*interval=\$\{interval\}/);
  assert.doesNotMatch(source, /datalist|Apply/);
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
