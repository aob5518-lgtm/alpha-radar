import type { MarketInterval } from "@alpha-radar/types/market-data";

import {
  getInstrumentHistory,
  getInstrumentQuote,
  getMarketInstrument,
} from "@/lib/api/assets";
import { higherMarketInterval } from "@/lib/market/intervals";
import { calculateTechnicalContext } from "@/lib/market/technical-context";
import { logTechnicalDiagnostics } from "@/lib/market/technical-diagnostics";

export async function getTechnicalMarketContext(
  instrumentId: string,
  interval: MarketInterval,
) {
  const higherInterval = higherMarketInterval[interval];
  let historyFetchMs = 0;
  const timedHistory = async (timeframe: MarketInterval) => {
    const started = performance.now();
    try {
      return await getInstrumentHistory(instrumentId, timeframe, 800);
    } finally {
      historyFetchMs = Math.max(historyFetchMs, performance.now() - started);
    }
  };
  const [instrument, quote, history, higherTimeframeHistory] =
    await Promise.all([
      getMarketInstrument(instrumentId).catch(() => null),
      getInstrumentQuote(instrumentId).catch(() => null),
      timedHistory(interval).catch(() => null),
      higherInterval
        ? timedHistory(higherInterval).catch(() => null)
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
          instrumentId,
          process.env.NODE_ENV === "development"
            ? (timings) =>
                logTechnicalDiagnostics(instrumentId, interval, {
                  ...timings,
                  history_fetch_ms: historyFetchMs,
                })
            : undefined,
        )
      : null;

  return {
    currentPrice,
    higherInterval,
    higherTimeframeHistory,
    history,
    instrument,
    quote,
    snapshot,
  };
}
