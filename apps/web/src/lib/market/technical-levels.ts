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

export const TECHNICAL_LEVELS_VERSION = "structural-levels-v1.1";
export const TREND_REGIME_VERSION = "trend-regime-v1.1";
export const TREND_MIN_CANDLES = 250;

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
  volumeConfirmation: number | null;
}

export interface LevelZone {
  zoneLow: number;
  zoneHigh: number;
  representativePrice: number;
  pivots: ConfirmedPivot[];
  strength: number;
  volumeEvidenceAvailable: boolean;
  higherTimeframeAvailable: boolean;
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
  higherTimeframeDirection?: "bullish" | "neutral" | "bearish";
}

export interface WilderAdxSeries {
  trueRange: number[];
  plusDm: number[];
  minusDm: number[];
  smoothedTrueRange: Array<number | null>;
  smoothedPlusDm: Array<number | null>;
  smoothedMinusDm: Array<number | null>;
  plusDi: Array<number | null>;
  minusDi: Array<number | null>;
  dx: Array<number | null>;
  adx: Array<number | null>;
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
  if (candles.length === 0) return [];
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
  const result: number[] = [];
  for (let index = 0; index < trueRanges.length; index += 1) {
    if (index < period - 1) {
      result.push(mean(trueRanges.slice(0, index + 1)));
    } else if (index === period - 1) {
      result.push(mean(trueRanges.slice(0, period)));
    } else {
      result.push(
        ((result[index - 1] ?? 0) * (period - 1) + (trueRanges[index] ?? 0)) /
          period,
      );
    }
  }
  return result;
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
    return values.length > 0 ? mean(values) : null;
  });
  const pivots: ConfirmedPivot[] = [];
  for (let index = pivotLeft; index < candles.length - pivotRight; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    const neighbors = candles.slice(index - pivotLeft, index + pivotRight + 1);
    const others = neighbors.filter(
      (_, neighborIndex) => neighborIndex !== pivotLeft,
    );
    const next = candles[index + 1];
    const isFinalHighPlateau = next?.high !== candle.high;
    const isFinalLowPlateau = next?.low !== candle.low;
    const isHigh =
      isFinalHighPlateau &&
      others.every((value) => candle.high >= value.high) &&
      others.some((value) => candle.high > value.high);
    const isLow =
      isFinalLowPlateau &&
      others.every((value) => candle.low <= value.low) &&
      others.some((value) => candle.low < value.low);
    const localAtr = Math.max(atr[index] ?? 0, Number.EPSILON);
    const volumeAverage = averageVolumes[index];
    const volumeConfirmation =
      candle.volume !== null &&
      volumeAverage !== null &&
      volumeAverage !== undefined &&
      volumeAverage > 0
        ? Math.min(candle.volume / volumeAverage / 2, 1)
        : null;
    if (isHigh) {
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
    if (isLow) {
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
  higherTimeframePrices?: number[],
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
    const higherTimeframeAvailable = higherTimeframePrices !== undefined;
    const higherTimeframeConfluence =
      higherTimeframeAvailable &&
      higherTimeframePrices.some(
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
    const pivotScore = clamp(cluster.length / 4, 0, 1);
    const rejection = mean(cluster.map((pivot) => pivot.rejectionStrength));
    const volumeValues = cluster
      .map((pivot) => pivot.volumeConfirmation)
      .filter((value): value is number => value !== null);
    const quality = mean(cluster.map((pivot) => pivot.pivotQuality));
    const components = [
      { value: pivotScore, weight: 0.25 },
      { value: rejection, weight: 0.2 },
      { value: recency, weight: 0.15 },
      { value: quality, weight: 0.15 },
    ];
    if (volumeValues.length > 0) {
      components.push({ value: mean(volumeValues), weight: 0.15 });
    }
    if (higherTimeframeAvailable) {
      components.push({
        value: Number(higherTimeframeConfluence),
        weight: 0.1,
      });
    }
    const availableWeight = components.reduce(
      (total, component) => total + component.weight,
      0,
    );
    const strength = Math.round(
      (100 *
        components.reduce(
          (total, component) => total + component.value * component.weight,
          0,
        )) /
        availableWeight,
    );
    return {
      zoneLow: Math.min(...cluster.map((pivot) => pivot.price)),
      zoneHigh: Math.max(...cluster.map((pivot) => pivot.price)),
      representativePrice,
      pivots: cluster,
      strength,
      volumeEvidenceAvailable: volumeValues.length > 0,
      higherTimeframeAvailable,
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
      pivot_count: zone.pivots.length,
      last_tested_at:
        [...zone.pivots].sort((a, b) => b.index - a.index)[0]?.time ?? "",
      distance_percent: distancePercent,
      timeframe,
      higher_timeframe_available: zone.higherTimeframeAvailable,
      higher_timeframe_confluence: zone.higherTimeframeConfluence,
    };
  });
}

export function calculateSeededEma(
  values: number[],
  period: number,
): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  const seedIndex = period - 1;
  result[seedIndex] = mean(values.slice(0, period));
  const multiplier = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    const previous = result[index - 1];
    if (previous === null || previous === undefined) continue;
    result[index] =
      (values[index] ?? 0) * multiplier + previous * (1 - multiplier);
  }
  return result;
}

