import type { MarketState } from "@alpha-radar/types/core-3";

/** Presentation only: retain the V1 fallback phase in the underlying contract. */
export function isNeutralMarketStateFallback(state: MarketState): boolean {
  return (
    state.direction === "neutral" &&
    (state.phase === "slow_rise" || state.phase === "slow_decline") &&
    (state.phase_confidence === 0 ||
      state.evidence.some((item) => item.code === "range_location"))
  );
}
