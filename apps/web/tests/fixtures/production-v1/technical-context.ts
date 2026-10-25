// Frozen production oracle from 1ca729c. Test-only; do not optimize or edit formulas.
import type {
  MarketCandle,
  MarketInterval,
} from "@alpha-radar/types/market-data";

import { higherMarketInterval } from "../../../src/lib/market/intervals.ts";
import {
  calculateMarketStateAnalysis,
  type MarketStateAnalysis,
} from "./market-state.ts";
import {
  calculateTechnicalSnapshot,
  TREND_MIN_CANDLES,
  type TechnicalSnapshot,
} from "./technical-levels.ts";
import {
  createTechnicalTimings,
  type TechnicalTimings,
} from "../../../src/lib/market/technical-diagnostics.ts";

export type TechnicalContextSnapshot = TechnicalSnapshot & MarketStateAnalysis;

export function calculateTechnicalContext(
  candles: MarketCandle[],
  currentPrice: number,
  interval: MarketInterval,
  higherTimeframeCandles?: MarketCandle[],
  marketInstrumentId = "unknown",
  diagnostics?: (timings: TechnicalTimings) => void,
): TechnicalContextSnapshot {
  const timings = diagnostics ? createTechnicalTimings() : undefined;
  const started = performance.now();
  let higherTimeframeSnapshot: TechnicalSnapshot | null = null;
  const higherInterval = higherMarketInterval[interval];

  if (higherInterval && higherTimeframeCandles?.length) {
    higherTimeframeSnapshot = calculateTechnicalSnapshot(
      higherTimeframeCandles,
      currentPrice,
      higherInterval,
      {},
      timings,
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
    timings,
  );
  const confirmedPrice = snapshot.closedCandles.at(-1)?.close ?? currentPrice;
  const confirmedSnapshot =
    currentPrice === confirmedPrice
      ? snapshot
      : calculateTechnicalSnapshot(
          candles,
          confirmedPrice,
          interval,
          options,
          timings,
        );
  const result = {
    ...snapshot,
    ...calculateMarketStateAnalysis(
      candles,
      confirmedSnapshot,
      marketInstrumentId,
      interval,
      timings,
    ),
  };
  if (timings && diagnostics) {
    timings.total_technical_context_ms = performance.now() - started;
    diagnostics(timings);
  }
  return result;
}
