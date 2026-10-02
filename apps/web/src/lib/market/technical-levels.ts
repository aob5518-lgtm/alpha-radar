import type {
  StructuralLevel,
  StructuralLevelKind,
  StructuralStrengthBand,
  TrendBreakdown,
  TrendRegime,
} from "@alpha-radar/types/core-3";
import type {
  MarketCandle,
  MarketInterval,
} from "@alpha-radar/types/market-data";

export const TECHNICAL_LEVELS_VERSION = "structural-levels-v1";
export const TREND_REGIME_VERSION = "trend-regime-v1";

export interface NumericCandle {
  openTime: string;
  closeTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  isClosed: boolean;
}

export interface ConfirmedPivot {
  index: number;
  time: string;
  price: number;
  side: "high" | "low";
  atr: number;
  pivotQuality: number;
  rejectionStrength: number;
  volumeConfirmation: number;
}

interface LevelZone {
  zoneLow: number;
  zoneHigh: number;
  representativePrice: number;
  pivots: ConfirmedPivot[];
  strength: number;
  higherTimeframeConfluence: boolean;
}

export interface TechnicalSnapshot {
  closedCandles: NumericCandle[];
  supports: StructuralLevel[];
  resistances: StructuralLevel[];
  trend: TrendRegime;
  version: string;
  insufficientData: boolean;
}

export interface StructuralLevelOptions {
  pivotLeft?: number;
  pivotRight?: number;
  atrPeriod?: number;
  clusterAtrMultiplier?: number;
  higherTimeframePrices?: number[];
}

