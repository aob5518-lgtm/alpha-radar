import type { MarketInterval } from "@alpha-radar/types/market-data";

import { getMarketHistory, getMarketQuote } from "@/lib/api/assets";
import { higherMarketInterval } from "@/lib/market/intervals";
import { calculateTechnicalContext } from "@/lib/market/technical-context";

export async function getTechnicalMarketContext(
  assetId: string,
  interval: MarketInterval,
) {
  const higherInterval = higherMarketInterval[interval];
  const [quote, history, higherTimeframeHistory] = await Promise.all([
    getMarketQuote(assetId).catch(() => null),
    getMarketHistory(assetId, interval, 1000).catch(() => null),
    higherInterval
      ? getMarketHistory(assetId, higherInterval, 1000).catch(() => null)
      : Promise.resolve(null),
  ]);
  const lastClosed = history?.items.filter((item) => item.is_closed).at(-1);
  const currentPrice = Number(quote?.price ?? lastClosed?.close ?? 0);
  const snapshot =
    history && currentPrice > 0
      ? calculateTechnicalContext(
          history.items,
          currentPrice,
          interval,
          higherTimeframeHistory?.items,
        )
      : null;

  return {
    currentPrice,
    higherInterval,
    higherTimeframeHistory,
    history,
    quote,
    snapshot,
  };
}
