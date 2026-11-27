import type { EventContractHorizon, EventSignalShadow, EventSignalState } from "./event-contracts";

export type SimulatorMarket = "BTCUSDT" | "ETHUSDT";
export type SimulatorDecision =
  | "opened" | "eligible" | "no_session" | "signal_unavailable" | "invalid_signal"
  | "signal_expired" | "signal_not_strong" | "score_below_threshold" | "existing_active_bet"
  | "daily_loss_limit" | "cooldown" | "market_disabled" | "horizon_disabled"
  | "simulation_paused" | "duplicate_signal" | "max_active_bets" | "insufficient_bankroll";

export interface SimulationSettings {
  starting_bankroll: string;
  markets: SimulatorMarket[];
  horizons: EventContractHorizon[];
  allow_regular_signals: boolean;
  minimum_score: number;
  stake_mode: "fixed" | "percentage";
  fixed_stake: string;
  stake_percent: string;
  payout_10m: string;
  payout_30m: string;
  max_daily_loss_percent: string;
  max_consecutive_losses: number;
  cooldown_minutes: number;
  max_active_bets: number;
}

export interface SimulatorSessionSummary {
  id: string;
  created_at: string;
  started_at: string;
  stopped_at: string | null;
  status: "running" | "paused" | "archived";
}

export interface SimulatorSession extends SimulatorSessionSummary {
  strategy_version: string;
  signal_version: string;
  settlement_version: string;
  settings_snapshot: SimulationSettings;
  current_bankroll: string;
  available_bankroll: string;
  max_bankroll: string;
  max_drawdown: string;
  cooldown_until: string | null;
  daily_limit_reached: boolean;
  total_bets: number;
  settled_bets: number;
  active_bets: number;
  net_pnl: string;
}

export type SimulatorAssessment = EventSignalShadow["assessment"] & {
  regime: "ranging" | "weak_trend" | "strong_trend" | "reversal" | null;
};

export interface PaperBet {
  id: string;
  simulation_session_id: string;
  event_signal_id: string;
  market_instrument_id: string;
  symbol: SimulatorMarket;
  horizon_minutes: EventContractHorizon;
  direction: "higher" | "lower";
  signal_state: EventSignalState;
  signal_score: number;
  signal_version: string;
  signal_generated_at: string;
  bet_created_at: string;
  reference_price: string;
  reference_source: string;
  expiry_at: string;
  virtual_stake: string;
  payout_multiplier: string;
  payout_source: "simulation_assumption";
  breakeven_probability: string;
  assessment: SimulatorAssessment;
  settings_snapshot: SimulationSettings;
  status: "active" | "win" | "loss" | "void";
  settled_at: string | null;
  settlement_price: string | null;
  settlement_source: string;
  gross_return: string | null;
  net_pnl: string | null;
  bankroll_before: string | null;
  bankroll_after: string | null;
}

export interface SimulatorPerformance {
  bets: number;
  wins: number;
  losses: number;
  voids: number;
  win_rate: string | null;
  net_pnl: string;
  return_percent: string;
  profit_factor: string | null;
  average_win: string | null;
  average_loss: string | null;
  current_losing_streak: number;
  max_losing_streak: number;
}

export interface SimulatorState {
  last_tick_at: string | null;
  current_session_id: string | null;
  session: SimulatorSession | null;
  defaults: SimulationSettings;
  sessions: SimulatorSessionSummary[];
  next_session_cursor: string | null;
  signals: {
    symbol: SimulatorMarket;
    horizon_minutes: EventContractHorizon;
    assessment: SimulatorAssessment;
    reference_price: string | null;
    eligibility: SimulatorDecision;
  }[];
  active_bets: PaperBet[];
  history: PaperBet[];
  next_cursor: string | null;
  performance: SimulatorPerformance;
  markets: Record<string, SimulatorPerformance>;
  score_buckets: Record<string, SimulatorPerformance>;
  directions: Record<string, SimulatorPerformance>;
  equity: { at: string; bankroll: string }[];
  decisions: {
    event_signal_id: string;
    reason: SimulatorDecision;
    decided_at: string;
    symbol: SimulatorMarket;
    horizon_minutes: EventContractHorizon;
  }[];
}
