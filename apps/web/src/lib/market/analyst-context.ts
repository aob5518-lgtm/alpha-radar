import type { MarketInterval } from "@alpha-radar/types/market-data";

import { parseMarketInterval } from "./intervals.ts";

export interface AnalystHandoff {
  instrument: string;
  interval: MarketInterval;
  fromChart: boolean;
}

export function analystHref(
  instrument: string,
  interval: MarketInterval,
): string {
  const params = new URLSearchParams({ instrument, interval, from: "chart" });
  return `/analyst?${params.toString()}`;
}

export function parseAnalystHandoff(
  values: Record<string, string | string[] | undefined>,
): AnalystHandoff | null {
  const rawInstrument = Array.isArray(values.instrument)
    ? values.instrument[0]
    : values.instrument;
  if (!rawInstrument?.trim()) return null;
  const rawInterval = Array.isArray(values.interval)
    ? values.interval[0]
    : values.interval;
  const rawFrom = Array.isArray(values.from) ? values.from[0] : values.from;
  return {
    instrument: rawInstrument.trim(),
    interval: parseMarketInterval(rawInterval),
    fromChart: rawFrom === "chart",
  };
}
