import type {
  MarketStateReferenceLevel,
  TradeSetupCandidateV1,
} from "@alpha-radar/types/core-3";
import type { MarketInterval } from "@alpha-radar/types/market-data";

import { MARKET_STATE_CONSTANTS } from "./market-state.ts";
import { calculateAtrSeries } from "./technical-levels.ts";
import type { TechnicalContextSnapshot } from "./technical-context.ts";

export function tradeSetupMatchesIdentity(
  setup: TradeSetupCandidateV1,
  instrumentId: string,
  interval: MarketInterval,
): boolean {
  return (
    setup.market_instrument_id === instrumentId && setup.timeframe === interval
  );
}

export function calculateTradeSetup(
  snapshot: TechnicalContextSnapshot,
  instrumentId: string,
  interval: MarketInterval,
): TradeSetupCandidateV1 {
  const { state, trend, closedCandles } = snapshot;
  const last = closedCandles.at(-1);
  const empty: TradeSetupCandidateV1 = {
    algorithm_version: "trade-setup-v1",
    market_instrument_id: instrumentId,
    timeframe: interval,
    direction: "wait",
    status: "waiting",
    reference_level: null,
    entry_zone_low: null,
    entry_zone_high: null,
    preferred_entry_price: null,
    reason: "wait_confirmation",
    confirmed_at: state.confirmed_at,
  };
  if (!last || trend.direction === "unavailable")
    return { ...empty, reason: "unavailable" };
  const atr = Math.max(
    calculateAtrSeries(closedCandles, MARKET_STATE_CONSTANTS.atrPeriod).at(
      -1,
    ) ?? 0,
    Number.EPSILON,
  );
  const reference = state.reference_level;
  // A retained phase may reference an obsolete zone. Match the current authoritative
  // level by kind and overlap, never by the mutable S1/R1 label alone.
  const levels = [...snapshot.supports, ...snapshot.resistances];
  const level = reference
    ? levels.find(
        (candidate) =>
          candidate.kind === reference.kind &&
          candidate.timeframe === interval &&
          candidate.zone_low <= reference.zone_high &&
          candidate.zone_high >= reference.zone_low,
      )
    : undefined;
  if (reference && !level) return { ...empty, reason: "invalidated" };
  if (!level)
    return {
      ...empty,
      reason: trend.direction === "neutral" ? "neutral" : "wait_confirmation",
    };
  const failed =
    level.kind === "support"
      ? last.close <
        level.zone_low - MARKET_STATE_CONSTANTS.levelFailureBufferAtr * atr
      : last.close >
        level.zone_high + MARKET_STATE_CONSTANTS.levelFailureBufferAtr * atr;
  if (failed) return { ...empty, reason: "invalidated" };
  const zone: MarketStateReferenceLevel = {
    level_label: level.label,
    kind: level.kind,
    zone_low: level.zone_low,
    zone_high: level.zone_high,
  };
  const long =
    trend.direction === "bullish" &&
    state.direction === "bullish" &&
    state.phase === "support_confirmed" &&
    level.kind === "support";
  const short =
    trend.direction === "bearish" &&
    state.direction === "bearish" &&
    state.phase === "resistance_confirmed" &&
    level.kind === "resistance";
  if (!long && !short)
    return {
      ...empty,
      reference_level: zone,
      reason: trend.direction === "neutral" ? "neutral" : "wait_confirmation",
    };
  const edge = long ? level.zone_high : level.zone_low;
  const extended =
    Math.abs(last.close - edge) >
    MARKET_STATE_CONSTANTS.entryMaximumExtensionAtr * atr;
  const midpoint = (level.zone_low + level.zone_high) / 2;
  return {
    ...empty,
    direction: long ? "long" : "short",
    status: state.entry_window_candidate && !extended ? "candidate" : "waiting",
    reference_level: zone,
    entry_zone_low: level.zone_low,
    entry_zone_high: level.zone_high,
    preferred_entry_price: (midpoint + edge) / 2,
    reason: extended
      ? "extended"
      : long
        ? "support_confirmed"
        : "resistance_confirmed",
  };
}
