import type { MaEntryAnalysis } from "./ma-confluence-entry.ts";
import { guideReady, type TradeGuideV1 } from "./trade-guide.ts";

type Confirmation =
  | "confirmed"
  | "price_pending"
  | "price_observed"
  | "unknown"
  | "blocked"
  | "missed";
type WaitingAction =
  | "wait_price_long"
  | "wait_price_short"
  | "wait_evidence"
  | "wait_rr"
  | "wait_confirmation";

export interface GuideDecision {
  direction: TradeGuideV1["direction"];
  zone: { low: number; high: number } | null;
  confirmation: Confirmation;
  waitingAction: WaitingAction | null;
}

/** Presentation only: explain the accepted Guide without calculating a new signal.
 * MA evidence must belong to the exact same closed context and settings.
 * Live prices, clocks and browser state are deliberately not inputs.
 */
export function describeGuideDecision(
  guide: TradeGuideV1,
  analysis?: MaEntryAnalysis,
): GuideDecision {
  const coherent =
    analysis?.market_instrument_id === guide.market_instrument_id &&
    analysis.timeframe === guide.timeframe &&
    (guide.direction === "none" ||
      analysis.setup_direction === guide.direction) &&
    analysis.confirmed_at === guide.confirmed_at &&
    analysis.candle_open_time === guide.candle_open_time &&
    `${analysis.settings.type}:${analysis.settings.period}:${analysis.settings.enabled}` ===
      guide.ma_settings_key;
  const ready = guideReady(guide),
    watch = guide.state === "WATCH_LONG" || guide.state === "WATCH_SHORT";
  const direction =
    guide.direction !== "none"
      ? guide.direction
      : coherent &&
          !guide.reason_codes.some((reason) =>
            ["identity_mismatch", "context_mismatch", "conflict"].includes(
              reason,
            ),
          ) &&
          !analysis.hard_failures.includes("trend_conflict")
        ? analysis.setup_direction
        : "none";
  const low = guide.entry_zone_low,
    high = guide.entry_zone_high;
  const zone =
    (ready || watch) &&
    low !== null &&
    high !== null &&
    Number.isFinite(low) &&
    Number.isFinite(high) &&
    low > 0 &&
    high >= low
      ? { low, high }
      : null;
  const confirmation: Confirmation = ready
    ? "confirmed"
    : guide.state === "MISSED"
      ? "missed"
      : !watch
        ? "blocked"
        : !coherent
          ? "unknown"
          : analysis.price_confirmed
            ? "price_observed"
            : "price_pending";
  const waitingAction: WaitingAction | null = !watch
    ? null
    : confirmation === "unknown"
      ? "wait_confirmation"
      : confirmation === "price_pending"
        ? guide.direction === "long"
          ? "wait_price_long"
          : "wait_price_short"
        : guide.reason_codes.includes("watch_rr")
          ? "wait_rr"
          : "wait_evidence";
  return { direction, zone, confirmation, waitingAction };
}
