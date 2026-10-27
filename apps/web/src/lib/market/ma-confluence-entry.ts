import type { MarketInterval } from "@alpha-radar/types/market-data";
import {
  scoreEvidence,
  type EntryEvidence,
  type EvidenceFacts,
} from "./entry-evidence.ts";
import type { TechnicalContextSnapshot } from "./technical-context.ts";
import {
  calculateAtrSeries,
  calculateSeededEma,
  detectConfirmedPivots,
} from "./technical-levels.ts";

export const MA_ENTRY_VERSION = "ma-confluence-entry-v1.2" as const;
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
  candidateScore: 60,
  triggerScore: 70,
  weights: {
    trend: 20,
    ma: 15,
    state: 15,
    price: 15,
    macd: 10,
    volume: 10,
    structure: 15,
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
  "opposing_volume",
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
  setup_type: EntryStructure | null;
  hard_failures: HardFailure[];
  evidence: EntryEvidence[];
  price_confirmed: boolean;
  structure_origin: string;
  atr: number;
  observed_targets: Array<{
    price: number;
    source: `R${number}` | `S${number}` | "swing-high" | "swing-low";
  }>;
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
export type EntryStructure =
  | "ma_pullback_long"
  | "ma_rejection_short"
  | "support_pullback"
  | "resistance_rejection"
  | "breakout_retest"
  | "breakdown_retest";
export type HardFailure =
  | "insufficient_history"
  | "context_mismatch"
  | "trend_conflict"
  | "repeated_crosses"
  | "excess_retests"
  | "no_retest"
  | "level_failed"
  | "no_target"
  | "macd_conflict"
  | "opposing_volume"
  | "overextended"
  | "expired";
type Zone = { low: number; high: number };
/** Pure, bounded V1.2 evaluation of the accepted closed technical snapshot.
 * Indicators run once; no technical-engine calls, prefix replay, clocks or hidden cursor. */
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
    .slice(-r.maximumCandles);
  const last = candles.at(-1),
    previous = candles.at(-2);
  const averages = movingAverage(
    candles.map((c) => c.close),
    settings,
  );
  const atrSeries = calculateAtrSeries(candles),
    atr = atrSeries.at(-1) ?? 0;
  const ma = averages.at(-1) ?? null,
    priorMa = averages.at(-(r.slopeLookback + 1));
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
    hard_failures: [],
    evidence: [],
    price_confirmed: false,
    structure_origin: "",
    atr,
    observed_targets: [],
    ma_value: ma,
    ma_slope: "flat",
    ma_zone_low: ma === null ? null : ma - r.zoneAtr * atr,
    ma_zone_high: ma === null ? null : ma + r.zoneAtr * atr,
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
  const finish = () => {
    result.reason_codes = [...new Set(result.reason_codes)];
    result.explanation_lines = result.reason_codes.map((c) =>
      c.replaceAll("_", " "),
    );
    return result;
  };
  const fail = (reason: HardFailure, display?: MaReason) => {
    result.hard_failures.push(reason);
    if (display) result.reason_codes.push(display);
  };
  if (!settings.enabled) return finish();
  if (
    !last ||
    !previous ||
    ma === null ||
    priorMa == null ||
    atr <= 0 ||
    candles.length < Math.max(250, settings.period + r.slopeLookback) ||
    snapshot.trend.direction === "unavailable"
  ) {
    fail("insufficient_history", "insufficient_history");
    return finish();
  }
  if (snapshot.state.confirmed_at !== last.closeTime) {
    fail("context_mismatch");
    return finish();
  }
  const slope = (ma - priorMa) / atr;
  result.ma_slope =
    slope >= r.slopeAtr ? "rising" : slope <= -r.slopeAtr ? "falling" : "flat";
  const trend = snapshot.trend,
    state = snapshot.state,
    structure = trend.breakdown.market_structure;
  const sign =
    trend.direction === "bullish"
      ? 1
      : trend.direction === "bearish"
        ? -1
        : structure > 0 && slope >= r.slopeAtr && state.direction !== "bearish"
          ? 1
          : structure < 0 &&
              slope <= -r.slopeAtr &&
              state.direction !== "bullish"
            ? -1
            : 0;
  if (!sign) {
    fail("trend_conflict", "trend_conflict");
    return finish();
  }
  const long = sign === 1;
  result.setup_direction = long ? "long" : "short";
  result.state = long ? "observe_long" : "observe_short";
  // Neutral/pullback is supporting evidence. Explicit opposite confirmed direction is a safety veto.
  if (
    state.direction === (long ? "bearish" : "bullish") &&
    [
      "reversal_confirmed_up",
      "reversal_confirmed_down",
      "sharp_drop",
      "sharp_rise",
      "support_confirmed",
      "resistance_confirmed",
    ].includes(state.phase)
  )
    fail("trend_conflict", "trend_conflict");
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
    const avg = averages[i];
    if (avg == null) continue;
    const c = candles[i]!,
      width = r.zoneAtr * (atrSeries[i] ?? atr),
      side = Math.sign(c.close - avg);
    if (side > 0) above++;
    if (side < 0) below++;
    if (priorSide && side && side !== priorSide) crosses++;
    if (side) priorSide = side;
    const touch = c.low <= avg + width && c.high >= avg - width;
    if (touch) touches++;
    if (touch && !wasTouch) episodes++;
    wasTouch = touch;
  }
  Object.assign(result.diagnostics, { crosses, touches, episodes });
  if ((above >= r.sideCloses && below >= r.sideCloses) || crosses >= r.crosses)
    fail("repeated_crosses", "repeated_crosses");
  if (touches > r.maximumTouches || episodes > r.maximumEpisodes)
    fail("excess_retests", "excess_retests");
  if (result.ma_slope === "flat") result.reason_codes.push("flat_ma");
  const firstRecent = Math.max(0, candles.length - r.retestLookback);
  const tests = (zone: Zone) =>
    candles.flatMap((c, i) =>
      i >= firstRecent && c.low <= zone.high && c.high >= zone.low ? [i] : [],
    );
  type Structure = {
    zone: Zone;
    indices: number[];
    type: EntryStructure;
    confluence: boolean;
    rank: number;
  };
  const choices: Structure[] = [];
  const maZone = { low: result.ma_zone_low!, high: result.ma_zone_high! };
  // MA interactions retain the original impulse and contemporary-zone requirements.
  let impulse = -1;
  for (
    let i = Math.max(0, candles.length - r.impulseLookback);
    i < firstRecent;
    i++
  )
    if (
      averages[i] != null &&
      sign * (candles[i]!.close - averages[i]!) >=
        r.impulseAtr * (atrSeries[i] ?? atr)
    )
      impulse = i;
  const maTests = candles.flatMap((c, i) =>
    i >= firstRecent &&
    i > impulse &&
    averages[i] != null &&
    c.low <= averages[i]! + r.zoneAtr * (atrSeries[i] ?? atr) &&
    c.high >= averages[i]! - r.zoneAtr * (atrSeries[i] ?? atr)
      ? [i]
      : [],
  );
  const levels = (long ? snapshot.supports : snapshot.resistances)
    .filter((l) => l.timeframe === timeframe)
    .slice(0, 2);
  for (const level of levels) {
    const zone = { low: level.zone_low, high: level.zone_high },
      indices = tests(zone);
    if (!indices.length) continue;
    const reference = state.reference_level;
    const matched =
      reference?.kind === level.kind &&
      reference.zone_low <= zone.high &&
      reference.zone_high >= zone.low;
    const phaseConfirmed =
      state.phase === (long ? "support_confirmed" : "resistance_confirmed") &&
      matched;
    const controlled = state.phase === (long ? "pullback" : "rebound");
    // Existing canonical zones + a closed interaction; neither an arbitrary price nor a new level detector.
    if (!phaseConfirmed && !controlled) continue;
    const confluence = zone.low <= maZone.high && zone.high >= maZone.low;
    choices.push({
      zone,
      indices,
      type: long ? "support_pullback" : "resistance_rejection",
      confluence,
      rank: confluence ? 0 : 1,
    });
  }
  // Only a swing break already detected by Market State may form a reclaimed-level retest.
  const broken = state.evidence?.find(
    (e) => e.code === "swing_break" && e.direction === (long ? "up" : "down"),
  )?.value;
  if (
    broken != null &&
    broken > 0 &&
    state.evidence?.some((e) => e.code === "structure_held") &&
    state.phase === (long ? "reversal_confirmed_up" : "reversal_confirmed_down")
  ) {
    const zone = {
      low: broken - r.zoneAtr * atr,
      high: broken + r.zoneAtr * atr,
    };
    const indices = tests(zone).filter((i) =>
      candles
        .slice(Math.max(0, i - r.impulseLookback), i)
        .some((c) => sign * (c.close - (long ? zone.high : zone.low)) > 0),
    );
    if (indices.length)
      choices.push({
        zone,
        indices,
        type: long ? "breakout_retest" : "breakdown_retest",
        confluence: false,
        rank: 2,
      });
  }
  if (impulse >= 0 && maTests.length) {
    const confluence = levels.some(
      (l) => l.zone_low <= maZone.high && l.zone_high >= maZone.low,
    );
    choices.push({
      zone: maZone,
      indices: maTests,
      type: long ? "ma_pullback_long" : "ma_rejection_short",
      confluence,
      rank: confluence ? 0 : 3,
    });
  }
  const momentum = macd(candles.map((c) => c.close)),
    hist = momentum.at(-1)?.histogram ?? null,
    prevHist = momentum.at(-2)?.histogram ?? null;
  result.diagnostics.histogram = hist;
  const h = hist === null ? 0 : (sign * hist) / atr,
    delta =
      hist === null || prevHist === null ? 0 : (sign * (hist - prevHist)) / atr;
  // BOTH materially opposing histogram and accelerating opposition, not ordinary lag.
  if (
    hist !== null &&
    prevHist !== null &&
    h < -r.macdConflictAtr &&
    delta < -r.macdToleranceAtr
  )
    fail("macd_conflict", "macd_conflict");
  const vols = candles
    .slice(-(r.volumeLookback + 1), -1)
    .flatMap((c) => (c.volume !== null && c.volume > 0 ? [c.volume] : []));
  const avg = mean(vols),
    ratio = last.volume !== null && avg > 0 ? last.volume / avg : null;
  result.diagnostics.volume_ratio = ratio;
  const opposing = candles
    .slice(-r.retestLookback)
    .some(
      (c) =>
        avg > 0 &&
        sign * (c.close - c.open) < 0 &&
        (c.volume ?? 0) > r.explosiveVolumeRatio * avg &&
        sign * (last.close - c.open) < 0,
    );
  if (opposing) fail("opposing_volume", "opposing_volume");
  const selected = choices.sort((a, b) => a.rank - b.rank)[0];
  if (!selected) {
    fail("no_retest", "no_retest");
    return finish();
  }
  const { zone, indices } = selected,
    edge = long ? zone.high : zone.low;
  result.setup_type = selected.type;
  // A continuous interaction has one origin, not a fresh setup every rolling bar.
  let origin = indices[0]!;
  while (
    origin > 0 &&
    candles[origin - 1]!.low <= zone.high &&
    candles[origin - 1]!.high >= zone.low
  )
    origin--;
  result.structure_origin = candles[origin]!.openTime;
  // Invalidation uses prior retest extrema and boundary, with the original ATR buffer exactly once.
  const priorTests = indices
    .filter((i) => i < candles.length - 1)
    .map((i) => candles[i]!);
  const overlapping = levels.filter(
    (l) => l.zone_low <= zone.high && l.zone_high >= zone.low,
  );
  const boundary = long
    ? Math.min(
        zone.low,
        ...priorTests.map((c) => c.low),
        ...overlapping.map((l) => l.zone_low),
      )
    : Math.max(
        zone.high,
        ...priorTests.map((c) => c.high),
        ...overlapping.map((l) => l.zone_high),
      );
  const stop = boundary - sign * r.invalidationAtr * atr;
  const isMa =
    selected.type === "ma_pullback_long" ||
    selected.type === "ma_rejection_short";
  const entry = isMa
    ? long
      ? Math.max(edge, previous.high)
      : Math.min(edge, previous.low)
    : zone.low + (long ? 0.75 : 0.25) * (zone.high - zone.low);
  result.entry_zone = zone;
  result.trigger_price = entry;
  result.invalidation_price = stop;
  if (sign * (last.close - stop) <= 0 || sign * (entry - stop) <= 0) {
    fail("level_failed", "level_failed");
    result.state = "invalidated";
  }
  if (sign * (last.close - edge) > r.maximumExtensionAtr * atr)
    fail("overextended", "overextended");
  // No additional minimum-room veto: authoritative stop + real forward TP1 determine R:R in Guide.
  const pivots = detectConfirmedPivots(candles);
  const targets: MaEntryAnalysis["observed_targets"] = [
    ...(long ? snapshot.resistances : snapshot.supports)
      .filter((l) => l.timeframe === timeframe)
      .map((l) => ({
        price: long ? l.zone_low : l.zone_high,
        source: l.label,
      })),
    ...pivots
      .filter((p) => p.side === (long ? "high" : "low"))
      .map((p) => ({
        price: p.price,
        source: (long ? "swing-high" : "swing-low") as
          | "swing-high"
          | "swing-low",
      })),
  ];
  result.observed_targets = targets
    .filter(
      (t) =>
        Number.isFinite(t.price) &&
        t.price > 0 &&
        sign *
          (t.price -
            (long ? Math.max(entry, zone.high) : Math.min(entry, zone.low))) >
          0,
    )
    .sort((a, b) => sign * (a.price - b.price))
    .filter(
      (t, i, a) =>
        !i ||
        Math.abs(t.price - a[i - 1]!.price) > Number.EPSILON * t.price * 8,
    );
  result.first_target = result.observed_targets[0]?.price ?? null;
  if (result.first_target === null) fail("no_target", "no_target");
  const location =
    (sign * (last.close - last.low)) /
    Math.max(last.high - last.low, Number.EPSILON);
  const directionalLocation = long ? location : 1 + location;
  const reclaimed =
    sign * (last.close - edge) >= 0 && sign * (last.close - last.open) > 0;
  const breakPrevious =
    sign * (last.close - (long ? previous.high : previous.low)) >= 0;
  const pa: EvidenceFacts["price"] =
    reclaimed && directionalLocation >= r.closeStrength
      ? breakPrevious
        ? "strong"
        : "good"
      : reclaimed && directionalLocation >= 0.5
        ? "acceptable"
        : "weak";
  result.price_confirmed = pa !== "weak";
  if (!result.price_confirmed) result.reason_codes.push("weak_confirmation");
  const aligned = sign * slope >= r.slopeAtr;
  const confirmedPhase =
    state.phase === (long ? "support_confirmed" : "resistance_confirmed");
  const stateScore: EvidenceFacts["state"] = confirmedPhase
    ? "confirmed"
    : [
          long ? "pullback" : "rebound",
          long ? "reversal_confirmed_up" : "reversal_confirmed_down",
        ].includes(state.phase)
      ? "pullback"
      : state.phase === (long ? "bottoming" : "topping")
        ? "bottoming"
        : state.direction === (long ? "bearish" : "bullish")
          ? "opposed"
          : "neutral";
  const scored = scoreEvidence({
    trend:
      trend.direction === "neutral"
        ? "neutral"
        : trend.strength >= r.neutralStrength
          ? "strong"
          : "weak",
    ma: aligned
      ? selected.confluence || isMa
        ? "confluence"
        : "aligned"
      : "flat",
    state: stateScore,
    macd:
      hist === null || prevHist === null
        ? "neutral"
        : h > r.macdConflictAtr && delta >= 0
          ? "strong"
          : h >= -r.macdToleranceAtr && delta > 0
            ? "improving"
            : Math.abs(h) <= r.macdConflictAtr
              ? "neutral"
              : "conflict",
    volume:
      ratio === null || vols.length < r.minimumVolumeBars
        ? "weak"
        : ratio >= r.explosiveVolumeRatio
          ? "expansion"
          : ratio >= r.volumeRatio
            ? "normal"
            : ratio >= 0.5
              ? "light"
              : "weak",
    structure: selected.confluence
      ? "confluence"
      : selected.rank === 2
        ? "breakout"
        : selected.rank === 1
          ? "structural"
          : "weak",
    price: pa,
  });
  result.evidence = scored.evidence;
  result.confidence_score = scored.score;
  result.quality_tier = scored.grade;
  if (!result.hard_failures.length) {
    result.state =
      result.price_confirmed && scored.score >= 70
        ? long
          ? "trigger_long"
          : "trigger_short"
        : long
          ? "candidate_long"
          : "candidate_short";
    result.reason_codes.push(
      "trend_aligned",
      ...(aligned ? ["slope_aligned" as const] : []),
      ...(result.price_confirmed ? ["price_confirmed" as const] : []),
      "structure_aligned",
    );
  }
  return finish();
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
