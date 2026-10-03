import type { StructuralLevel } from "@alpha-radar/types/core-3";
import type { MarketInstrument } from "@alpha-radar/types/market-data";
import { Activity, ArrowRight, DatabaseZap } from "lucide-react";
import Link from "next/link";

import { StructuralMarketChart } from "@/components/structural-market-chart";
import { ChartAssetSelector } from "@/components/chart-asset-selector";
import { getMarketInstruments } from "@/lib/api/assets";
import { formatDateTime, formatMarketPrice } from "@/lib/i18n/format";
import { getTranslations } from "@/lib/i18n/server";
import { analystHref } from "@/lib/market/analyst-context";
import { getTechnicalMarketContext } from "@/lib/market/context";
import { marketIntervals, parseMarketInterval } from "@/lib/market/intervals";
import { cn } from "@/lib/utils";

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
  const marketContext = instrument
    ? await getTechnicalMarketContext(instrument.id, interval)
    : null;
  const {
    currentPrice = 0,
    history = null,
    quote = null,
    snapshot = null,
  } = marketContext ?? {};
  const levels = snapshot
    ? [...snapshot.resistances, ...snapshot.supports]
    : [];

  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-7">
      <header className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-mono text-xl font-semibold">
              {instrument?.provider_instrument_id ?? "—"}{" "}
              {messages.chart.perpetual}
            </h1>
            <span className="font-mono text-xl">
              {currentPrice > 0
                ? formatMarketPrice(currentPrice, locale, "USDT")
                : "—"}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {instrument?.venue ?? "Bybit"} ·{" "}
            {quote
              ? messages.market.freshness[quote.freshness]
              : messages.chart.unavailable}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {instrument && (
            <Link
              href={analystHref(instrument.id, interval)}
              className="flex h-10 items-center gap-2 rounded-md border px-3 text-xs font-semibold text-emerald-300"
            >
              {messages.chart.openAnalyst} <ArrowRight className="size-3" />
            </Link>
          )}
        </div>
      </header>

      {instrument && (
        <div className="mt-4">
          <ChartAssetSelector
            instruments={instruments}
            selected={instrument}
            interval={interval}
            moreLabel={messages.chart.more}
          />
        </div>
      )}

      <nav
        className="mt-4 flex flex-wrap items-center gap-1"
        aria-label={messages.chart.timeframe}
      >
        <span className="mr-2 text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase">
          {messages.chart.timeframe}
        </span>
        {marketIntervals.map((value) => (
          <Link
            key={value}
            href={`/chart?instrument=${encodeURIComponent(instrument?.id ?? "")}&interval=${value}`}
            aria-current={interval === value ? "page" : undefined}
            className={cn(
              "rounded px-3 py-2 font-mono text-xs text-[var(--muted)]",
              interval === value && "bg-emerald-400/10 text-emerald-300",
            )}
          >
            {value}
          </Link>
        ))}
      </nav>
      <p className="mt-2 text-[10px] text-[var(--muted)]">
        {messages.chart.closedOnly}
      </p>

      <section className="mt-4 grid gap-px border bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label={messages.chart.currentPrice}
          value={
            currentPrice > 0
              ? formatMarketPrice(
                  currentPrice,
                  locale,
                  quote?.quote_currency ?? history?.quote_currency ?? "USDT",
                )
              : "—"
          }
        />
        <Metric
          label={messages.chart.provider}
          value={quote?.provider ?? history?.provider ?? "—"}
        />
        <Metric
          label={messages.chart.freshness}
          value={
            quote
              ? messages.market.freshness[quote.freshness]
              : messages.chart.unavailable
          }
        />
        <Metric
          label={messages.chart.trend}
          value={`${messages.chart[snapshot?.trend.direction ?? "unavailable"]} ${snapshot?.trend.strength ?? 0}`}
        />
      </section>

      {apiUnavailable ? (
        <EmptyState
          title={messages.chart.apiUnavailable}
          body={messages.chart.insufficientDescription}
        />
      ) : !history || history.items.length === 0 ? (
        <EmptyState
          title={messages.chart.historyUnavailable}
          body={messages.chart.insufficientDescription}
        />
      ) : (
        <section className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="overflow-hidden border bg-[var(--panel)]">
            <StructuralMarketChart
              candles={history.items}
              levels={levels}
              currentPrice={currentPrice || null}
              instrumentId={instrument!.id}
              interval={interval}
              liveLabel={messages.chart.live}
              partialLabel={messages.chart.partial}
              closedLabel={messages.chart.closed}
            />
          </div>
          <aside className="space-y-4">
            <section className="border p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="section-label">{messages.chart.trend}</span>
                <Activity className="size-4 text-emerald-300" />
              </div>
              <p className="mt-4 text-2xl font-semibold uppercase">
                {messages.chart[snapshot?.trend.direction ?? "unavailable"]}
              </p>
              <p className="mt-1 font-mono text-sm text-[var(--muted)]">
                {messages.chart.trendStrength}: {snapshot?.trend.strength ?? 0}
                /100
              </p>
              <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
                {snapshot
                  ? locale === "zh-CN"
                    ? messages.chart.trendDescription
                    : snapshot.trend.reason
                  : messages.chart.insufficientDescription}
              </p>
            </section>
            <LevelTable
              title={messages.chart.resistance}
              levels={snapshot?.resistances ?? []}
              locale={locale}
              quoteCurrency={quote?.quote_currency ?? history.quote_currency}
              messages={messages}
            />
            <LevelTable
              title={messages.chart.support}
              levels={snapshot?.supports ?? []}
              locale={locale}
              quoteCurrency={quote?.quote_currency ?? history.quote_currency}
              messages={messages}
            />
          </aside>
        </section>
      )}

      {snapshot?.insufficientData && (
        <div className="mt-4 border border-amber-300/25 bg-amber-300/5 p-4 text-sm">
          <strong>{messages.chart.insufficientTitle}</strong>
          <p className="mt-1 text-[var(--muted)]">
            {messages.chart.insufficientDescription}
          </p>
        </div>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--panel)] p-3">
      <p className="text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-sm">{value}</p>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <section className="mt-4 grid min-h-96 place-items-center border p-8 text-center">
      <div className="max-w-lg">
        <DatabaseZap className="mx-auto size-7 text-[var(--muted)]" />
        <h2 className="mt-4 font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{body}</p>
      </div>
    </section>
  );
}