function finitePositive(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeClosedCandles(
  candles: MarketCandle[],
): NumericCandle[] {
  return candles
    .filter((candle) => candle.is_closed)
    .map((candle): NumericCandle | null => {
      const open = finitePositive(candle.open);
      const high = finitePositive(candle.high);
      const low = finitePositive(candle.low);
      const close = finitePositive(candle.close);
      const volume = candle.volume === null ? null : Number(candle.volume);
      if (
        open === null ||
        high === null ||
        low === null ||
        close === null ||
        high < Math.max(open, close) ||
        low > Math.min(open, close)
      )
        return null;
      return {
        openTime: candle.open_time,
        closeTime: candle.close_time,
        open,
        high,
        low,
        close,
        volume:
          volume !== null && Number.isFinite(volume) && volume >= 0
            ? volume
            : null,
        isClosed: true,
      };
    })
    .filter((candle): candle is NumericCandle => candle !== null)
    .sort(
      (left, right) => Date.parse(left.openTime) - Date.parse(right.openTime),
    );
}

export function calculateAtrSeries(
  candles: NumericCandle[],
  period = 14,
): number[] {
  const trueRanges = candles.map((candle, index) => {
    const previousClose = index > 0 ? candles[index - 1]?.close : undefined;
    return previousClose === undefined
      ? candle.high - candle.low
      : Math.max(
          candle.high - candle.low,
          Math.abs(candle.high - previousClose),
          Math.abs(candle.low - previousClose),
        );
  });
  return trueRanges.map((_, index) => {
    const start = Math.max(0, index - period + 1);
    const window = trueRanges.slice(start, index + 1);
    return window.reduce((sum, value) => sum + value, 0) / window.length;
  });
}

export function detectConfirmedPivots(
  candles: NumericCandle[],
  {
    pivotLeft = 3,
    pivotRight = 3,
    atrPeriod = 14,
  }: StructuralLevelOptions = {},
): ConfirmedPivot[] {
  if (candles.length < pivotLeft + pivotRight + 1) return [];
  const atr = calculateAtrSeries(candles, atrPeriod);
  const averageVolumes = candles.map((_, index) => {
    const values = candles
      .slice(Math.max(0, index - 19), index + 1)
      .map((candle) => candle.volume)
      .filter((value): value is number => value !== null);
    return values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  });
  const pivots: ConfirmedPivot[] = [];
  for (let index = pivotLeft; index < candles.length - pivotRight; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    const neighbors = candles.slice(index - pivotLeft, index + pivotRight + 1);
    const others = neighbors.filter(
      (_, neighborIndex) => neighborIndex !== pivotLeft,
    );
    const isHigh = others.every((value) => candle.high >= value.high);
    const isLow = others.every((value) => candle.low <= value.low);
    const localAtr = Math.max(atr[index] ?? 0, Number.EPSILON);
    const volumeAverage = averageVolumes[index];
    const volumeConfirmation =
      candle.volume !== null &&
      volumeAverage !== null &&
      volumeAverage !== undefined &&
      volumeAverage > 0
        ? Math.min(candle.volume / volumeAverage / 2, 1)
        : 0;
    if (isHigh && others.some((value) => candle.high > value.high)) {
      const surroundingHigh = Math.max(...others.map((value) => value.high));
      pivots.push({
        index,
        time: candle.closeTime,
        price: candle.high,
        side: "high",
        atr: localAtr,
        pivotQuality: clamp((candle.high - surroundingHigh) / localAtr, 0, 1),
        rejectionStrength: clamp(
          (candle.high - Math.max(candle.open, candle.close)) / localAtr,
          0,
          1,
        ),
        volumeConfirmation,
      });
    }
    if (isLow && others.some((value) => candle.low < value.low)) {
      const surroundingLow = Math.min(...others.map((value) => value.low));
      pivots.push({
        index,
        time: candle.closeTime,
        price: candle.low,
        side: "low",
        atr: localAtr,
        pivotQuality: clamp((surroundingLow - candle.low) / localAtr, 0, 1),
        rejectionStrength: clamp(
          (Math.min(candle.open, candle.close) - candle.low) / localAtr,
          0,
          1,
        ),
        volumeConfirmation,
      });
    }
  }
  return pivots;
}

export function clusterPivots(
  pivots: ConfirmedPivot[],
  candleCount: number,
  clusterAtrMultiplier = 0.6,
  higherTimeframePrices: number[] = [],
): LevelZone[] {
  const clusters: ConfirmedPivot[][] = [];
  for (const pivot of [...pivots].sort(
    (left, right) => left.price - right.price,
  )) {
    const cluster = clusters.find((candidate) => {
      const center = weightedPrice(candidate);
      const averageAtr = mean(candidate.map((item) => item.atr));
      return (
        Math.abs(center - pivot.price) <=
        Math.max(averageAtr, pivot.atr) * clusterAtrMultiplier
      );
    });
    if (cluster) cluster.push(pivot);
    else clusters.push([pivot]);
  }
  return clusters.map((cluster) => {
    const representativePrice = weightedPrice(cluster);
    const averageAtr = Math.max(
      mean(cluster.map((pivot) => pivot.atr)),
      Number.EPSILON,
    );
    const higherTimeframeConfluence = higherTimeframePrices.some(
      (price) =>
        Math.abs(price - representativePrice) <=
        averageAtr * clusterAtrMultiplier,
    );
    const recency = clamp(
      (Math.max(...cluster.map((pivot) => pivot.index)) + 1) /
        Math.max(candleCount, 1),
      0,
      1,
    );
    const touchScore = clamp(cluster.length / 4, 0, 1);
    const rejection = mean(cluster.map((pivot) => pivot.rejectionStrength));
    const volume = mean(cluster.map((pivot) => pivot.volumeConfirmation));
    const quality = mean(cluster.map((pivot) => pivot.pivotQuality));
    const strength = Math.round(
      100 *
        (0.25 * touchScore +
          0.2 * rejection +
          0.15 * volume +
          0.15 * recency +
          0.15 * quality +
          0.1 * Number(higherTimeframeConfluence)),
    );
    return {
      zoneLow: Math.min(...cluster.map((pivot) => pivot.price)),
      zoneHigh: Math.max(...cluster.map((pivot) => pivot.price)),
      representativePrice,
      pivots: cluster,
      strength,
      higherTimeframeConfluence,
    };
  });
}

function strengthBand(strength: number): StructuralStrengthBand {
  if (strength >= 70) return "strong";
  if (strength >= 45) return "moderate";
  return "weak";
}

function selectLevels(
  zones: LevelZone[],
  currentPrice: number,
  timeframe: MarketInterval,
  kind: StructuralLevelKind,
): StructuralLevel[] {
  const candidates = zones
    .filter((zone) =>
      kind === "resistance"
        ? zone.representativePrice > currentPrice
        : zone.representativePrice < currentPrice,
    )
    .map((zone) => {
      const distancePercent =
        (Math.abs(zone.representativePrice - currentPrice) / currentPrice) *
        100;
      return {
        zone,
        distancePercent,
        selectionScore: zone.strength - Math.min(distancePercent, 25) * 0.8,
      };
    })
    .sort(
      (left, right) =>
        right.selectionScore - left.selectionScore ||
        left.distancePercent - right.distancePercent ||
        left.zone.representativePrice - right.zone.representativePrice,
    )
    .slice(0, 3)
    .sort((left, right) =>
      kind === "resistance"
        ? left.zone.representativePrice - right.zone.representativePrice
        : right.zone.representativePrice - left.zone.representativePrice,
    );

  return candidates.map(({ zone, distancePercent }, index) => {
    const prefix = kind === "resistance" ? "R" : "S";
    return {
      id: `${timeframe}-${kind}-${zone.representativePrice.toPrecision(12)}`,
      label: `${prefix}${index + 1}` as StructuralLevel["label"],
      kind,
      representative_price: zone.representativePrice,
      zone_low: zone.zoneLow,
      zone_high: zone.zoneHigh,
      strength: zone.strength,
      strength_band: strengthBand(zone.strength),
      touch_count: zone.pivots.length,
      last_tested_at:
        [...zone.pivots].sort((a, b) => b.index - a.index)[0]?.time ?? "",
      distance_percent: distancePercent,
      timeframe,
      higher_timeframe_confluence: zone.higherTimeframeConfluence,
    };
  });
}

export function calculateTrendRegime(
  candles: NumericCandle[],
  higherTimeframeDirection?: "bullish" | "neutral" | "bearish",
): TrendRegime {
  const emptyBreakdown: TrendBreakdown = {
    market_structure: 0,
    ema_ordering: 0,
    ema_slopes: 0,
    price_location: 0,
    adx: 0,
    higher_timeframe_alignment: 0,
  };
  if (candles.length < 200) {
    return {
      direction: "unavailable",
      strength: 0,
      version: TREND_REGIME_VERSION,
      breakdown: emptyBreakdown,
      reason: "At least 200 closed candles are required for EMA 200.",
    };
  }
  const closes = candles.map((candle) => candle.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const last = closes.at(-1) ?? 0;
  const e20 = ema20.at(-1) ?? last;
  const e50 = ema50.at(-1) ?? last;
  const e200 = ema200.at(-1) ?? last;
  const slopeLookback = 5;
  const slope = (values: number[]) => {
    const previous = values.at(-(slopeLookback + 1)) ?? values[0] ?? 0;
    const current = values.at(-1) ?? previous;
    return previous === 0
      ? 0
      : clamp(((current - previous) / previous) * 100, -1, 1);
  };
  const pivots = detectConfirmedPivots(candles, {
    pivotLeft: 3,
    pivotRight: 3,
  });
  const highs = pivots.filter((pivot) => pivot.side === "high").slice(-2);
  const lows = pivots.filter((pivot) => pivot.side === "low").slice(-2);
  const structure =
    highs.length === 2 && lows.length === 2
      ? highs[1]!.price > highs[0]!.price && lows[1]!.price > lows[0]!.price
        ? 1
        : highs[1]!.price < highs[0]!.price && lows[1]!.price < lows[0]!.price
          ? -1
          : 0
      : 0;
  const ordering =
    e20 > e50 && e50 > e200 ? 1 : e20 < e50 && e50 < e200 ? -1 : 0;
  const slopes = mean([slope(ema20), slope(ema50), slope(ema200)]);
  const location = mean([
    last > e20 ? 1 : -1,
    last > e50 ? 1 : -1,
    last > e200 ? 1 : -1,
  ]);
  const adxValue = adx(candles, 14);
  const adxDirectionalWeight = clamp(adxValue / 50, 0, 1);
  const higher =
    higherTimeframeDirection === "bullish"
      ? 1
      : higherTimeframeDirection === "bearish"
        ? -1
        : 0;
  const directionalScore =
    0.25 * structure +
    0.25 * ordering +
    0.15 * slopes +
    0.15 * location +
    0.1 * Math.sign(ordering || structure) * adxDirectionalWeight +
    0.1 * higher;
  const direction =
    directionalScore >= 0.2
      ? "bullish"
      : directionalScore <= -0.2
        ? "bearish"
        : "neutral";
  const strength = Math.round(
    clamp(
      (Math.abs(directionalScore) * 0.75 + adxDirectionalWeight * 0.25) * 100,
      0,
      100,
    ),
  );
  return {
    direction,
    strength,
    version: TREND_REGIME_VERSION,
    breakdown: {
      market_structure: structure,
      ema_ordering: ordering,
      ema_slopes: round(slopes, 4),
      price_location: round(location, 4),
      adx: round(adxValue, 2),
      higher_timeframe_alignment: higher,
    },
    reason:
      "Regime combines closed-candle structure, EMA ordering/slopes, price location and ADX.",
  };
}

export function calculateTechnicalSnapshot(
  candles: MarketCandle[],
  currentPrice: number,
  timeframe: MarketInterval,
  options: StructuralLevelOptions = {},
): TechnicalSnapshot {
  const closedCandles = normalizeClosedCandles(candles);
  const pivots = detectConfirmedPivots(closedCandles, options);
  const zones = clusterPivots(
    pivots,
    closedCandles.length,
    options.clusterAtrMultiplier,
    options.higherTimeframePrices,
  );
  return {
    closedCandles,
    supports: selectLevels(zones, currentPrice, timeframe, "support"),
    resistances: selectLevels(zones, currentPrice, timeframe, "resistance"),
    trend: calculateTrendRegime(closedCandles),
    version: TECHNICAL_LEVELS_VERSION,
    insufficientData: closedCandles.length < 200 || pivots.length < 2,
  };
}

function weightedPrice(pivots: ConfirmedPivot[]): number {
  const weights = pivots.map((pivot) => Math.max(pivot.pivotQuality, 0.1));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return (
    pivots.reduce(
      (sum, pivot, index) => sum + pivot.price * (weights[index] ?? 0),
      0,
    ) / total
  );
}

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const multiplier = 2 / (period + 1);
  const result = [values[0] ?? 0];
  for (let index = 1; index < values.length; index += 1) {
    result.push(
      (values[index] ?? 0) * multiplier +
        (result[index - 1] ?? 0) * (1 - multiplier),
    );
  }
  return result;
}

function adx(candles: NumericCandle[], period: number): number {
  if (candles.length < period * 2 + 1) return 0;
  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index]!;
    const previous = candles[index - 1]!;
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    tr.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    );
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const dx: number[] = [];
  for (let index = period - 1; index < tr.length; index += 1) {
    const range = mean(tr.slice(index - period + 1, index + 1));
    if (range === 0) {
      dx.push(0);
      continue;
    }
    const plus =
      (mean(plusDm.slice(index - period + 1, index + 1)) / range) * 100;
    const minus =
      (mean(minusDm.slice(index - period + 1, index + 1)) / range) * 100;
    dx.push(
      plus + minus === 0 ? 0 : (Math.abs(plus - minus) / (plus + minus)) * 100,
    );
  }
  return mean(dx.slice(-period));
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
