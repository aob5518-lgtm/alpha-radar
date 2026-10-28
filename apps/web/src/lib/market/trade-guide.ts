import type { TradeSetupCandidateV1 } from "@alpha-radar/types/core-3";
import type { MarketInterval } from "@alpha-radar/types/market-data";
import {
  MA_RULES,
  maMatchesIdentity,
  type MaEntryAnalysis,
} from "./ma-confluence-entry.ts";
import { tradeSetupMatchesIdentity } from "./trade-setup.ts";
import type { TechnicalContextSnapshot } from "./technical-context.ts";
import { EVIDENCE_RULES, type EntryEvidence } from "./entry-evidence.ts";
import { intervalSeconds } from "./intervals.ts";

export const TRADE_GUIDE_VERSION = "trade-guide-v1.1" as const;
export const GUIDE_RULES = {
  minimumRR: 1.2,
  readyRR: 1.5,
  favorableRR: 2,
} as const;
export type GuideState =
  | "LONG_READY"
  | "SHORT_READY"
  | "WATCH_LONG"
  | "WATCH_SHORT"
  | "WAIT"
  | "MISSED";
export type GuideAction =
  | "consider_long"
  | "consider_short"
  | "wait_pullback"
  | "wait_rejection"
  | "wait"
  | "no_chase_long"
  | "no_chase_short";
export type GuideReason =
  | "unavailable"
  | "identity_mismatch"
  | "context_mismatch"
  | "conflict"
  | "noise"
  | "invalidated"
  | "no_target"
  | "invalid_risk"
  | "poor_rr"
  | "watch_rr"
  | "confirmation_pending"
  | "confirmed"
  | "extended"
  | "target_reached";
export type TargetSource =
  | `R${number}`
  | `S${number}`
  | "swing-high"
  | "swing-low";
export interface TradeGuideV1 {
  algorithm_version: typeof TRADE_GUIDE_VERSION;
  market_instrument_id: string;
  timeframe: MarketInterval;
  confirmed_at: string;
  candle_open_time: string;
  ma_settings_key: string;
  state: GuideState;
  direction: "long" | "short" | "none";
  entry_zone_low: number | null;
  entry_zone_high: number | null;
  reference_entry_price: number | null;
  stop_price: number | null;
  stop_reason: "below_retest_support" | "above_retest_resistance" | null;
  tp1_price: number | null;
  tp1_source: TargetSource | null;
  tp2_price: number | null;
  tp2_source: TargetSource | null;
  reward_risk_tp1: number | null;
  favorable_reward_risk: boolean;
  next_action: GuideAction;
  reason_codes: GuideReason[];
  quality_grade: "A" | "B" | "C" | "none";
  evidence_score: number;
  evidence: EntryEvidence[];
  entry_structure: MaEntryAnalysis["setup_type"];
  structure_origin: string;
  hard_failures: string[];
}
export function guideMatchesIdentity(
  value: TradeGuideV1 | undefined,
  id: string,
  timeframe: MarketInterval,
) {
  return value?.market_instrument_id === id && value.timeframe === timeframe;
}
export function guideReady(value: TradeGuideV1) {
  return value.state === "LONG_READY" || value.state === "SHORT_READY";
}
/** Same explicit reducer for committed UI contexts and historical closed-prefix replay. */
export function retainGuideEvidence(
  previous: TradeGuideV1 | undefined,
  next: TradeGuideV1 | undefined,
) {
  if (!next) return undefined;
  if (guideReady(next) || next.state === "MISSED") return next;
  if (
    previous &&
    (!guideMatchesIdentity(
      previous,
      next.market_instrument_id,
      next.timeframe,
    ) ||
      previous.ma_settings_key !== next.ma_settings_key)
  )
    return undefined;
  if (
    previous?.state === "MISSED" &&
    guideMatchesIdentity(previous, next.market_instrument_id, next.timeframe) &&
    previous.ma_settings_key === next.ma_settings_key &&
    Date.parse(next.confirmed_at) - Date.parse(previous.structure_origin) <=
      (MA_RULES.retestLookback + 1) * intervalSeconds[next.timeframe] * 1000
  )
    return previous;
  return next.state === "WAIT" ? undefined : previous;
}
const positive = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value > 0;
/** V1.1 plan aggregation: strict safety first, evidence can only qualify safe plans.
 * No indicator/technical-engine/provider call. Prior evidence is explicit and bounded. */