function LevelTable({
  title,
  levels,
  locale,
  quoteCurrency,
  messages,
}: {
  title: string;
  levels: StructuralLevel[];
  locale: "en" | "zh-CN";
  quoteCurrency: string;
  messages: Awaited<ReturnType<typeof getTranslations>>["messages"];
}) {
  return (
    <section className="border p-4">
      <h2 className="section-label">{title}</h2>
      {levels.length === 0 ? (
        <p className="mt-4 text-xs text-[var(--muted)]">
          {messages.common.notAvailable}
        </p>
      ) : (
        <div className="mt-3 divide-y">
          {levels.map((level) => (
            <div
              key={level.id}
              className="grid grid-cols-[2rem_1fr_auto] gap-2 py-3 text-xs"
            >
              <strong>{level.label}</strong>
              <div>
                <p className="font-mono">
                  {formatMarketPrice(
                    level.representative_price,
                    locale,
                    quoteCurrency,
                  )}
                </p>
                <p className="mt-1 text-[var(--muted)]">
                  {messages.chart.pivots}: {level.pivot_count} ·{" "}
                  {messages.chart.distance}: {level.distance_percent.toFixed(2)}
                  %
                </p>
              </div>
              <div className="text-right text-[var(--muted)]">
                <p>{level.strength}/100</p>
                <p className="mt-1">
                  {formatDateTime(level.last_tested_at, locale)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
