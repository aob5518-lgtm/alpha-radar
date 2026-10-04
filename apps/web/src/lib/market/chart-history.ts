import type { MarketCandle } from "@alpha-radar/types/market-data";

export interface LogicalRange {
  from: number;
  to: number;
}

export function mergeOlderCandles(
  current: MarketCandle[],
  older: MarketCandle[],
): MarketCandle[] {
  const byOpenTime = new Map(
    [...older, ...current].map((candle) => [candle.open_time, candle]),
  );
  return [...byOpenTime.values()].sort(
    (left, right) => Date.parse(left.open_time) - Date.parse(right.open_time),
  );
}

export function preserveLogicalRange(
  range: LogicalRange,
  prependedCount: number,
): LogicalRange {
  return {
    from: range.from + prependedCount,
    to: range.to + prependedCount,
  };
}

export function latestLogicalRange(
  count: number,
  visibleBars = 200,
): LogicalRange {
  return { from: Math.max(0, count - visibleBars), to: Math.max(1, count - 1) };
}
