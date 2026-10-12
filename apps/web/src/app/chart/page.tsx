import type { MarketInstrument } from "@alpha-radar/types/market-data";
import { DatabaseZap } from "lucide-react";

import { ChartWorkspace } from "@/components/chart-workspace";
import { getMarketInstruments } from "@/lib/api/assets";
import { getTranslations } from "@/lib/i18n/server";
import { getTechnicalMarketContext } from "@/lib/market/context";
import { parseMarketInterval } from "@/lib/market/intervals";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveInstrument(
  instruments: MarketInstrument[],
  value: string | undefined,
): MarketInstrument | undefined {
  return (
    instruments.find((instrument) => instrument.id === value) ??
    instruments.find(
      (instrument) => instrument.provider_instrument_id === "BTCUSDT",
    ) ??
    instruments[0]
  );
}

export default async function ChartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, messages } = await getTranslations();
  const query = await searchParams;
  const interval = parseMarketInterval(first(query.interval));
  let instruments: MarketInstrument[] = [];
  let apiUnavailable = false;
  try {
    instruments = (await getMarketInstruments()).items;
  } catch {
    apiUnavailable = true;
  }
  const instrument = resolveInstrument(instruments, first(query.instrument));
  const market = instrument
    ? await getTechnicalMarketContext(instrument.id, interval)
    : null;
  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-7">
      {instrument && market?.history ? (
        <ChartWorkspace
          key={instrument.id}
          instruments={instruments}
          instrument={instrument}
          initialInterval={interval}
          initialHistory={market.history}
          initialHigherHistory={market.higherTimeframeHistory}
          initialSnapshot={market.snapshot}
          currentPrice={market.currentPrice || null}
          locale={locale}
          messages={{
            chart: messages.chart,
            common: { notAvailable: messages.common.notAvailable },
          }}
        />
      ) : (
        <section className="mt-4 grid min-h-96 place-items-center border p-8 text-center">
          <div className="max-w-lg">
            <DatabaseZap className="mx-auto size-7 text-[var(--muted)]" />
            <h2 className="mt-4 font-semibold">
              {apiUnavailable
                ? messages.chart.apiUnavailable
                : messages.chart.historyUnavailable}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {messages.chart.insufficientDescription}
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
