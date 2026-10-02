import type { AssetSummary } from "@alpha-radar/types/assets";
import type { StructuralLevel } from "@alpha-radar/types/core-3";
import { Activity, ArrowRight, DatabaseZap } from "lucide-react";
import Link from "next/link";

import { StructuralMarketChart } from "@/components/structural-market-chart";
import { getAssets, getMarketHistory, getMarketQuote } from "@/lib/api/assets";
import { formatDateTime, formatMarketPrice } from "@/lib/i18n/format";
import { getTranslations } from "@/lib/i18n/server";
import { analystHref } from "@/lib/market/analyst-context";
import { marketIntervals, parseMarketInterval } from "@/lib/market/intervals";
import { calculateTechnicalSnapshot } from "@/lib/market/technical-levels";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function resolveAsset(
  assets: AssetSummary[],
  value: string | undefined,
): AssetSummary | undefined {
  const normalized = value?.toLowerCase();
  return (
    assets.find(
      (asset) =>
        asset.id === value ||
        asset.slug.toLowerCase() === normalized ||
        asset.symbol.toLowerCase() === normalized,
    ) ??
    assets.find((asset) => asset.slug === "bitcoin") ??
    assets[0]
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
  let assets: AssetSummary[] = [];
  let apiUnavailable = false;
  try {
    assets = (await getAssets({ pageSize: 100, assetType: "crypto" })).items;
  } catch {
    apiUnavailable = true;
  }
  const asset = resolveAsset(assets, first(query.asset));
  const [quote, history] = asset
    ? await Promise.all([
        getMarketQuote(asset.id).catch(() => null),
        getMarketHistory(asset.id, interval, 1000).catch(() => null),
      ])
    : [null, null];
  const lastClosed = history?.items.filter((item) => item.is_closed).at(-1);
  const currentPrice = Number(quote?.price ?? lastClosed?.close ?? 0);
  const snapshot =
    history && currentPrice > 0
      ? calculateTechnicalSnapshot(history.items, currentPrice, interval)
      : null;
  const levels = snapshot
    ? [...snapshot.resistances, ...snapshot.supports]
    : [];

  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-7">
      <header className="flex flex-col gap-4 border-b pb-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="section-label">{messages.chart.eyebrow}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {messages.chart.title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--muted)]">
            {messages.chart.description}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <form className="flex items-end gap-2" action="/chart">
            <label className="text-xs text-[var(--muted)]">
              {messages.chart.asset}
              <select
                name="asset"
                defaultValue={asset?.id}
                className="field-select mt-1 min-w-36"
              >
                {assets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.symbol} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <input type="hidden" name="interval" value={interval} />
            <button
              className="h-10 rounded-md border px-3 text-xs font-semibold"
              type="submit"
            >
              {messages.assets.apply}
            </button>
          </form>
          {asset && (
            <Link
              href={analystHref(asset.id, interval)}
              className="flex h-10 items-center gap-2 rounded-md border px-3 text-xs font-semibold text-emerald-300"
            >
              {messages.chart.openAnalyst} <ArrowRight className="size-3" />
            </Link>
          )}
        </div>
      </header>

      <nav
        className="mt-4 flex flex-wrap gap-1"
        aria-label={messages.chart.timeframe}
      >
        {marketIntervals.map((value) => (
          <Link
            key={value}
            href={`/chart?asset=${encodeURIComponent(asset?.id ?? "bitcoin")}&interval=${value}`}
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

      <section className="mt-4 grid gap-px border bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          label={
            asset
              ? `${asset.symbol} / ${quote?.quote_currency ?? history?.quote_currency ?? "—"}`
              : messages.chart.asset
          }
          value={asset?.name ?? "—"}
        />
        <Metric
          label={messages.chart.currentPrice}
          value={
            currentPrice > 0
              ? formatMarketPrice(
                  currentPrice,
                  locale,
                  quote?.quote_currency ?? history?.quote_currency ?? "USD",
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
          label={messages.chart.closedCandles}
          value={String(snapshot?.closedCandles.length ?? 0)}
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
            />
            <div className="flex flex-wrap justify-between gap-2 border-t px-4 py-3 text-xs text-[var(--muted)]">
              <span>{messages.chart.closedOnly}</span>
              <span>{messages.chart.algorithm}</span>
            </div>
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
                {snapshot?.trend.reason ??
                  messages.chart.insufficientDescription}
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
                  {messages.chart.touches}: {level.touch_count} ·{" "}
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
