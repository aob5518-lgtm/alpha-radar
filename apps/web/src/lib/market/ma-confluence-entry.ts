import type { MarketInterval } from "@alpha-radar/types/market-data";
import type { TechnicalContextSnapshot } from "./technical-context.ts";
import {
  calculateAtrSeries,
  calculateSeededEma,
  detectConfirmedPivots,
} from "./technical-levels.ts";

export const MA_ENTRY_VERSION = "ma-confluence-entry-v1" as const;
export const MA_RULES = {
  defaultPeriod: 99,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  minimumPeriod: 10,
  maximumPeriod: 250,
  maximumCandles: 800,
  slopeLookback: 10,
  slopeAtr: 0.15,
  zoneAtr: 0.2,
  impulseLookback: 24,
  impulseAtr: 1,
  retestLookback: 3,
  chopLookback: 12,
  sideCloses: 3,
  crosses: 3,
  maximumTouches: 4,
  maximumEpisodes: 2,
  maximumExtensionAtr: 1,
  roomAtr: 0.9,
  invalidationAtr: 0.25,
  neutralStrength: 50,
  volumeLookback: 20,
  minimumVolumeBars: 10,
  volumeRatio: 0.8,
  explosiveVolumeRatio: 1.8,
  macdToleranceAtr: 0.02,
  macdConflictAtr: 0.1,
  closeStrength: 0.65,
  candidateScore: 65,
  triggerScore: 80,
  weights: {
    trend: 20,
    slope: 15,
    impulse: 15,
    retest: 10,
    confirmation: 15,
    macd: 10,
    volume: 10,
    structure: 5,
  },
} as const;
export interface MaSettings {
  period: number;
  type: "SMA" | "EMA";
  enabled: boolean;
}
export const DEFAULT_MA: MaSettings = {
  period: 99,
  type: "SMA",
  enabled: true,
};
export type MaState =
  | "disabled"
  | "no_setup"
  | "observe_long"
  | "observe_short"
  | "candidate_long"
  | "candidate_short"
  | "trigger_long"
  | "trigger_short"
  | "invalidated";
export const maReasons = [
  "insufficient_history",
  "flat_ma",
  "trend_conflict",
  "repeated_crosses",
  "excess_retests",
  "no_impulse",
  "no_retest",
  "near_obstruction",
  "no_target",
  "weak_confirmation",
  "weak_volume",
  "missing_volume",
  "macd_conflict",
  "macd_unready",
  "overextended",
  "level_failed",
  "trend_aligned",
  "slope_aligned",
  "impulse_retest",
  "price_confirmed",
  "macd_aligned",
  "volume_healthy",
  "structure_aligned",
] as const;
export type MaReason = (typeof maReasons)[number];
export interface MaEntryAnalysis {
  algorithm_version: typeof MA_ENTRY_VERSION;
  market_instrument_id: string;
  timeframe: MarketInterval;
  settings: MaSettings;
  confirmed_at: string;
  candle_open_time: string;
  state: MaState;
  setup_direction: "long" | "short" | "none";
  confidence_score: number;
  quality_tier: "A" | "B" | "C" | "none";
  reason_codes: MaReason[];
  explanation_lines: string[];
  setup_type: "ma_pullback_long" | "ma_rejection_short" | null;
  ma_value: number | null;
  ma_slope: "rising" | "falling" | "flat";
  ma_zone_low: number | null;
  ma_zone_high: number | null;
  line: Array<{ time: string; value: number }>;
  entry_zone: { low: number; high: number } | null;
  trigger_price: number | null;
  invalidation_price: number | null;
  first_target: number | null;
  diagnostics: {
    crosses: number;
    touches: number;
    episodes: number;
    histogram: number | null;
    volume_ratio: number | null;
  };
}
export function validMaSettings(value: unknown): MaSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_MA };
  const input = value as Partial<MaSettings>;
  return {
    period:
      Number.isInteger(input.period) &&
      input.period! >= MA_RULES.minimumPeriod &&
      input.period! <= MA_RULES.maximumPeriod
        ? input.period!
        : DEFAULT_MA.period,
    type: input.type === "EMA" ? "EMA" : "SMA",
    enabled: input.enabled !== false,
  };
}
export function movingAverage(
  values: number[],
  settings: MaSettings,
): Array<number | null> {
  if (settings.type === "EMA")
    return calculateSeededEma(values, settings.period);
  let sum = 0;
  return values.map((value, index) => {
    sum += value;
    if (index >= settings.period) sum -= values[index - settings.period]!;
    return index >= settings.period - 1 ? sum / settings.period : null;
  });
}
export function macd(values: number[]) {
  const fast = calculateSeededEma(values, MA_RULES.macdFast),
    slow = calculateSeededEma(values, MA_RULES.macdSlow);
  const dif = values.map((_, i) =>
    fast[i] !== null && slow[i] !== null ? fast[i]! - slow[i]! : null,
  );
  const seeded = calculateSeededEma(
    dif.filter((v): v is number => v !== null),
    MA_RULES.macdSignal,
  );
  return dif.map((value, i) => ({
    dif: value,
    dea:
      i >= MA_RULES.macdSlow - 1
        ? (seeded[i - (MA_RULES.macdSlow - 1)] ?? null)
        : null,
    histogram:
      value !== null &&
      i >= MA_RULES.macdSlow - 1 &&
      seeded[i - (MA_RULES.macdSlow - 1)] !== null &&
      seeded[i - (MA_RULES.macdSlow - 1)] !== undefined
        ? value - seeded[i - (MA_RULES.macdSlow - 1)]!
        : null,
  }));
}
const mean = (values: number[]) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
/** Independent heuristic rule-match score, NOT probability or an execution order.
 * Linear indicators + one existing bounded pivot pass. No historical engine replay. */
