import type {
  EventContractDirection,
  EventContractHorizon,
  EventContractReason,
  EventContractResearch,
} from "@alpha-radar/types/event-contracts";

export function researchIdentityMatches(
  data: EventContractResearch,
  assetId: string,
  symbol: string,
  horizon: EventContractHorizon,
): boolean {
  return (
    data.asset_id === assetId &&
    data.symbol === symbol &&
    data.horizon_minutes === horizon &&
    data.assessment.horizon_minutes === horizon &&
    data.provider === "binance_index" &&
    data.version === "event-contract-direction-v1" &&
    data.assessment.version === data.version &&
    data.validation_status === "unvalidated" &&
    data.settlement_basis === "next_minute_index_open_proxy" &&
    ["up", "down", "wait", "unavailable"].includes(data.assessment.direction) &&
    data.settlement_basis_verified === false &&
    data.probability === null &&
    data.expected_value === null
  );
}

export function researchPresentation(
  data: EventContractResearch | null,
  assetId: string,
  symbol: string,
  horizon: EventContractHorizon,
  now: number,
): { direction: EventContractDirection; reason: EventContractReason } {
  if (!data || !researchIdentityMatches(data, assetId, symbol, horizon))
    return { direction: "unavailable", reason: "provider_unavailable" };
  if (data.availability === "disabled")
    return { direction: "unavailable", reason: "disabled" };
  const confirmed = Date.parse(data.assessment.confirmed_at ?? "");
  if (
    !Number.isFinite(confirmed) ||
    confirmed > now ||
    now - confirmed > 90_000
  )
    return {
      direction: "unavailable",
      reason:
        data.availability === "warming_up"
          ? "insufficient_history"
          : "stale_data",
    };
  const valid = Date.parse(data.valid_until ?? "");
  if (!Number.isFinite(valid) || now > valid)
    return { direction: "wait", reason: "signal_expired" };
  return {
    direction: data.assessment.direction,
    reason: data.assessment.reasons[0] ?? "provider_unavailable",
  };
}
