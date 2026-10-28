import type { TradeSetupCandidateV1 } from "@alpha-radar/types/core-3";
import type { MarketInterval } from "@alpha-radar/types/market-data";
import {
  MA_RULES,
  maMatchesIdentity,
  type MaEntryAnalysis,
} from "./ma-confluence-entry.ts";
import { tradeSetupMatchesIdentity } from "../../../src/lib/market/trade-setup.ts";
import type { TechnicalContextSnapshot } from "../../../src/lib/market/technical-context.ts";
import { intervalSeconds } from "../../../src/lib/market/intervals.ts";

export const TRADE_GUIDE_VERSION = "trade-guide-v1" as const;
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
const positive = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value > 0;
/** Cheap aggregation of accepted confirmed outputs only. No indicator/replay/provider calls.
 * Previous is explicit confirmed evidence, not a position or browser-clock lifecycle. */
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
  const result: TradeGuideV1 = {
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
  };
  const empty = { ...result };
  const wait = (reason: GuideReason) => ({
    ...empty,
    state: "WAIT" as const,
    direction: "none" as const,
    next_action: "wait" as const,
    reason_codes: [reason],
  });
  if (
    !maMatchesIdentity(ma, id, timeframe) ||
    (setup && !tradeSetupMatchesIdentity(setup, id, timeframe))
  )
    return wait("identity_mismatch");
  if (
    !last ||
    !positive(last.close) ||
    ma.state === "disabled" ||
    ma.state === "no_setup"
  )
    return wait("unavailable");
  if (
    ma.confirmed_at !== last.closeTime ||
    ma.candle_open_time !== last.openTime ||
    snapshot.state.confirmed_at !== last.closeTime ||
    (setup && setup.confirmed_at !== last.closeTime)
  )
    return wait("context_mismatch");
  if (ma.state === "invalidated" || setup?.reason === "invalidated")
    return wait("invalidated");
  const long = ma.setup_direction === "long",
    sign = long ? 1 : -1;
  if (
    ma.setup_direction === "none" ||
    ![
      `observe_${ma.setup_direction}`,
      `candidate_${ma.setup_direction}`,
      `trigger_${ma.setup_direction}`,
    ].includes(ma.state) ||
    snapshot.trend.direction !== (long ? "bullish" : "bearish") ||
    snapshot.state.direction !== (long ? "bullish" : "bearish") ||
    (setup?.status === "candidate" && setup.direction !== ma.setup_direction)
  )
    return wait("conflict");
  if (
    ma.reason_codes.some((r) =>
      [
        "flat_ma",
        "repeated_crosses",
        "excess_retests",
        "trend_conflict",
        "macd_conflict",
        "macd_unready",
        "insufficient_history",
      ].includes(r),
    )
  )
    return wait("noise");
  if (
    ma.reason_codes.includes("near_obstruction") ||
    ma.reason_codes.includes("no_target")
  )
    return wait("no_target");
  // ATR is already encoded in the authoritative MA +/- zoneAtr * ATR zone.
  const atr =
    positive(ma.ma_zone_low) && positive(ma.ma_zone_high)
      ? (ma.ma_zone_high - ma.ma_zone_low) / (2 * MA_RULES.zoneAtr)
      : 0;
  if (!(atr > 0)) return wait("unavailable");
  const extended = (low: number, high: number) =>
    sign * (last.close - (long ? high : low)) >
    MA_RULES.maximumExtensionAtr * atr;
  // Only a previously READY plan can supply absent MA references after extension.
  // It must still be in the existing three-bar retest horizon, same MA settings,
  // and no intervening confirmed close may have invalidated/reached its target.
  if (
    !ma.entry_zone &&
    previous &&
    guideReady(previous) &&
    guideMatchesIdentity(previous, id, timeframe) &&
    previous.ma_settings_key === result.ma_settings_key
  ) {
    const index = candles.findIndex(
      (c) => c.openTime === previous.candle_open_time,
    );
    if (
      index >= 0 &&
      index < candles.length - 1 &&
      candles.length - 1 - index <= MA_RULES.retestLookback &&
      Date.parse(last.openTime) - Date.parse(previous.candle_open_time) <=
        MA_RULES.retestLookback * intervalSeconds[timeframe] * 1000 &&
      positive(previous.entry_zone_low) &&
      positive(previous.entry_zone_high) &&
      positive(previous.stop_price) &&
      positive(previous.tp1_price) &&
      previous.direction === ma.setup_direction
    ) {
      const following = candles.slice(index + 1);
      if (following.some((c) => sign * (c.close - previous.stop_price!) <= 0))
        return wait("invalidated");
      if (following.some((c) => sign * (c.close - previous.tp1_price!) >= 0))
        return wait("target_reached");
      if (extended(previous.entry_zone_low, previous.entry_zone_high))
        return {
          ...previous,
          confirmed_at: last.closeTime,
          candle_open_time: previous.candle_open_time,
          state: "MISSED",
          next_action: long ? "no_chase_long" : "no_chase_short",
          reason_codes: ["extended"],
        };
    }
  }
  if (ma.reason_codes.includes("overextended")) return wait("unavailable");
  const low = ma.entry_zone?.low ?? ma.ma_zone_low,
    high = ma.entry_zone?.high ?? ma.ma_zone_high;
  if (!positive(low) || !positive(high) || high < low)
    return wait("unavailable");
  result.direction = long ? "long" : "short";
  result.entry_zone_low = low;
  result.entry_zone_high = high;
  // A trigger is a reference, not an asserted fill. Never substitute visual price.
  const entry = ma.trigger_price;
  const triggered = ma.state === (long ? "trigger_long" : "trigger_short");
  if (
    triggered &&
    (!ma.entry_zone || !positive(entry) || !positive(ma.invalidation_price))
  )
    return wait("invalid_risk");
  if (
    positive(entry) &&
    positive(ma.invalidation_price) &&
    sign * (entry - ma.invalidation_price) <= 0
  )
    return wait("invalid_risk");
  result.reference_entry_price = positive(entry) ? entry : null;
  const structures = (long ? snapshot.resistances : snapshot.supports).filter(
    (l) => l.timeframe === timeframe,
  );
  const targets: Array<{ price: number; source: TargetSource }> =
    structures.map((l) => ({
      price: long ? l.zone_low : l.zone_high,
      source: l.label as TargetSource,
    }));
  if (positive(ma.first_target))
    targets.push({
      price: ma.first_target,
      source: long ? "swing-high" : "swing-low",
    });
  const anchor = positive(entry) ? entry : long ? high : low;
  const sorted = targets
    .filter((t) => positive(t.price) && sign * (t.price - anchor) > 0)
    .sort((a, b) => sign * (a.price - b.price));
  const unique = sorted.filter(
    (t, i) =>
      i === 0 ||
      Math.abs(t.price - sorted[i - 1]!.price) > Number.EPSILON * t.price * 8,
  );
  if (!unique.length) return wait("no_target");
  result.tp1_price = unique[0]!.price;
  result.tp1_source = unique[0]!.source;
  result.tp2_price = unique[1]?.price ?? null;
  result.tp2_source = unique[1]?.source ?? null;
  if (sign * (last.close - result.tp1_price) >= 0)
    return wait("target_reached");
  if (positive(ma.invalidation_price)) {
    const matching = (long ? snapshot.supports : snapshot.resistances).filter(
      (l) =>
        l.timeframe === timeframe && l.zone_low <= high && l.zone_high >= low,
    );
    // MA invalidation already buffers the retest. Buffer only a deeper structural
    // boundary that is not covered by it; do not add another buffer to the MA stop.
    const boundaries = matching.map((l) => (long ? l.zone_low : l.zone_high));
    const boundary = long ? Math.min(...boundaries) : Math.max(...boundaries);
    result.stop_price =
      boundaries.length && sign * (ma.invalidation_price - boundary) > 0
        ? boundary - sign * MA_RULES.invalidationAtr * atr
        : ma.invalidation_price;
    result.stop_reason = long
      ? "below_retest_support"
      : "above_retest_resistance";
    if (
      !positive(result.stop_price) ||
      sign * (last.close - result.stop_price) <= 0
    )
      return wait("invalidated");
  }
  if (positive(entry) && positive(result.stop_price)) {
    const risk = sign * (entry - result.stop_price),
      reward = sign * (result.tp1_price - entry);
    if (!(risk > 0) || !(reward > 0)) return wait("invalid_risk");
    result.reward_risk_tp1 = reward / risk;
    if (!Number.isFinite(result.reward_risk_tp1)) return wait("invalid_risk");
    result.favorable_reward_risk =
      result.reward_risk_tp1 >= GUIDE_RULES.favorableRR;
    if (result.reward_risk_tp1 < GUIDE_RULES.minimumRR) return wait("poor_rr");
  }
  if (
    triggered &&
    positive(entry) &&
    positive(result.stop_price) &&
    result.reward_risk_tp1 !== null &&
    result.reward_risk_tp1 >= GUIDE_RULES.readyRR
  ) {
    if (extended(low, high))
      return {
        ...result,
        state: "MISSED",
        next_action: long ? "no_chase_long" : "no_chase_short",
        reason_codes: ["extended"],
      };
    return {
      ...result,
      state: long ? "LONG_READY" : "SHORT_READY",
      next_action: long ? "consider_long" : "consider_short",
      reason_codes: ["confirmed"],
    };
  }
  return {
    ...result,
    state: long ? "WATCH_LONG" : "WATCH_SHORT",
    next_action: long ? "wait_pullback" : "wait_rejection",
    reason_codes: [
      result.reward_risk_tp1 !== null &&
      result.reward_risk_tp1 < GUIDE_RULES.readyRR
        ? "watch_rr"
        : "confirmation_pending",
    ],
  };
}
