import { assetTypes } from "@alpha-radar/types/assets";
import {
  confidenceLevels,
  directions,
  eventTypes,
  horizons,
  importanceLevels,
  radarStatuses,
  radarTimeRanges,
  sourceTiers,
  type RadarAsset,
  type RadarFilters,
} from "@alpha-radar/types/radar";

export type RadarView = "timeline" | "impact" | "heatmap";
export interface RadarState {
  filters: RadarFilters;
  eventId?: string;
  view: RadarView;
}
const valid = <T extends string>(
  value: string | null,
  options: readonly T[],
): T | undefined => options.find((option) => option === value);

export function parseRadarState(
  params: URLSearchParams,
  assets: readonly RadarAsset[],
): RadarState {
  const assetQuery = params.get("asset")?.toLowerCase();
  return {
    filters: {
      timeRange: valid(params.get("range"), radarTimeRanges) ?? "7d",
      eventType: valid(params.get("type"), eventTypes),
      assetId: assets.find((asset) =>
        [asset.assetId, asset.slug, asset.symbol.toLowerCase()].includes(
          assetQuery ?? "",
        ),
      )?.assetId,
      assetType: valid(params.get("class"), assetTypes),
      direction: valid(params.get("direction"), directions),
      impact: valid(params.get("impact"), importanceLevels),
      confidence: valid(params.get("confidence"), confidenceLevels),
      status: valid(params.get("status"), radarStatuses),
      horizon: valid(params.get("horizon"), horizons),
      sourceTier: valid(params.get("source"), sourceTiers),
    },
    eventId: params.get("event") ?? undefined,
    view:
      valid(params.get("view"), ["timeline", "impact", "heatmap"] as const) ??
      "timeline",
  };
}

export function serializeRadarState(state: RadarState): string {
  const params = new URLSearchParams();
  const { filters } = state;
  const values = {
    range: filters.timeRange,
    type: filters.eventType,
    asset: filters.assetId,
    class: filters.assetType,
    direction: filters.direction,
    impact: filters.impact,
    confidence: filters.confidence,
    status: filters.status,
    horizon: filters.horizon,
    source: filters.sourceTier,
    event: state.eventId,
    view: state.view,
  };
  for (const [key, value] of Object.entries(values))
    if (value) params.set(key, value);
  return params.toString();
}
