import type {
  ConfidenceLevel,
  Direction,
  EventType,
  Horizon,
  ImpactLevel,
  ImpactOrder,
  IntelligenceKind,
  PricedInLevel,
  RadarStatus,
  SourceTier,
} from "@alpha-radar/types/radar";

import type { Messages } from "./messages";

export const eventTypeLabel = (value: EventType, messages: Messages): string =>
  messages.labels.eventTypes[value];
export const statusLabel = (value: RadarStatus, messages: Messages): string =>
  messages.labels.statuses[value];
export const directionLabel = (value: Direction, messages: Messages): string =>
  messages.labels.directions[value];
export const impactLabel = (value: ImpactLevel, messages: Messages): string =>
  messages.labels.impacts[value];
export const confidenceLabel = (
  value: ConfidenceLevel,
  messages: Messages,
): string => messages.labels.confidence[value];
export const horizonLabel = (value: Horizon, messages: Messages): string =>
  messages.labels.horizons[value];
export const orderLabel = (value: ImpactOrder, messages: Messages): string =>
  messages.labels.orders[value];
export const pricedInLabel = (
  value: PricedInLevel,
  messages: Messages,
): string => messages.labels.pricedIn[value];
export const sourceTierLabel = (
  value: SourceTier,
  messages: Messages,
): string => messages.labels.sourceTiers[value];
export const intelligenceKindLabel = (
  value: IntelligenceKind,
  messages: Messages,
): string => messages.labels.intelligenceKinds[value];
