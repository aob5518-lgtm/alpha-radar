import type { EventContractHorizon } from "./event-contracts";
import type { SimulatorAssessment, SimulatorMarket } from "./event-simulator";

export interface SemiRiskSettings {
  markets: SimulatorMarket[];
  horizons: EventContractHorizon[];
  minimum_score: number;
  fixed_stake: string;
  max_stake: string;
  max_daily_loss: string;
  max_consecutive_losses: number;
  cooldown_minutes: number;
  max_active_real_bets: number;
  minimum_payout_10m: string;
  minimum_payout_30m: string;
  max_drift_atr: string;
}

type Identity = {
  id: string;
  symbol: SimulatorMarket;
  horizon_minutes: EventContractHorizon;
  direction: "higher" | "lower";
  signal_score: number;
  created_at: string;
  signal_reference_price: string;
};

export type IntentStatus =
  | "PENDING_REVIEW"
  | "APPROVED_BY_USER"
  | "REJECTED_BY_USER"
  | "EXPIRED"
  | "EXECUTED_MANUALLY"
  | "CANCELLED_BY_RISK"
  | "SETTLED";

export type ExecutionAdapter = "MANUAL" | "MOBILE_HANDOFF" | "RESEARCH_DISABLED";
export type ExecutionStatus =
  | "CREATED"
  | "RISK_APPROVED"
  | "READY_FOR_EXECUTION"
  | "HANDOFF_STARTED"
  | "EXECUTING"
  | "EXECUTED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED"
  | "RECONCILIATION_REQUIRED"
  | "SETTLED";

export type SemiIntent = Identity & {
  signal_state: "STRONG_HIGHER" | "STRONG_LOWER" | "HIGHER" | "LOWER";
  generated_at: string;
  expires_at: string;
  signal_reference_source: string;
  suggested_stake: string;
  minimum_payout: string;
  breakeven_probability: string;
  status: IntentStatus;
  risk_reason: string | null;
  reject_reason: string | null;
  approved_payout: string | null;
  handoff_started_at: string | null;
  returned_at: string | null;
  drift_atr: string | null;
  drift_warning: boolean;
  execution_adapter: ExecutionAdapter | null;
  execution_status: ExecutionStatus | null;
  execution_deadline: string | null;
  execution_started_at: string | null;
};

export type RealBet = Identity & {
  actual_open_price: string;
  actual_open_at: string;
  expiry_at: string;
  actual_premium: string;
  actual_payout: string;
  breakeven_probability: string;
  status: "OPEN" | "WIN" | "LOSS" | "TIE" | "CANCELLED";
  settlement_source: "BINANCE_EVENT_VERIFIED" | "BINANCE_INDEX_PROXY" | "MANUAL_CONFIRMATION" | "UNKNOWN";
  settlement_price: string | null;
  settled_at: string | null;
  gross_return: string | null;
  net_pnl: string | null;
  order_reference: string | null;
  notes: string | null;
  late_execution_confirmation: boolean;
  payout_below_policy: boolean;
  direction_mismatch: boolean;
  horizon_mismatch: boolean;
  price_drift_absolute: string | null;
  price_drift_percent: string | null;
  price_drift_atr: string | null;
  signal_to_handoff_ms: number | null;
  handoff_to_execution_ms: number | null;
  signal_to_execution_ms: number | null;
};

export interface SemiMetrics {
  bets: number;
  wins: number;
  losses: number;
  win_rate: string | null;
  net_pnl: string;
  return_on_premium: string | null;
  max_drawdown: string;
  max_losing_streak: number;
  average_payout: string | null;
  average_premium: string | null;
}

export interface SemiState {
  enabled: boolean;
  acknowledged: boolean;
  killed: boolean;
  live_execution_enabled: boolean;
  execution_adapters: {
    adapter: ExecutionAdapter;
    available: boolean;
    healthy: boolean;
  }[];
  revision: string | null;
  settings: SemiRiskSettings;
  cooldown_until: string | null;
  daily_pnl: string;
  signals: {
    symbol: SimulatorMarket;
    horizon_minutes: EventContractHorizon;
    assessment: SimulatorAssessment | null;
    intent: SemiIntent | null;
    minimum_payout: string;
    suggested_stake: string;
  }[];
  intents: SemiIntent[];
  handoffs: SemiIntent[];
  handoff_metrics: {
    opened: number;
    executed: number;
    skipped: number;
    expired_during_handoff: number;
    payout_below_policy: number;
    median_signal_to_execution_ms: number | null;
    p90_signal_to_execution_ms: number | null;
    drift_within_limit: number;
    drift_above_limit: number;
    drift_unavailable: number;
  };
  active: RealBet[];
  history: RealBet[];
  next_intent_before: string | null;
  next_bet_before: string | null;
  real: SemiMetrics;
  decisions: Record<string, number>;
  comparison: {
    symbol: SimulatorMarket;
    horizon_minutes: EventContractHorizon;
    paper: SemiMetrics;
    real: SemiMetrics;
  }[];
  comparison_start: string | null;
  comparison_end: string | null;
}
