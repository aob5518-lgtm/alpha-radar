export const eventTypes = [
  "macro",
  "regulation",
  "earnings",
  "etf",
  "crypto",
  "market_structure",
] as const;
export type EventType = (typeof eventTypes)[number];

export const radarStatuses = [
  "breaking",
  "developing",
  "confirmed",
  "resolved",
] as const;
export type RadarStatus = (typeof radarStatuses)[number];

export const directions = ["bullish", "bearish", "mixed", "neutral"] as const;
export type Direction = (typeof directions)[number];

export const impactLevels = ["low", "medium", "high"] as const;
export type ImpactLevel = (typeof impactLevels)[number];

export const confidenceLevels = ["low", "medium", "high"] as const;
export type ConfidenceLevel = (typeof confidenceLevels)[number];

export const horizons = ["intraday", "short", "medium", "long"] as const;
export type Horizon = (typeof horizons)[number];

export const impactOrders = ["first", "second", "third"] as const;
export type ImpactOrder = (typeof impactOrders)[number];

export const pricedInLevels = [
  "not_priced",
  "partial",
  "mostly_priced",
  "unknown",
] as const;
export type PricedInLevel = (typeof pricedInLevels)[number];

export const sourceTiers = [
  "primary",
  "major_media",
  "specialist",
  "social",
] as const;
export type SourceTier = (typeof sourceTiers)[number];

export const radarTimeRanges = ["1h", "4h", "24h", "7d"] as const;
export type RadarTimeRange = (typeof radarTimeRanges)[number];

export const intelligenceKinds = [
  "fact",
  "analysis",
  "scenario",
  "model_output",
] as const;
export type IntelligenceKind = (typeof intelligenceKinds)[number];

export interface LocalizedText {
  en: string;
  "zh-CN": string;
}

export interface RadarAsset {
  assetId: string;
  slug: string;
  symbol: string;
  name: LocalizedText;
  assetType: string;
}

export interface AssetImpact {
  assetId: string;
  symbol: string;
  direction: Direction;
  impact: ImpactLevel;
  horizon: Horizon;
  order: ImpactOrder;
  confidence: ConfidenceLevel;
}

export interface SourceRecord {
  id: string;
  name: string;
  tier: SourceTier;
  isDemo: true;
}

export interface IntelligenceBlock {
  kind: IntelligenceKind;
  content: LocalizedText;
}

export interface RadarItem {
  id: string;
  title: LocalizedText;
  summary: LocalizedText;
  eventType: EventType;
  status: RadarStatus;
  eventTime?: string;
  publishedAt?: string;
  detectedAt: string;
  importance: ImpactLevel;
  confidence: ConfidenceLevel;
  pricedIn: PricedInLevel;
  assets: RadarAsset[];
  impacts: AssetImpact[];
  sourceCount: number;
  sources: SourceRecord[];
  isBreaking: boolean;
  isDemo: true;
  updatedAt?: string;
  whatChanged?: LocalizedText;
  watchNext?: LocalizedText;
  risks: LocalizedText;
  blocks: IntelligenceBlock[];
  relatedEventIds: string[];
  narrative: string;
}

export interface RadarFilters {
  timeRange: RadarTimeRange;
  eventType?: EventType;
  assetId?: string;
  assetType?: string;
  direction?: Direction;
  impact?: ImpactLevel;
  confidence?: ConfidenceLevel;
  status?: RadarStatus;
  horizon?: Horizon;
  sourceTier?: SourceTier;
}

export interface ImpactMapEdge {
  eventId: string;
  assetId: string;
  symbol: string;
  direction: Direction;
  impact: ImpactLevel;
  order: ImpactOrder;
}

export interface HeatmapCell {
  eventId: string;
  assetId: string;
  symbol: string;
  direction: Direction;
  impact: ImpactLevel;
}
