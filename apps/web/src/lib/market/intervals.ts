import {
  marketIntervals,
  type MarketInterval,
} from "@alpha-radar/types/market-data";

export { marketIntervals };

export const defaultMarketInterval: MarketInterval = "1h";

export const intervalSeconds: Record<MarketInterval, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "4h": 14_400,
  "1d": 86_400,
  "1w": 604_800,
};

export function parseMarketInterval(value: string | undefined): MarketInterval {
  return marketIntervals.includes(value as MarketInterval)
    ? (value as MarketInterval)
    : defaultMarketInterval;
}
