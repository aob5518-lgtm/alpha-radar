import type { MarketFreshness, MarketInterval } from "./market-data.ts";

export const eventImportanceLevels = [
  "critical",
  "high",
  "medium",
  "low",
] as const;
export type EventImportance = (typeof eventImportanceLevels)[number];

export const eventStatuses = [
  "rumored",
  "scheduled",
  "confirmed",
  "ongoing",
  "completed",
  "cancelled",
  "superseded",
] as const;
export type EventStatus = (typeof eventStatuses)[number];

export interface EventSourceReference {
  source_id: string;
  source_document_id: string;
  title: string;
  canonical_url: string;
  published_at: string | null;
}

export interface ImportantEvent {
  id: string;
  title: string;
  event_type: string;
  status: EventStatus;
  scheduled_at: string | null;
  actual_release_at: string | null;
  detected_at: string;
  updated_at: string;
  timezone: string;
  importance: EventImportance;
  sources: EventSourceReference[];
  summary: string;
  why_it_matters: string;
  expected: string | null;
  actual: string | null;
  previous: string | null;
  affected_asset_ids: string[];
  bull_case: string | null;
  bear_case: string | null;
  market_expectation: string | null;
  priced_in_assessment: string | null;
  watch_next: string[];
}

export type StructuralLevelKind = "support" | "resistance";
export type StructuralStrengthBand = "weak" | "moderate" | "strong";

export interface StructuralLevel {
  id: string;
  label: "S1" | "S2" | "S3" | "R1" | "R2" | "R3";
  kind: StructuralLevelKind;
  representative_price: number;
  zone_low: number;
  zone_high: number;
  strength: number;
  strength_band: StructuralStrengthBand;
  pivot_count: number;
  last_tested_at: string;
  distance_percent: number;
  timeframe: MarketInterval;
  higher_timeframe_available: boolean;
  higher_timeframe_confluence: boolean;
}

export type TrendDirection = "bullish" | "neutral" | "bearish" | "unavailable";

export interface TrendBreakdown {
  market_structure: number;
  ema_ordering: number;
  ema_slopes: number;
  price_location: number;
  adx: number;
  higher_timeframe_alignment: number | null;
}

export interface TrendRegime {
  direction: TrendDirection;
  strength: number;
  version: string;
  breakdown: TrendBreakdown;
  reason: string;
}

export interface AnalystMarketContext {
  asset_id: string;
  symbol: string;
  timeframe: MarketInterval;
  current_price: string | null;
  quote_currency: string | null;
  market_data_freshness: MarketFreshness | "unavailable";
  market_data_observed_at: string | null;
  levels: StructuralLevel[];
  trend: TrendRegime;
  recent_event_ids: string[];
  source_document_ids: string[];
  generated_at: string;
  technical_model_version: string;
}

export type AnalystStatementKind = "fact" | "analysis" | "scenario";

export interface AnalystStatement {
  kind: AnalystStatementKind;
  text: string;
  source_reference_ids: string[];
}

export interface AnalystResponse {
  market_state: AnalystStatement[];
  trend: AnalystStatement[];
  key_resistance: StructuralLevel[];
  key_support: StructuralLevel[];
  important_recent_events: AnalystStatement[];
  bull_case: AnalystStatement[];
  bear_case: AnalystStatement[];
  trigger_conditions: AnalystStatement[];
  invalidation_and_risk: AnalystStatement[];
  watch_next: AnalystStatement[];
  model_provider: string;
  model_version: string;
  generated_at: string;
  technical_model_version: string;
  context_timestamp: string;
}
