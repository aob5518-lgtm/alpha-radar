import type {
  MarketState,
  MarketStateEvidence,
  MarketStateMarkerPhase,
} from "@alpha-radar/types/core-3";

import type { Messages } from "@/lib/i18n/messages";
import { formatMessage } from "@/lib/i18n/messages";

type ChartMessages = Messages["chart"];
type EvidenceTextKey = keyof ChartMessages["marketState"]["evidenceText"];

export function formatMarketStateWait(
  state: MarketState,
  messages: ChartMessages,
): string {
  const level =
    state.reference_level?.level_label ??
    (state.next_wait === "wait_support"
      ? messages.support
      : state.next_wait === "wait_resistance"
        ? messages.resistance
        : "");
  return formatMessage(messages.marketState.waits[state.next_wait], { level });
}

export function formatMarketStateEvidence(
  evidence: MarketStateEvidence,
  messages: ChartMessages,
): string {
  const key = evidenceKey(evidence);
  return formatMessage(messages.marketState.evidenceText[key], {
    candles: evidence.candles ?? 0,
    level: evidence.level_label ?? "—",
    value: formatEvidenceValue(evidence),
  });
}

export function marketStateMarkerLabel(
  phase: MarketStateMarkerPhase,
  messages: ChartMessages,
): string {
  return messages.marketState.markers[phase];
}

function evidenceKey(evidence: MarketStateEvidence): EvidenceTextKey {
  switch (evidence.code) {
    case "net_move_atr":
    case "directional_progress":
    case "extension_slowed":
    case "left_extreme":
    case "swing_break":
    case "structure_held":
    case "controlled_retracement":
    case "extension_from_ema":
    case "swing_progress_faded":
    case "wick_rejection":
      return `${evidence.code}_${evidence.direction ?? "up"}` as EvidenceTextKey;
    case "range_expansion":
    case "level_tested":
    case "level_reclaimed":
    case "level_rejected":
    case "range_location":
    case "higher_timeframe_alignment":
      return evidence.code;
  }
}

function formatEvidenceValue(evidence: MarketStateEvidence): string | number {
  if (evidence.value === undefined) return 0;
  if (evidence.code === "directional_progress")
    return Math.round(evidence.value * 100);
  if (evidence.code === "swing_break")
    return evidence.value.toLocaleString(undefined, {
      maximumFractionDigits: evidence.value >= 100 ? 2 : 6,
    });
  return evidence.value.toFixed(2);
}
