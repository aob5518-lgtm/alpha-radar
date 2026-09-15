import type {
  ConfidenceLevel,
  Horizon,
  ImpactLevel,
  IntelligenceKind,
  LocalizedText,
  PricedInLevel,
} from "./radar";

/** All contracts in this module are demo presentation contracts, not persisted domain entities. */
export const themeStages = [
  "emerging",
  "early",
  "accelerating",
  "crowded",
  "mature",
  "declining",
] as const;
export type ThemeStage = (typeof themeStages)[number];
export const opportunityStages = [
  "discovered",
  "researching",
  "watching",
  "preparing",
  "active",
  "maturing",
  "crowded",
  "exit_watch",
  "closed",
  "invalidated",
] as const;
export type OpportunityStage = (typeof opportunityStages)[number];
export const opportunityTypes = [
  "public_asset",
  "early_project",
  "airdrop",
  "ecosystem",
  "catalyst",
  "second_order",
] as const;
export type OpportunityType = (typeof opportunityTypes)[number];
export const cycleRegimes = [
  "accumulation",
  "early_expansion",
  "expansion",
  "euphoria",
  "distribution",
  "contraction",
] as const;
export type CycleRegime = (typeof cycleRegimes)[number];
export const strategicActions = [
  "research",
  "watch",
  "prepare",
  "interact",
  "wait",
  "avoid",
] as const;
export type StrategicAction = (typeof strategicActions)[number];
export const strategicKinds = [
  "fact",
  "analysis",
  "scenario",
  "model_output",
  "counterpoint",
  "invalidation",
] as const;
export type StrategicKind = IntelligenceKind | "counterpoint" | "invalidation";
export interface StrategicBlock {
  kind: StrategicKind;
  content: LocalizedText;
}
export interface DemoObject {
  id: string;
  isDemo: true;
  blocks: StrategicBlock[];
}
/** Ordinal fixture bands, never calibrated scores or promised returns. */
export type DemoBand = ConfidenceLevel;
export interface Theme extends DemoObject {
  slug: string;
  name: LocalizedText;
  description: LocalizedText;
  stage: ThemeStage;
  metrics: Record<
    | "attention"
    | "acceleration"
    | "capitalFlow"
    | "fundamentals"
    | "userGrowth"
    | "developerActivity"
    | "institutionalInterest"
    | "regulatoryTailwind"
    | "crowding",
    DemoBand
  >;
}
export interface Opportunity extends DemoObject {
  themeId: string;
  title: LocalizedText;
  summary: LocalizedText;
  stage: OpportunityStage;
  opportunityType: OpportunityType;
  affectedAssetIds: string[];
  relatedProjectIds: string[];
  catalystIds: string[];
  timeHorizon: Horizon;
  rewardPotential: DemoBand;
  riskLevel: DemoBand;
  capitalRequirement: DemoBand;
  timeRequirement: DemoBand;
  crowding: DemoBand;
  confidenceBand: ConfidenceLevel;
  thesis: LocalizedText;
  counterThesis: LocalizedText;
  invalidation: LocalizedText;
  watchNext: LocalizedText;
}
export interface EarlyProject extends DemoObject {
  themeId: string;
  name: LocalizedText;
  productStage: "prototype" | "testnet" | "mainnet";
  tokenStatus: "tokenless" | "announced" | "issued";
  dimensions: Record<
    | "userGrowth"
    | "revenueGrowth"
    | "tvlGrowth"
    | "volumeGrowth"
    | "developerActivity"
    | "socialAcceleration"
    | "funding"
    | "competitiveMoat"
    | "attention",
    DemoBand
  >;
}
export interface AirdropOpportunity extends DemoObject {
  opportunityId: string;
  projectId: string;
  tokenStatus: EarlyProject["tokenStatus"];
  officialAirdropStatus: "confirmed" | "not_announced" | "none";
  pointsProgram: "yes" | "no" | "unknown";
  opportunityBasis: LocalizedText;
  capitalRequirement: DemoBand;
  estimatedGasCostBand: DemoBand;
  timeRequirement: DemoBand;
  sybilRisk: DemoBand;
  dilutionRisk: DemoBand;
  lockupRisk: DemoBand;
  opportunityCost: DemoBand;
  rewardPotential: DemoBand;
  confidenceBand: ConfidenceLevel;
  action: StrategicAction;
}
export const catalystTypes = [
  "TGE",
  "token_unlock",
  "mainnet",
  "product_launch",
  "ETF_decision",
  "regulatory_vote",
  "earnings",
  "FOMC",
  "CPI",
  "upgrade",
  "conference",
  "governance",
] as const;
export type CatalystType = (typeof catalystTypes)[number];
export interface Catalyst extends DemoObject {
  title: LocalizedText;
  catalystType: CatalystType;
  scheduledAt: string | null;
  dateCertainty: "confirmed" | "tentative" | "unknown";
  impact: ImpactLevel;
  probabilityBand: DemoBand;
  pricedIn: PricedInLevel;
  affectedAssetIds: string[];
  preparationWindow: LocalizedText;
  status: "scheduled" | "watching" | "completed" | "cancelled";
}
export const exitTriggers = [
  "thesis_invalidation",
  "valuation_extreme",
  "crowding_extreme",
  "leverage_extreme",
  "retail_euphoria",
  "unlock_risk",
  "insider_distribution",
  "narrative_saturation",
  "momentum_deterioration",
] as const;
export type ExitTrigger = (typeof exitTriggers)[number];
export interface ExitFramework {
  triggers: ExitTrigger[];
  profitTakingFramework: LocalizedText;
  riskReductionConditions: LocalizedText;
  invalidationConditions: LocalizedText;
  timeStop: LocalizedText;
}
export interface StrategyPlaybook extends DemoObject {
  opportunityId: string;
  title: LocalizedText;
  thesis: LocalizedText;
  evidence: LocalizedText[];
  catalystIds: string[];
  scenarios: Record<"bull" | "base" | "bear", LocalizedText>;
  entryConditions: LocalizedText;
  invalidation: LocalizedText;
  risks: LocalizedText;
  watchNext: LocalizedText;
  timeHorizon: Horizon;
  capitalRequirement: DemoBand;
  action: StrategicAction;
  exit: ExitFramework;
}
export interface CycleReadiness extends DemoObject {
  regime: CycleRegime;
  readiness: DemoBand;
  dimensions: Record<
    | "liquidity"
    | "institutionalFlow"
    | "stablecoinLiquidity"
    | "marketBreadth"
    | "leverage"
    | "retailAttention"
    | "narrativeBreadth"
    | "macroSupport",
    DemoBand
  >;
  evidence: LocalizedText[];
  counterEvidence: LocalizedText[];
  confidenceBand: ConfidenceLevel;
  scenarioWindow: LocalizedText;
}
export interface BullMarketPhase extends DemoObject {
  name: LocalizedText;
  signals: LocalizedText;
  typicalBehavior: LocalizedText;
  research: LocalizedText;
  risks: LocalizedText;
  exitConsiderations: LocalizedText;
}
/** Future evaluation foundation. No performance tracking or calibration is implemented. */
export interface Outcome extends DemoObject {
  strategyId: string;
  prediction: LocalizedText;
  observationStart: string | null;
  observationEnd: string | null;
  result: "not_observed" | "pending" | "observed";
  returnPct: number | null;
  maxDrawdownPct: number | null;
  thesisCorrect: boolean | null;
  lessons: LocalizedText;
  modelVersion: string | null;
}
/** Demo adapter references, not backend Event foreign keys. */
export interface RadarStrategyReference {
  eventId: string;
  themeIds: string[];
  opportunityIds: string[];
  catalystIds: string[];
  isDemo: true;
}
