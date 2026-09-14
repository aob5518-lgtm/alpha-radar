export type MarketInterval = "1m" | "1h" | "1d";
export type MarketFreshness = "fresh" | "stale";

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
}
