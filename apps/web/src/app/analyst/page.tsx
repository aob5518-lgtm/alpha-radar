import type { AnalystMarketContext } from "@alpha-radar/types/core-3";
import { Bot, Database, LockKeyhole, Send } from "lucide-react";

import { getAsset } from "@/lib/api/assets";
import { formatMarketPrice } from "@/lib/i18n/format";
import { getTranslations } from "@/lib/i18n/server";
import { parseAnalystHandoff } from "@/lib/market/analyst-context";
import { getTechnicalMarketContext } from "@/lib/market/context";
import {
  TECHNICAL_LEVELS_VERSION,
  TREND_REGIME_VERSION,
} from "@/lib/market/technical-levels";

export const dynamic = "force-dynamic";

export default async function AnalystPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, messages } = await getTranslations();
  const handoff = parseAnalystHandoff(await searchParams);
  const asset = handoff
    ? await getAsset(handoff.asset).catch(() => null)
    : null;
  const marketContext =
    asset && handoff
      ? await getTechnicalMarketContext(asset.id, handoff.interval)
      : null;
  const { history = null, quote = null, snapshot = null } = marketContext ?? {};
  const lastClosed = history?.items.filter((item) => item.is_closed).at(-1);
  const context: AnalystMarketContext | null =
    asset && handoff
      ? {
          asset_id: asset.id,
          symbol: asset.symbol,
          timeframe: handoff.interval,
          current_price: quote?.price ?? lastClosed?.close ?? null,
          quote_currency:
            quote?.quote_currency ?? history?.quote_currency ?? null,
          market_data_freshness: quote?.freshness ?? "unavailable",
          market_data_observed_at: quote?.observed_at ?? null,
          levels: snapshot
            ? [...snapshot.resistances, ...snapshot.supports]
            : [],
          trend: snapshot?.trend ?? {
            direction: "unavailable",
            strength: 0,
            version: TREND_REGIME_VERSION,
            breakdown: {
              market_structure: 0,
              ema_ordering: 0,
              ema_slopes: 0,
              price_location: 0,
              adx: 0,
              higher_timeframe_alignment: null,
            },
            reason: messages.chart.insufficientDescription,
          },
          recent_event_ids: [],
          source_document_ids: [],
          generated_at: new Date().toISOString(),
          technical_model_version: TECHNICAL_LEVELS_VERSION,
        }
      : null;

  const resistance =
    context?.levels.filter((level) => level.kind === "resistance") ?? [];
  const support =
    context?.levels.filter((level) => level.kind === "support") ?? [];

  return (
    <main className="page-shell">
      <header className="flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-label">{messages.analyst.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {messages.analyst.title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            {messages.analyst.description}
          </p>
        </div>
        {handoff?.fromChart && (
          <span className="data-pill text-emerald-300">
            {messages.analyst.contextFromChart}
          </span>
        )}
      </header>

      <section className="mt-5 grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="border p-4">
            <div className="flex items-center gap-2">
              <Database className="size-4 text-emerald-300" />
              <h2 className="text-sm font-semibold">
                {messages.analyst.contextTitle}
              </h2>
            </div>
            {context ? (
              <dl className="mt-4 space-y-3 text-xs">
                <ContextRow
                  label={messages.chart.asset}
                  value={context.symbol}
                />
                <ContextRow
                  label={messages.chart.timeframe}
                  value={context.timeframe}
                />
                <ContextRow
                  label={messages.chart.currentPrice}
                  value={
                    context.current_price && context.quote_currency
                      ? formatMarketPrice(
                          Number(context.current_price),
                          locale,
                          context.quote_currency,
                        )
                      : messages.common.notAvailable
                  }
                />
                <ContextRow
                  label={messages.chart.freshness}
                  value={context.market_data_freshness}
                />
                <ContextRow
                  label={messages.chart.trend}
                  value={`${context.trend.direction.toUpperCase()} · ${context.trend.strength}/100`}
                />
                <ContextRow
                  label={`${messages.chart.resistance} / ${messages.chart.support}`}
                  value={`${resistance.length} / ${support.length}`}
                />
              </dl>
            ) : (
              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                {messages.analyst.noContext}
              </p>
            )}
          </div>
          <div className="border p-4">
            <div className="flex items-center gap-2">
              <LockKeyhole className="size-4 text-amber-300" />
              <h2 className="text-sm font-semibold">
                {messages.analyst.guardrailTitle}
              </h2>
            </div>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
              {messages.analyst.guardrailDescription}
            </p>
          </div>
        </aside>

        <div className="border bg-[var(--panel)]">
          <div className="flex items-center gap-3 border-b p-4">
            <Bot className="size-5 text-emerald-300" />
            <div>
              <h2 className="text-sm font-semibold">
                {messages.analyst.disabled}
              </h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {messages.analyst.answerUnavailable}
              </p>
            </div>
          </div>
          <div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">
            <OutputSection
              title={messages.analyst.marketState}
              body={
                context
                  ? messages.analyst.answerUnavailable
                  : messages.analyst.dataUnavailable
              }
            />
            <OutputSection
              title={messages.analyst.trend}
              body={context?.trend.reason ?? messages.analyst.dataUnavailable}
            />
            <OutputSection
              title={messages.analyst.keyResistance}
              body={formatLevels(resistance)}
            />
            <OutputSection
              title={messages.analyst.keySupport}
              body={formatLevels(support)}
            />
            <OutputSection
              title={messages.analyst.importantEvents}
              body={messages.analyst.eventsUnavailable}
            />
            <OutputSection
              title={messages.analyst.bullCase}
              body={messages.analyst.answerUnavailable}
            />
            <OutputSection
              title={messages.analyst.bearCase}
              body={messages.analyst.answerUnavailable}
            />
            <OutputSection
              title={messages.analyst.triggers}
              body={messages.analyst.answerUnavailable}
            />
            <OutputSection
              title={messages.analyst.invalidation}
              body={messages.analyst.answerUnavailable}
            />
            <OutputSection
              title={messages.analyst.watchNext}
              body={messages.analyst.answerUnavailable}
            />
          </div>
          <div className="flex border-t p-3 opacity-60">
            <input
              disabled
              placeholder={messages.analyst.placeholder}
              aria-label={messages.analyst.placeholder}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm"
            />
            <button
              disabled
              aria-label={messages.analyst.disabled}
              className="icon-button"
            >
              <Send className="size-4" />
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-t pt-3 first:border-0 first:pt-0">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="text-right font-mono">{value}</dd>
    </div>
  );
}

function OutputSection({ title, body }: { title: string; body: string }) {
  return (
    <section className="min-h-28 bg-[var(--panel)] p-4">
      <h3 className="text-xs font-semibold tracking-wide uppercase">{title}</h3>
      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{body}</p>
    </section>
  );
}

function formatLevels(levels: AnalystMarketContext["levels"]): string {
  return levels.length > 0
    ? levels
        .map((level) => `${level.label} ${level.representative_price}`)
        .join(" · ")
    : "—";
}
