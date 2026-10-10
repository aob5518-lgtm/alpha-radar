import type {
  MarketCandle,
  MarketInterval,
} from "@alpha-radar/types/market-data";

import { higherMarketInterval } from "./intervals.ts";
import {
  calculateMarketStateAnalysis,
  type MarketStateAnalysis,
} from "./market-state.ts";
import {
  calculateTechnicalSnapshot,
  TREND_MIN_CANDLES,
  type TechnicalSnapshot,
} from "./technical-levels.ts";

export type TechnicalContextSnapshot = TechnicalSnapshot & MarketStateAnalysis;

export function calculateTechnicalContext(
  candles: MarketCandle[],
  currentPrice: number,
  interval: MarketInterval,
  higherTimeframeCandles?: MarketCandle[],
  marketInstrumentId = "unknown",
): TechnicalContextSnapshot {
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

  const options = {
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
  };
  const snapshot = calculateTechnicalSnapshot(
    candles,
    currentPrice,
    interval,
    options,
  );
  const confirmedPrice = snapshot.closedCandles.at(-1)?.close ?? currentPrice;
  const confirmedSnapshot = calculateTechnicalSnapshot(
    candles,
    confirmedPrice,
    interval,
    options,
  );
  return {
    ...snapshot,
    ...calculateMarketStateAnalysis(
      candles,
      confirmedSnapshot,
      marketInstrumentId,
      interval,
    ),
  };
}
