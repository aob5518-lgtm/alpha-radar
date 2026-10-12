import { bucketStart } from "../../src/lib/market/live-candle.ts";
import { intervalSeconds } from "../../src/lib/market/intervals.ts";

export const fixtureNow = Date.parse("2026-10-12T12:00:00Z");
export const btcId = "b211ed53-f2ed-5135-b52e-00217b04afc6";
export const ethId = "a01580d8-52c9-5721-9214-d3b91654de2d";

export function fixtureHistory(interval = "15m", id = btcId, count = 320) {
  const duration = intervalSeconds[interval] * 1000;
  const end = bucketStart(fixtureNow / 1000, interval) * 1000;
  const items = Array.from({ length: count }, (_, index) => {
    const time = end - (count - index) * duration;
    const price = 100 + index * 0.04 + Math.sin(index / 4) * 2;
    return {
      market_instrument_id: id,
      provider: "test",
      interval,
      open_time: new Date(time).toISOString(),
      close_time: new Date(time + duration).toISOString(),
      open: String(price - 0.1),
      high: String(price + 0.8),
      low: String(price - 0.8),
      close: String(price),
      volume: "100",
      quote_volume: null,
      is_closed: true,
      provider_timestamp: null,
      ingested_at: new Date(time + duration).toISOString(),
      quality_flags: [],
    };
  });
  return {
    asset_id: "fixture-asset",
    symbol: id === btcId ? "BTC" : "ETH",
    market_instrument_id: id,
    provider_instrument_id: id === btcId ? "BTCUSDT" : "ETHUSDT",
    base_currency: "BTC",
    quote_currency: "USDT",
    provider: "test",
    interval,
    items,
    has_more: true,
    next_end: items[0].open_time,
  };
}

export function fixtureClosedUpdate(history, price = 160) {
  const prior = history.items.at(-1);
  const duration = intervalSeconds[history.interval] * 1000;
  return {
    ...prior,
    type: "candle",
    provider_instrument_id: history.provider_instrument_id,
    open_time: prior.close_time,
    close_time: new Date(Date.parse(prior.close_time) + duration).toISOString(),
    open: prior.close,
    high: String(Math.max(price, Number(prior.close)) + 0.8),
    low: String(Math.min(price, Number(prior.close)) - 0.8),
    close: String(price),
  };
}
