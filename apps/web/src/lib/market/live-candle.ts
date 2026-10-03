import type { MarketInterval } from "@alpha-radar/types/market-data";

export interface LivePartialCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function updateLivePartialCandle(
  current: LivePartialCandle | null,
  price: number,
  epochSeconds: number,
  interval: MarketInterval,
): LivePartialCandle {
  const time = bucketStart(epochSeconds, interval);
  if (!current || current.time !== time) {
    return { time, open: price, high: price, low: price, close: price };
  }
  return {
    ...current,
    high: Math.max(current.high, price),
    low: Math.min(current.low, price),
    close: price,
  };
}

export function bucketStart(
  epochSeconds: number,
  interval: MarketInterval,
): number {
  if (interval === "1w") {
    const value = new Date(epochSeconds * 1000);
    const day = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() - day + 1);
    value.setUTCHours(0, 0, 0, 0);
    return Math.floor(value.getTime() / 1000);
  }
  const seconds: Record<Exclude<MarketInterval, "1w">, number> = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
  };
  const duration = seconds[interval];
  return Math.floor(epochSeconds / duration) * duration;
}
