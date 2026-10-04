export const marketIntervals = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
  "1w",
] as const;
export type MarketInterval = (typeof marketIntervals)[number];
export type MarketFreshness = "fresh" | "stale";
export type MarketInstrumentType =
  | "spot"
  | "index"
  | "perpetual"
  | "future"
  | "option";

export interface MarketInstrument {
  id: string;
  asset_id: string;
  asset_slug: string;
  asset_name: string;
  symbol: string;
  provider: string;
  provider_instrument_id: string;
  instrument_type: MarketInstrumentType;
  base_currency: string;
  quote_currency: string;
  venue: string | null;
  status: "active" | "inactive" | "delisted";
}

export interface MarketInstrumentListResponse {
  items: MarketInstrument[];
}

export interface MarketQuote {
  asset_id: string;
  symbol: string;
  market_instrument_id: string;
  provider_instrument_id: string;
  price: string;
  bid: string | null;
  ask: string | null;
  bid_size: string | null;
  ask_size: string | null;
  base_currency: string;
  quote_currency: string;
  provider: string;
  provider_timestamp: string | null;
  observed_at: string;
  ingested_at: string;
  quality_flags: string[];
  freshness: MarketFreshness;
  is_stale: boolean;
}

export interface MarketCandle {
  market_instrument_id: string;
  provider: string;
  interval: MarketInterval;
  open_time: string;
  close_time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string | null;
  quote_volume: string | null;
  is_closed: boolean;
  provider_timestamp: string | null;
  ingested_at: string;
  quality_flags: string[];
}

export interface MarketHistory {
  asset_id: string;
  symbol: string;
  market_instrument_id: string;
  provider_instrument_id: string;
  base_currency: string;
  quote_currency: string;
  provider: string;
  interval: MarketInterval;
  items: MarketCandle[];
  has_more: boolean;
  next_end: string | null;
}
