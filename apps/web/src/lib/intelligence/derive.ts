import type {
  HeatmapCell,
  ImpactMapEdge,
  RadarAsset,
  RadarFilters,
  RadarItem,
  RadarTimeRange,
} from "@alpha-radar/types/radar";

export interface DiscoverFilters {
  assetClass?: string;
  catalyst?: string;
  impact?: string;
  confidence?: string;
  narrative?: string;
  capitalFlow?: "positive" | "mixed";
  risk?: "high" | "moderate" | "low";
}

const rangeMilliseconds: Record<RadarTimeRange, number> = {
  "1h": 60 * 60 * 1_000,
  "4h": 4 * 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
};

export function orderRadarItems(items: readonly RadarItem[]): RadarItem[] {
  return [...items].sort(
    (left, right) =>
      Date.parse(right.eventTime ?? right.detectedAt) -
      Date.parse(left.eventTime ?? left.detectedAt),
  );
}

export function filterRadarItems(
  items: readonly RadarItem[],
  filters: RadarFilters,
  referenceTime: string,
): RadarItem[] {
  const lowerBound =
    Date.parse(referenceTime) - rangeMilliseconds[filters.timeRange];

  return orderRadarItems(items).filter((item) => {
    const observedAt = Date.parse(item.detectedAt);
    if (observedAt < lowerBound || observedAt > Date.parse(referenceTime))
      return false;
    if (filters.eventType && item.eventType !== filters.eventType) return false;
    if (
      filters.assetId &&
      !item.assets.some((asset) => asset.assetId === filters.assetId)
    )
      return false;
    if (
      filters.assetType &&
      !item.assets.some((asset) => asset.assetType === filters.assetType)
    )
      return false;
    if (filters.impact && item.importance !== filters.impact) return false;
    if (filters.confidence && item.confidence !== filters.confidence)
      return false;
    if (filters.status && item.status !== filters.status) return false;
    if (
      filters.sourceTier &&
      !item.sources.some((source) => source.tier === filters.sourceTier)
    )
      return false;
    if (
      filters.direction &&
      !item.impacts.some((impact) => impact.direction === filters.direction)
    )
      return false;
    if (
      filters.horizon &&
      !item.impacts.some((impact) => impact.horizon === filters.horizon)
    )
      return false;
    return true;
  });
}

export function buildImpactMap(items: readonly RadarItem[]): ImpactMapEdge[] {
  return items.flatMap((item) =>
    item.impacts.map((impact) => ({
      eventId: item.id,
      assetId: impact.assetId,
      symbol: impact.symbol,
      direction: impact.direction,
      impact: impact.impact,
      order: impact.order,
    })),
  );
}

export function buildHeatmap(items: readonly RadarItem[]): HeatmapCell[] {
  return items.flatMap((item) =>
    item.impacts.map((impact) => ({
      eventId: item.id,
      assetId: impact.assetId,
      symbol: impact.symbol,
      direction: impact.direction,
      impact: impact.impact,
    })),
  );
}

export function relatedItemsForAsset(
  items: readonly RadarItem[],
  assetId: string,
): RadarItem[] {
  return orderRadarItems(
    items.filter((item) =>
      item.assets.some((asset) => asset.assetId === assetId),
    ),
  );
}

export function filterDiscoverAssets(
  assets: readonly RadarAsset[],
  items: readonly RadarItem[],
  filters: DiscoverFilters,
): RadarAsset[] {
  return assets.filter((asset) => {
    const events = relatedItemsForAsset(items, asset.assetId);
    return (
      (!filters.assetClass || asset.assetType === filters.assetClass) &&
      (!filters.catalyst ||
        events.some((event) => event.eventType === filters.catalyst)) &&
      (!filters.impact ||
        events.some((event) => event.importance === filters.impact)) &&
      (!filters.confidence ||
        events.some((event) => event.confidence === filters.confidence)) &&
      (!filters.narrative ||
        events.some((event) => event.narrative === filters.narrative)) &&
      (!filters.capitalFlow ||
        events.some((event) =>
          event.impacts.some(
            (entry) =>
              entry.assetId === asset.assetId &&
              (filters.capitalFlow === "positive"
                ? entry.direction === "bullish"
                : entry.direction === "mixed" || entry.direction === "neutral"),
          ),
        )) &&
      (!filters.risk ||
        events.some(
          (event) =>
            event.importance ===
            (filters.risk === "high"
              ? "high"
              : filters.risk === "moderate"
                ? "medium"
                : "low"),
        ))
    );
  });
}
