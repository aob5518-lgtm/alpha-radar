import type { MarketInterval } from "@alpha-radar/types/market-data";

import { parseMarketInterval } from "./intervals.ts";

export interface AnalystHandoff {
  asset: string;
  interval: MarketInterval;
  fromChart: boolean;
}

export function analystHref(asset: string, interval: MarketInterval): string {
  const params = new URLSearchParams({ asset, interval, from: "chart" });
  return `/analyst?${params.toString()}`;
}

export function parseAnalystHandoff(
  values: Record<string, string | string[] | undefined>,
): AnalystHandoff | null {
  const rawAsset = Array.isArray(values.asset) ? values.asset[0] : values.asset;
  if (!rawAsset?.trim()) return null;
  const rawInterval = Array.isArray(values.interval)
    ? values.interval[0]
    : values.interval;
  const rawFrom = Array.isArray(values.from) ? values.from[0] : values.from;
  return {
    asset: rawAsset.trim(),
    interval: parseMarketInterval(rawInterval),
    fromChart: rawFrom === "chart",
  };
}
