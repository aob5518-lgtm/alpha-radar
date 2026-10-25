import { fixtureHistory, btcId } from "./chart-fixtures.mjs";
import { normalizeClosedCandles } from "../../src/lib/market/technical-levels.ts";
export function maFixture(direction = "long") {
  const source = fixtureHistory("15m", btcId, 320);
  source.items = source.items.map((c, i) => {
    const p = 100 + i * 0.05;
    return {
      ...c,
      open: String(p - 0.1),
      high: String(p + 1.2),
      low: String(p - 1.2),
      close: String(p),
      volume: "100",
    };
  });
  const average =
    source.items.slice(-101, -2).reduce((sum, c) => sum + Number(c.close), 0) /
    99;
  source.items[318] = {
    ...source.items[318],
    open: String(average + 0.8),
    close: String(average + 0.6),
    high: String(average + 0.8),
    low: String(average - 0.1),
  };
  source.items[319] = {
    ...source.items[319],
    open: String(average + 0.4),
    close: String(average + 1.05),
    high: String(average + 1.1),
    low: String(average - 0.15),
    volume: "120",
  };
  if (direction === "short")
    source.items = source.items.map((c) => ({
      ...c,
      open: String(300 - Number(c.open)),
      close: String(300 - Number(c.close)),
      high: String(300 - Number(c.low)),
      low: String(300 - Number(c.high)),
    }));
  const zone = (kind, p) => ({
    id: `fixture-${kind}`,
    kind,
    label: kind === "support" ? "S1" : "R1",
    zone_low: p - 0.1,
    zone_high: p + 0.1,
    representative_price: p,
    strength: 80,
    strength_band: "strong",
    pivot_count: 3,
    last_tested_at: source.items.at(-1).close_time,
    distance_percent: 10,
    timeframe: "15m",
    higher_timeframe_available: false,
    higher_timeframe_confluence: false,
  });
  const trendDirection = direction === "long" ? "bullish" : "bearish";
  return {
    closedCandles: normalizeClosedCandles(source.items),
    supports: [zone("support", direction === "long" ? 100 : 170)],
    resistances: [zone("resistance", direction === "long" ? 130 : 200)],
    trend: {
      direction: trendDirection,
      strength: 80,
      version: "trend-regime-v1.1",
      breakdown: { market_structure: direction === "long" ? 1 : -1 },
    },
    state: {
      direction: trendDirection,
      phase:
        direction === "long" ? "support_confirmed" : "resistance_confirmed",
      confirmed_at: source.items.at(-1).close_time,
    },
    markers: [],
    version: "structural-levels-v1.1",
    insufficientData: false,
  };
}
