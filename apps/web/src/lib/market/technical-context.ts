import type {
  MarketCandle,
  MarketInterval,
} from "@alpha-radar/types/market-data";

import { higherMarketInterval } from "./intervals.ts";
import {
  calculateTechnicalSnapshot,
  TREND_MIN_CANDLES,
  type TechnicalSnapshot,
} from "./technical-levels.ts";

export function calculateTechnicalContext(
  candles: MarketCandle[],
  currentPrice: number,
  interval: MarketInterval,
  higherTimeframeCandles?: MarketCandle[],
): TechnicalSnapshot {
  let higherTimeframeSnapshot: TechnicalSnapshot | null = null;
  const higherInterval = higherMarketInterval[interval];

  if (higherInterval && higherTimeframeCandles?.length) {
    higherTimeframeSnapshot = calculateTechnicalSnapshot(
      higherTimeframeCandles,
      currentPrice,
      higherInterval,
    );
  }
  const availableHigherTimeframe =
    higherTimeframeSnapshot !== null &&
    higherTimeframeSnapshot.closedCandles.length >= TREND_MIN_CANDLES
      ? higherTimeframeSnapshot
      : null;

  return calculateTechnicalSnapshot(candles, currentPrice, interval, {
    higherTimeframePrices: availableHigherTimeframe
      ? [
          ...availableHigherTimeframe.resistances,
          ...availableHigherTimeframe.supports,
        ].map((level) => level.representative_price)
      : undefined,
    higherTimeframeDirection:
      availableHigherTimeframe?.trend.direction === "unavailable"
        ? undefined
        : availableHigherTimeframe?.trend.direction,
  });
}
