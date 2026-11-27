import type {
  EventContractDirection,
  EventContractHorizon,
  EventContractReason,
  EventContractResearch,
  EventSignalShadow,
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
export function shadowIdentityMatches(
  data: EventSignalShadow,
  assetId: string,
  instrumentId: string,
  symbol: string,
  horizon: 10 | 30,
): boolean {
  return (
    data?.version === "event-signal-v1" &&
    data.settlement_version === "event-shadow-v1" &&
    data.mode === "shadow" &&
    data.asset_id === assetId &&
    data.market_instrument_id === instrumentId &&
    data.symbol === symbol &&
    data.horizon_minutes === horizon &&
    data.signal_source === "bybit" &&
    data.reference_source === "binance_index_minute_close_proxy" &&
    data.settlement_source === data.reference_source &&
    data.reference_instrument_id !== instrumentId &&
    data.settlement_basis_verified === false &&
    data.validation_status === "unvalidated" &&
    data.probability === null &&
    data.expected_value === null
  );
}

export function shadowIsCurrent(data: EventSignalShadow, now: number): boolean {
  const generated = Date.parse(data.generated_at ?? "");
  const valid = Date.parse(data.valid_until ?? "");
  if (data.assessment.state === "WAIT" && !data.generated_at)
    return (
      data.assessment.reason === "warming_up" ||
      data.assessment.reason === "disabled"
    );
  if (!(generated <= now && now < valid)) return false;
  if (data.assessment.state === "WAIT") return true;
  const confirmed = Date.parse(data.assessment.as_of ?? "");
  return (
    !!data.reference_instrument_id &&
    !!data.signal &&
    data.signal.direction === data.assessment.direction &&
    data.signal.score === data.assessment.score &&
    data.assessment.state.toLowerCase().endsWith(data.signal.direction) &&
    confirmed <= generated &&
    now - confirmed < 90_000 &&
    Date.parse(data.signal.expires_at) ===
      confirmed + data.horizon_minutes * 60_000
  );
}