export function calculateMaEntry(
  snapshot: TechnicalContextSnapshot,
  id: string,
  timeframe: MarketInterval,
  input: MaSettings = DEFAULT_MA,
): MaEntryAnalysis {
  const settings = validMaSettings(input),
    r = MA_RULES;
  const candles = snapshot.closedCandles
      .filter((c) => c.isClosed)
      .slice(-r.maximumCandles),
    last = candles.at(-1),
    previous = candles.at(-2);
  const averages = movingAverage(
      candles.map((c) => c.close),
      settings,
    ),
    atrSeries = calculateAtrSeries(candles),
    atr = atrSeries.at(-1) ?? 0;
  const ma = averages.at(-1) ?? null;
  const result: MaEntryAnalysis = {
    algorithm_version: MA_ENTRY_VERSION,
    market_instrument_id: id,
    timeframe,
    settings,
    confirmed_at: last?.closeTime ?? "",
    candle_open_time: last?.openTime ?? "",
    state: settings.enabled ? "no_setup" : "disabled",
    setup_direction: "none",
    confidence_score: 0,
    quality_tier: "none",
    reason_codes: [],
    explanation_lines: [],
    setup_type: null,
    ma_value: ma,
    ma_slope: "flat",
    ma_zone_low: ma !== null ? ma - r.zoneAtr * atr : null,
    ma_zone_high: ma !== null ? ma + r.zoneAtr * atr : null,
    line: averages.flatMap((value, i) =>
      value === null ? [] : [{ time: candles[i]!.openTime, value }],
    ),
    entry_zone: null,
    trigger_price: null,
    invalidation_price: null,
    first_target: null,
    diagnostics: {
      crosses: 0,
      touches: 0,
      episodes: 0,
      histogram: null,
      volume_ratio: null,
    },
  };
  const finish = (reasons: MaReason[]) => {
    result.reason_codes = [...new Set(reasons)];
    result.explanation_lines = result.reason_codes.map((code) =>
      code.replaceAll("_", " "),
    );
    return result;
  };
  if (!settings.enabled) return finish([]);
  const priorMa = averages.at(-(r.slopeLookback + 1));
  if (
    !last ||
    !previous ||
    ma === null ||
    priorMa == null ||
    atr <= 0 ||
    snapshot.trend.direction === "unavailable"
  )
    return finish(["insufficient_history"]);
  const slope = (ma - priorMa) / atr;
  result.ma_slope =
    slope >= r.slopeAtr ? "rising" : slope <= -r.slopeAtr ? "falling" : "flat";
  const trend = snapshot.trend,
    structure = trend.breakdown.market_structure;
  const direction =
    trend.direction === "bullish"
      ? 1
      : trend.direction === "bearish"
        ? -1
        : trend.strength >= r.neutralStrength && structure !== 0
          ? Math.sign(structure)
          : 0;
  if (!direction) return finish(["trend_conflict"]);
  result.setup_direction = direction === 1 ? "long" : "short";
  result.state = direction === 1 ? "observe_long" : "observe_short";
  const reasons: MaReason[] = [];
  if (result.ma_slope === "flat") reasons.push("flat_ma");
  else if (direction * slope < 0) reasons.push("trend_conflict");
  let above = 0,
    below = 0,
    crosses = 0,
    touches = 0,
    episodes = 0,
    priorSide = 0,
    wasTouch = false;
  for (
    let i = Math.max(0, candles.length - r.chopLookback);
    i < candles.length;
    i++
  ) {
    const average = averages[i];
    if (average == null) continue;
    const c = candles[i]!,
      width = r.zoneAtr * (atrSeries[i] ?? atr),
      side = Math.sign(c.close - average);
    if (side > 0) above++;
    if (side < 0) below++;
    if (priorSide && side && side !== priorSide) crosses++;
    if (side) priorSide = side;
    const touch = c.low <= average + width && c.high >= average - width;
    if (touch) touches++;
    if (touch && !wasTouch) episodes++;
    wasTouch = touch;
  }
  result.diagnostics = { ...result.diagnostics, crosses, touches, episodes };
  if ((above >= r.sideCloses && below >= r.sideCloses) || crosses >= r.crosses)
    reasons.push("repeated_crosses");
  if (touches > r.maximumTouches || episodes > r.maximumEpisodes)
    reasons.push("excess_retests");
  let impulse = -1;
  for (
    let i = Math.max(0, candles.length - r.impulseLookback);
    i < candles.length - r.retestLookback;
    i++
  )
    if (
      averages[i] != null &&
      direction * (candles[i]!.close - averages[i]!) >=
        r.impulseAtr * (atrSeries[i] ?? atr)
    )
      impulse = i;
  if (impulse < 0) reasons.push("no_impulse");
  const retests = candles
    .map((c, i) => ({ c, i }))
    .filter(
      ({ c, i }) =>
        i > impulse &&
        i >= candles.length - r.retestLookback &&
        averages[i] != null &&
        c.low <= averages[i]! + r.zoneAtr * (atrSeries[i] ?? atr) &&
        c.high >= averages[i]! - r.zoneAtr * (atrSeries[i] ?? atr),
    );
  if (!retests.length) reasons.push("no_retest");
  const low = result.ma_zone_low!,
    high = result.ma_zone_high!;
  const trigger =
    direction === 1
      ? Math.max(high, previous.high)
      : Math.min(low, previous.low);
  const invalidation =
    direction === 1
      ? Math.min(
          low,
          ...retests
            .filter((v) => v.i < candles.length - 1)
            .map((v) => v.c.low),
        ) -
        r.invalidationAtr * atr
      : Math.max(
          high,
          ...retests
            .filter((v) => v.i < candles.length - 1)
            .map((v) => v.c.high),
        ) +
        r.invalidationAtr * atr;
  if (retests.length && direction * (last.close - invalidation) <= 0) {
    result.state = "invalidated";
    return finish(["level_failed"]);
  }
  if (direction * (last.close - ma) > r.maximumExtensionAtr * atr)
    reasons.push("overextended");
  const pivots = detectConfirmedPivots(candles);
  const barriers =
    direction === 1
      ? [
          ...snapshot.resistances.map((l) => l.zone_low),
          ...pivots.filter((p) => p.side === "high").map((p) => p.price),
        ]
      : [
          ...snapshot.supports.map((l) => l.zone_high),
          ...pivots.filter((p) => p.side === "low").map((p) => p.price),
        ];
  const ahead = barriers
    .filter((p) => direction * (p - ma) > 0)
    .sort((a, b) => direction * (a - b));
  const target = ahead[0] ?? null;
  if (target === null) reasons.push("no_target");
  else if (
    direction *
      (target -
        (direction === 1
          ? Math.max(last.close, trigger, high)
          : Math.min(last.close, trigger, low))) <
    r.roomAtr * atr
  )
    reasons.push("near_obstruction");
  const momentum = macd(candles.map((c) => c.close)),
    hist = momentum.at(-1)?.histogram ?? null,
    previousHist = momentum.at(-2)?.histogram ?? null;
  result.diagnostics.histogram = hist;
  const macdAligned =
    hist !== null &&
    previousHist !== null &&
    direction * hist >= -r.macdConflictAtr * atr &&
    direction * (hist - previousHist) >= -r.macdToleranceAtr * atr;
  if (hist === null || previousHist === null) reasons.push("macd_unready");
  else if (!macdAligned) reasons.push("macd_conflict");
  const volumes = candles
    .slice(-(r.volumeLookback + 1), -1)
    .map((c) => c.volume)
    .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  const averageVolume = mean(volumes),
    pullbackVolume = mean(
      candles
        .slice(-4, -1)
        .flatMap((c) => (c.volume === null ? [] : [c.volume])),
    );
  const explosive = candles
    .slice(-4, -1)
    .filter(
      (c) =>
        direction * (c.close - c.open) < 0 &&
        (c.volume ?? 0) > r.explosiveVolumeRatio * averageVolume,
    );
  const volumeHealthy =
    volumes.length >= r.minimumVolumeBars &&
    last.volume !== null &&
    last.volume > 0 &&
    last.volume >=
      r.volumeRatio *
        Math.max(
          averageVolume,
          pullbackVolume,
          ...explosive.map((c) => c.volume ?? 0),
        );
  result.diagnostics.volume_ratio =
    last.volume !== null && averageVolume > 0
      ? last.volume / averageVolume
      : null;
  if (volumes.length < r.minimumVolumeBars || last.volume === null)
    reasons.push("missing_volume");
  else if (!volumeHealthy) reasons.push("weak_volume");
  const closeLocation =
    (last.close - last.low) / Math.max(last.high - last.low, Number.EPSILON);
  const confirmed =
    direction * (last.close - last.open) > 0 &&
    direction * (last.close - trigger) >= 0 &&
    (direction === 1
      ? closeLocation >= r.closeStrength
      : closeLocation <= 1 - r.closeStrength);
  if (!confirmed) reasons.push("weak_confirmation");
  const alignedLevel =
    (direction === 1 ? snapshot.supports : snapshot.resistances)
      .slice(0, 2)
      .some((l) => l.zone_low <= high && l.zone_high >= low) ||
    snapshot.state.phase ===
      (direction === 1 ? "support_confirmed" : "resistance_confirmed");
  const w = r.weights;
  const score =
    w.trend +
    (direction * slope >= r.slopeAtr ? w.slope : 0) +
    (impulse >= 0 ? w.impulse : 0) +
    (retests.length ? w.retest : 0) +
    (confirmed ? w.confirmation : 0) +
    (macdAligned ? w.macd : 0) +
    (volumeHealthy ? w.volume : 0) +
    (alignedLevel ? w.structure : 0);
  result.confidence_score = score;
  result.quality_tier =
    score >= r.triggerScore ? "A" : score >= r.candidateScore ? "B" : "C";
  // Every adverse filter blocks promoted states; missing volume is not fabricated.
  if (reasons.some((reason) => reason !== "weak_confirmation")) {
    result.confidence_score = Math.min(score, r.candidateScore - 1);
    result.quality_tier = "C";
    return finish(reasons);
  }
  result.entry_zone = { low, high };
  result.trigger_price = trigger;
  result.invalidation_price = invalidation;
  result.first_target = target;
  result.setup_type =
    direction === 1 ? "ma_pullback_long" : "ma_rejection_short";
  const previousAverage = averages.at(-2)!,
    previousAtr = atrSeries.at(-2) ?? atr;
  const fresh =
    direction * (previous.close - previousAverage) <= r.zoneAtr * previousAtr ||
    retests.some((v) => v.i === candles.length - 1);
  result.state =
    score >= r.triggerScore && confirmed && fresh
      ? direction === 1
        ? "trigger_long"
        : "trigger_short"
      : score >= r.candidateScore
        ? direction === 1
          ? "candidate_long"
          : "candidate_short"
        : result.state;
  return finish([
    ...reasons,
    "trend_aligned",
    "slope_aligned",
    "impulse_retest",
    ...(confirmed ? ["price_confirmed" as const] : []),
    "macd_aligned",
    "volume_healthy",
    ...(alignedLevel ? ["structure_aligned" as const] : []),
  ]);
}

export function maMatchesIdentity(
  value: MaEntryAnalysis | undefined,
  id: string,
  interval: MarketInterval,
) {
  return (
    value !== undefined &&
    value.market_instrument_id === id &&
    value.timeframe === interval
  );
}