export function calculateTradeGuide(
  snapshot: TechnicalContextSnapshot,
  ma: MaEntryAnalysis,
  setup: TradeSetupCandidateV1 | undefined,
  id: string,
  timeframe: MarketInterval,
  previous?: TradeGuideV1,
): TradeGuideV1 {
  const candles = snapshot.closedCandles.filter((c) => c.isClosed),
    last = candles.at(-1);
  const empty: TradeGuideV1 = {
    algorithm_version: TRADE_GUIDE_VERSION,
    market_instrument_id: id,
    timeframe,
    confirmed_at: last?.closeTime ?? "",
    candle_open_time: last?.openTime ?? "",
    ma_settings_key: `${ma.settings.type}:${ma.settings.period}:${ma.settings.enabled}`,
    state: "WAIT",
    direction: "none",
    entry_zone_low: null,
    entry_zone_high: null,
    reference_entry_price: null,
    stop_price: null,
    stop_reason: null,
    tp1_price: null,
    tp1_source: null,
    tp2_price: null,
    tp2_source: null,
    reward_risk_tp1: null,
    favorable_reward_risk: false,
    next_action: "wait",
    reason_codes: [],
    quality_grade: "none",
    evidence_score: 0,
    evidence: [],
    entry_structure: null,
    structure_origin: "",
    hard_failures: [],
  };
  const wait = (
    reason: GuideReason,
    failures: string[] = [reason],
  ): TradeGuideV1 => ({
    ...empty,
    reason_codes: [reason],
    hard_failures: failures,
  });
  if (
    !maMatchesIdentity(ma, id, timeframe) ||
    (setup && !tradeSetupMatchesIdentity(setup, id, timeframe))
  )
    return wait("identity_mismatch");
  if (!last || !positive(last.close) || ma.state === "disabled")
    return wait("unavailable");
  if (
    ma.confirmed_at !== last.closeTime ||
    ma.candle_open_time !== last.openTime ||
    snapshot.state.confirmed_at !== last.closeTime ||
    (setup && setup.confirmed_at !== last.closeTime)
  )
    return wait("context_mismatch");
  if (ma.setup_direction === "none") return wait("conflict", ma.hard_failures);
  if (setup?.reason === "invalidated") return wait("invalidated");
  const long = ma.setup_direction === "long",
    sign = long ? 1 : -1,
    atr = ma.atr;
  if (
    snapshot.trend.direction === (long ? "bearish" : "bullish") ||
    (setup?.status === "candidate" && setup.direction !== ma.setup_direction)
  )
    return wait("conflict");
  const fatal = ma.hard_failures.filter(
    (r) => !["overextended", "no_retest"].includes(r),
  );
  if (fatal.length)
    return wait(
      fatal.includes("level_failed")
        ? "invalidated"
        : fatal.includes("no_target")
          ? "no_target"
          : fatal.includes("trend_conflict")
            ? "conflict"
            : "noise",
      fatal,
    );
  const extended = (low: number, high: number) =>
    sign * (last.close - (long ? high : low)) >
    MA_RULES.maximumExtensionAtr * atr;
  // An explicit prior READY/MISSED is authoritative for the same bounded interaction.
  const matchingPrevious =
    previous &&
    guideMatchesIdentity(previous, id, timeframe) &&
    previous.ma_settings_key === empty.ma_settings_key &&
    previous.direction === ma.setup_direction &&
    (guideReady(previous) || previous.state === "MISSED");
  if (matchingPrevious) {
    const origin = candles.findIndex(
      (c) =>
        c.openTime === (previous.structure_origin || previous.candle_open_time),
    );
    const following = origin < 0 ? [] : candles.slice(origin + 1);
    const bounded =
      origin >= 0 &&
      candles.length - 1 - origin <= MA_RULES.retestLookback &&
      Date.parse(last.openTime) - Date.parse(candles[origin]!.openTime) <=
        MA_RULES.retestLookback * intervalSeconds[timeframe] * 1000;
    const sameInteraction =
      !ma.entry_zone ||
      (positive(previous.entry_zone_low) &&
        positive(previous.entry_zone_high) &&
        ma.entry_zone.low <= previous.entry_zone_high &&
        ma.entry_zone.high >= previous.entry_zone_low &&
        Date.parse(ma.structure_origin) <= Date.parse(previous.confirmed_at));
    if (
      bounded &&
      sameInteraction &&
      positive(previous.stop_price) &&
      positive(previous.tp1_price) &&
      positive(previous.entry_zone_low) &&
      positive(previous.entry_zone_high)
    ) {
      if (following.some((c) => sign * (c.close - previous.stop_price!) <= 0))
        return wait("invalidated");
      if (following.some((c) => sign * (c.close - previous.tp1_price!) >= 0))
        return wait("target_reached");
      if (
        previous.state === "MISSED" ||
        extended(previous.entry_zone_low, previous.entry_zone_high)
      )
        return {
          ...previous,
          confirmed_at: last.closeTime,
          state: "MISSED",
          next_action: long ? "no_chase_long" : "no_chase_short",
          reason_codes: ["extended"],
          hard_failures: ["overextended"],
        };
    }
  }
  if (
    ma.hard_failures.includes("no_retest") ||
    !ma.setup_type ||
    !ma.entry_zone
  )
    return wait("unavailable", ["no_retest"]);
  const origin = candles.findIndex((c) => c.openTime === ma.structure_origin);
  if (
    origin < 0 ||
    candles.length - 1 - origin > MA_RULES.retestLookback ||
    Date.parse(last.openTime) - Date.parse(ma.structure_origin) >
      MA_RULES.retestLookback * intervalSeconds[timeframe] * 1000
  )
    return wait("unavailable", ["expired"]);
  const low = ma.entry_zone.low,
    high = ma.entry_zone.high,
    entry = ma.trigger_price,
    stop = ma.invalidation_price;
  if (
    !positive(low) ||
    !positive(high) ||
    high < low ||
    !positive(entry) ||
    !positive(stop) ||
    !(atr > 0) ||
    sign * (entry - stop) <= 0
  )
    return wait("invalid_risk");
  if (sign * (last.close - stop) <= 0) return wait("invalidated");
  // These observations already include confirmed pivots. Never fit a target to the desired R:R.
  const targets = ma.observed_targets.filter(
    (t) =>
      positive(t.price) &&
      sign * (t.price - (long ? Math.max(entry, high) : Math.min(entry, low))) >
        0,
  );
  const tp1 = targets[0],
    tp2 = targets[1];
  if (!tp1) return wait("no_target");
  if (sign * (last.close - tp1.price) >= 0) return wait("target_reached");
  const rr = (sign * (tp1.price - entry)) / (sign * (entry - stop));
  if (!Number.isFinite(rr)) return wait("invalid_risk");
  if (rr < GUIDE_RULES.minimumRR) return wait("poor_rr");
  const result: TradeGuideV1 = {
    ...empty,
    direction: long ? "long" : "short",
    entry_zone_low: low,
    entry_zone_high: high,
    reference_entry_price: entry,
    stop_price: stop,
    stop_reason: long ? "below_retest_support" : "above_retest_resistance",
    tp1_price: tp1.price,
    tp1_source: tp1.source,
    tp2_price: tp2?.price ?? null,
    tp2_source: tp2?.source ?? null,
    reward_risk_tp1: rr,
    favorable_reward_risk: rr >= GUIDE_RULES.favorableRR,
    quality_grade: ma.quality_tier,
    evidence_score: ma.confidence_score,
    evidence: ma.evidence,
    entry_structure: ma.setup_type,
    structure_origin: ma.structure_origin,
  };
  if (extended(low, high))
    return {
      ...result,
      state: "MISSED",
      next_action: long ? "no_chase_long" : "no_chase_short",
      reason_codes: ["extended"],
      hard_failures: ["overextended"],
    };
  const ready =
    rr >= GUIDE_RULES.readyRR &&
    ma.price_confirmed &&
    ma.confidence_score >= EVIDENCE_RULES.ready;
  return {
    ...result,
    state: ready
      ? long
        ? "LONG_READY"
        : "SHORT_READY"
      : long
        ? "WATCH_LONG"
        : "WATCH_SHORT",
    next_action: ready
      ? long
        ? "consider_long"
        : "consider_short"
      : long
        ? "wait_pullback"
        : "wait_rejection",
    reason_codes: [
      ready
        ? "confirmed"
        : rr < GUIDE_RULES.readyRR
          ? "watch_rr"
          : "confirmation_pending",
    ],
  };
}
