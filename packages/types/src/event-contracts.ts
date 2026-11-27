export type EventContractHorizon = 10 | 30;
export type EventContractDirection = "up" | "down" | "wait" | "unavailable";
export type EventContractReason =
  | "trend_pullback_confirmed"
  | "insufficient_history"
  | "history_gap"
  | "stale_data"
  | "mixed_trend"
  | "choppy"
  | "no_retest"
  | "no_confirmation"
  | "overextended"
  | "opposing_barrier"
  | "macro_event"
  | "macro_date_uncertain"
  | "episode_already_seen"
  | "disabled"
  | "provider_unavailable"
  | "signal_expired"
  | "observation_in_progress";

export interface EventContractResearch {
  version: "event-contract-direction-v1";
  asset_id: string;
  symbol: string;
  market_instrument_id: string | null;
  provider: "binance_index";
  horizon_minutes: EventContractHorizon;
  availability: "disabled" | "warming_up" | "ready" | "stale" | "unavailable";
  validation_status: "unvalidated";
  settlement_basis: "next_minute_index_open_proxy";
  settlement_basis_verified: false;
  probability: null;
  expected_value: null;
  last_updated_at: string | null;
  valid_until: string | null;
  assessment: {
    version: "event-contract-direction-v1";
    horizon_minutes: EventContractHorizon;
    direction: EventContractDirection;
    reasons: EventContractReason[];
    confirmed_at: string | null;
    reference_price: string | null;
    zone_low: string | null;
    zone_high: string | null;
    environment_interval: "5m" | "15m";
    trigger_interval: "1m" | "5m";
  };
  observations: {
    id: string;
    direction: "up" | "down";
    generated_at: string;
    entry_at: string;
    expires_at: string;
    entry_price: string | null;
    settlement_price: string | null;
    outcome: "pending" | "up" | "down" | "tie" | "missing";
    matched_direction: boolean | null;
  }[];
}