export function calculateWilderAdx(
  candles: NumericCandle[],
  period = 14,
): WilderAdxSeries {
  const length = candles.length;
  const trueRange = Array<number>(length).fill(0);
  const plusDm = Array<number>(length).fill(0);
  const minusDm = Array<number>(length).fill(0);
  for (let index = 0; index < length; index += 1) {
    const current = candles[index]!;
    const previous = candles[index - 1];
    if (!previous) {
      trueRange[index] = current.high - current.low;
      continue;
    }
    trueRange[index] = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;
    plusDm[index] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[index] = downMove > upMove && downMove > 0 ? downMove : 0;
  }
  const smoothedTrueRange: Array<number | null> = Array(length).fill(null);
  const smoothedPlusDm: Array<number | null> = Array(length).fill(null);
  const smoothedMinusDm: Array<number | null> = Array(length).fill(null);
  const plusDi: Array<number | null> = Array(length).fill(null);
  const minusDi: Array<number | null> = Array(length).fill(null);
  const dx: Array<number | null> = Array(length).fill(null);
  const adx: Array<number | null> = Array(length).fill(null);
  if (period <= 0 || length <= period) {
    return {
      trueRange,
      plusDm,
      minusDm,
      smoothedTrueRange,
      smoothedPlusDm,
      smoothedMinusDm,
      plusDi,
      minusDi,
      dx,
      adx,
    };
  }
  smoothedTrueRange[period] = sum(trueRange.slice(1, period + 1));
  smoothedPlusDm[period] = sum(plusDm.slice(1, period + 1));
  smoothedMinusDm[period] = sum(minusDm.slice(1, period + 1));
  for (let index = period; index < length; index += 1) {
    if (index > period) {
      smoothedTrueRange[index] =
        (smoothedTrueRange[index - 1] ?? 0) -
        (smoothedTrueRange[index - 1] ?? 0) / period +
        (trueRange[index] ?? 0);
      smoothedPlusDm[index] =
        (smoothedPlusDm[index - 1] ?? 0) -
        (smoothedPlusDm[index - 1] ?? 0) / period +
        (plusDm[index] ?? 0);
      smoothedMinusDm[index] =
        (smoothedMinusDm[index - 1] ?? 0) -
        (smoothedMinusDm[index - 1] ?? 0) / period +
        (minusDm[index] ?? 0);
    }
    const range = smoothedTrueRange[index] ?? 0;
    if (range <= 0) {
      plusDi[index] = 0;
      minusDi[index] = 0;
      dx[index] = 0;
      continue;
    }
    plusDi[index] = ((smoothedPlusDm[index] ?? 0) / range) * 100;
    minusDi[index] = ((smoothedMinusDm[index] ?? 0) / range) * 100;
    const total = (plusDi[index] ?? 0) + (minusDi[index] ?? 0);
    dx[index] =
      total === 0
        ? 0
        : (Math.abs((plusDi[index] ?? 0) - (minusDi[index] ?? 0)) / total) *
          100;
  }
  const firstAdxIndex = period * 2 - 1;
  if (length > firstAdxIndex) {
    adx[firstAdxIndex] = mean(
      dx
        .slice(period, firstAdxIndex + 1)
        .filter((value): value is number => value !== null),
    );
    for (let index = firstAdxIndex + 1; index < length; index += 1) {
      adx[index] =
        ((adx[index - 1] ?? 0) * (period - 1) + (dx[index] ?? 0)) / period;
    }
  }
  return {
    trueRange,
    plusDm,
    minusDm,
    smoothedTrueRange,
    smoothedPlusDm,
    smoothedMinusDm,
    plusDi,
    minusDi,
    dx,
    adx,
  };
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
    higher_timeframe_alignment: null,
  };
  if (candles.length < TREND_MIN_CANDLES) {
    return {
      direction: "unavailable",
      strength: 0,
      version: TREND_REGIME_VERSION,
      breakdown: emptyBreakdown,
      reason:
        "At least 250 closed candles are required to seed EMA 200 and retain 50 warm-up observations.",
    };
  }
  const closes = candles.map((candle) => candle.close);
  const ema20 = calculateSeededEma(closes, 20);
  const ema50 = calculateSeededEma(closes, 50);
  const ema200 = calculateSeededEma(closes, 200);
  const last = closes.at(-1) ?? 0;
  const e20 = lastNumber(ema20);
  const e50 = lastNumber(ema50);
  const e200 = lastNumber(ema200);
  const slope = (values: Array<number | null>) => {
    const available = values.filter((value): value is number => value !== null);
    const previous = available.at(-6);
    const current = available.at(-1);
    return previous === undefined || current === undefined || previous === 0
      ? 0
      : clamp(((current - previous) / previous) * 100, -1, 1);
  };
  const pivots = detectConfirmedPivots(candles);
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
  const adxSeries = calculateWilderAdx(candles, 14);
  const adxValue = lastNumber(adxSeries.adx);
  const adxDirectionalWeight = clamp(adxValue / 50, 0, 1);
  const higher =
    higherTimeframeDirection === undefined
      ? null
      : higherTimeframeDirection === "bullish"
        ? 1
        : higherTimeframeDirection === "bearish"
          ? -1
          : 0;
  const components = [
    { value: structure, weight: 0.25 },
    { value: ordering, weight: 0.25 },
    { value: slopes, weight: 0.15 },
    { value: location, weight: 0.15 },
    {
      value: Math.sign(ordering || structure) * adxDirectionalWeight,
      weight: 0.1,
    },
  ];
  if (higher !== null) components.push({ value: higher, weight: 0.1 });
  const totalWeight = components.reduce(
    (total, component) => total + component.weight,
    0,
  );
  const directionalScore =
    components.reduce(
      (total, component) => total + component.value * component.weight,
      0,
    ) / totalWeight;
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
      "Regime combines closed-candle structure, SMA-seeded EMAs, Wilder ADX and available higher-timeframe alignment.",
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
    trend: calculateTrendRegime(
      closedCandles,
      options.higherTimeframeDirection,
    ),
    version: TECHNICAL_LEVELS_VERSION,
    insufficientData:
      closedCandles.length < TREND_MIN_CANDLES || pivots.length < 2,
  };
}

function weightedPrice(pivots: ConfirmedPivot[]): number {
  const weights = pivots.map((pivot) => Math.max(pivot.pivotQuality, 0.1));
  const total = sum(weights);
  return (
    pivots.reduce(
      (totalPrice, pivot, index) =>
        totalPrice + pivot.price * (weights[index] ?? 0),
      0,
    ) / total
  );
}

function lastNumber(values: Array<number | null>): number {
  return values.findLast((value): value is number => value !== null) ?? 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
