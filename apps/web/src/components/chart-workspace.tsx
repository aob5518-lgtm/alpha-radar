"use client";

import type { StructuralLevel } from "@alpha-radar/types/core-3";
import type {
  MarketHistory,
  MarketInstrument,
  MarketInterval,
} from "@alpha-radar/types/market-data";
import { Activity, DatabaseZap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ChartAssetSelector } from "@/components/chart-asset-selector";
import { MaChartLayer } from "@/components/ma-chart-layer";
import { formatDateTime, formatMarketPrice } from "@/lib/i18n/format";
import type { Messages } from "@/lib/i18n/messages";
import { analystHref } from "@/lib/market/analyst-context";
import {
  ChartContextStore,
  chartIdentityKey,
  fetchChartHistory,
  type ChartContextEntry,
  type StreamCandle,
} from "@/lib/market/chart-context-store";
import {
  higherMarketInterval,
  marketIntervals,
  parseMarketInterval,
} from "@/lib/market/intervals";
import type { TechnicalContextSnapshot } from "@/lib/market/technical-context";
import { connectChartStream } from "@/lib/market/market-stream";
import { cn } from "@/lib/utils";
import { ChartHistoryReconciler } from "@/lib/market/chart-history-reconciler";
import type { ChartRefreshHealth } from "@/lib/market/chart-refresh-health";
import {
  createBrowserTechnicalComputer,
  observeChartLongTasks,
} from "@/lib/market/browser-technical-computer";

interface Props {
  instruments: MarketInstrument[];
  instrument: MarketInstrument;
  initialInterval: MarketInterval;
  initialHistory: MarketHistory;
  initialHigherHistory: MarketHistory | null;
  initialSnapshot: TechnicalContextSnapshot | null;
  currentPrice: number | null;
  locale: "en" | "zh-CN";
  messages: Pick<Messages, "chart"> & {
    common: Pick<Messages["common"], "notAvailable">;
  };
}

export function ChartWorkspace(props: Props) {
  const { instrument, messages, locale } = props;
  const [store] = useState(() => {
    const value = new ChartContextStore(
      fetchChartHistory,
      Date.now,
      undefined,
      createBrowserTechnicalComputer(),
    );
    value.seed(props.initialHistory, props.initialSnapshot);
    if (props.initialHigherHistory) value.seed(props.initialHigherHistory);
    value.sealSeed(instrument.id, props.initialInterval);
    value.select(instrument.id, props.initialInterval);
    return value;
  });
  const [interval, setInterval] = useState(props.initialInterval);
  const [view, setView] = useState<{ key: string; entry: ChartContextEntry }>(
    () => ({
      key: chartIdentityKey(instrument.id, interval),
      entry: store.context(instrument.id, interval)!,
    }),
  );
  const [health, setHealth] = useState<ChartRefreshHealth | "loading">(() =>
    store.peek(instrument.id, interval)?.history.items.length
      ? store.refreshHealth(instrument.id, interval)
      : "loading",
  );
  const reconciler = useRef<ChartHistoryReconciler | null>(null);
  const lifecycle = useRef<{ active: boolean } | null>(null);
  const selected = useRef({ instrumentId: instrument.id, interval });
  const observedPrice = useRef(props.currentPrice);
  const primaryReady = useRef<string | null>(null);
  const [streamReady, setStreamReady] = useState<string | null>(null);
  const switchTiming = useRef<{
    key: string;
    started: number;
    cacheHit: boolean;
    candles?: number;
  } | null>(null);

  const selectInterval = (next: MarketInterval, push = true) => {
    if (selected.current.interval === next) return;
    switchTiming.current = {
      key: chartIdentityKey(instrument.id, next),
      started: performance.now(),
      cacheHit: !!store.cachedContext(instrument.id, next),
    };
    selected.current = { instrumentId: instrument.id, interval: next };
    store.select(instrument.id, next);
    reconciler.current?.dispose();
    reconciler.current = null;
    primaryReady.current = null;
    setStreamReady(null);
    setInterval(next);
    const cached = store.cachedContext(instrument.id, next);
    setHealth(cached ? store.refreshHealth(instrument.id, next) : "loading");
    if (cached)
      setView({ key: chartIdentityKey(instrument.id, next), entry: cached });
    if (push) {
      const url = new URL(window.location.href);
      url.searchParams.set("instrument", instrument.id);
      url.searchParams.set("interval", next);
      window.history.pushState(null, "", url);
    }
  };

  useEffect(() => {
    store.select(instrument.id, interval);
    const stop = store.subscribe(() => {
      if (
        selected.current.instrumentId !== instrument.id ||
        selected.current.interval !== interval
      )
        return;
      const entry = store.context(instrument.id, interval);
      if (entry)
        setView({ key: chartIdentityKey(instrument.id, interval), entry });
    });
    const stopObserving = observeChartLongTasks();
    return () => {
      stop();
      stopObserving();
    };
  }, [store, instrument.id, interval]);

  useEffect(() => {
    // Deferring disposal survives React Strict Mode's development effect replay.
    let active = true;
    const token = { active: true };
    lifecycle.current = token;
    return () => {
      active = false;
      queueMicrotask(() => {
        if (!active && lifecycle.current === token) store.dispose();
      });
    };
  }, [store]);

  useEffect(() => {
    let disposed = false;
    const coordinator = new ChartHistoryReconciler(
      store,
      instrument.id,
      interval,
      (entry, status) => {
        if (
          !disposed &&
          selected.current.interval === interval &&
          selected.current.instrumentId === instrument.id
        ) {
          if (entry)
            setView({ key: chartIdentityKey(instrument.id, interval), entry });
          setHealth(status);
        }
      },
    );
    reconciler.current = coordinator;
    void coordinator.refresh();
    // Reconcile missed closed candles after a suspended tab/network session, not
    // on every tick or trade. The store uses canonical incremental history.
    const resume = () => {
      if (document.visibilityState === "visible") void coordinator.refresh();
    };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      coordinator.dispose();
      if (reconciler.current === coordinator) reconciler.current = null;
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [instrument.id, interval, store]);

  useEffect(() => {
    const pop = () => {
      const query = new URLSearchParams(window.location.search);
      const defaultInstrument =
        props.instruments.find(
          (item) => item.provider_instrument_id === "BTCUSDT",
        ) ?? props.instruments[0];
      if (
        (query.get("instrument") ?? defaultInstrument?.id) === instrument.id
      ) {
        const next = parseMarketInterval(query.get("interval") ?? undefined);
        if (selected.current.interval === next) return;
        selected.current = { instrumentId: instrument.id, interval: next };
        store.select(instrument.id, next);
        reconciler.current?.dispose();
        reconciler.current = null;
        primaryReady.current = null;
        setStreamReady(null);
        setInterval(next);
        const cached = store.cachedContext(instrument.id, next);
        setHealth(
          cached ? store.refreshHealth(instrument.id, next) : "loading",
        );
        if (cached)
          setView({
            key: chartIdentityKey(instrument.id, next),
            entry: cached,
          });
      }
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
    };
  }, [instrument.id, store, props.instruments]);

  const confirm = (value: StreamCandle, sourceInterval: MarketInterval) => {
    if (
      selected.current.instrumentId !== instrument.id ||
      selected.current.interval !== interval
    )
      return;
    if (!store.confirm(instrument.id, sourceInterval, value)) return;
    const entry = store.context(instrument.id, interval);
    if (entry)
      setView({ key: chartIdentityKey(instrument.id, interval), entry });
    reconciler.current?.confirmed();
  };

  useEffect(() => {
    const higher = higherMarketInterval[interval];
    if (!higher || streamReady !== chartIdentityKey(instrument.id, interval))
      return;
    let disposed = false;
    const url = new URL(
      `/api/v1/market-instruments/${encodeURIComponent(instrument.id)}/stream?interval=${higher}`,
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
    );
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const stopStream = connectChartStream(
      url.toString(),
      {
        message: (event) => {
          if (disposed || selected.current.interval !== interval) return;
          const update = JSON.parse(String(event.data)) as StreamCandle;
          if (
            update.type !== "candle" ||
            !update.is_closed ||
            !store.confirm(instrument.id, higher, update)
          )
            return;
          const entry = store.context(instrument.id, interval);
          if (entry)
            setView({ key: chartIdentityKey(instrument.id, interval), entry });
          reconciler.current?.confirmed();
        },
        resumed: () => {
          void reconciler.current?.refresh();
        },
      },
      (url) => new WebSocket(url),
    );
    return () => {
      disposed = true;
      stopStream();
    };
  }, [instrument.id, interval, store, streamReady]);

  const key = chartIdentityKey(instrument.id, interval);
  const entry = view.key === key ? view.entry : null;
  const snapshot = entry?.snapshot;
  useEffect(() => {
    const timing = switchTiming.current;
    if (!timing || view.key !== timing.key) return;
    if (timing.candles === undefined)
      timing.candles = performance.now() - timing.started;
    if (view.entry.analysisPending || !view.entry.snapshot) return;
    if (process.env.NODE_ENV === "development")
      console.info(
        JSON.stringify({
          event: "chart_timeframe_switch",
          identity: timing.key,
          cache_hit: timing.cacheHit,
          timeframe_switch_ms: performance.now() - timing.started,
          timeframe_switch_to_candles_ms: timing.candles,
          timeframe_switch_to_analysis_ms: performance.now() - timing.started,
        }),
      );
    switchTiming.current = null;
  }, [view]);
  return (
    <>
      <p className="sr-only">
        {instrument.provider_instrument_id} {messages.chart.perpetual} ·{" "}
        {messages.chart.currentPrice} · {instrument.venue ?? "Bybit"} ·{" "}
        {instrument.quote_currency}
      </p>
      <ChartAssetSelector
        instruments={props.instruments}
        selected={instrument}
        interval={interval}
        moreLabel={messages.chart.more}
      />
      <nav
        className="mt-4 flex flex-wrap items-center gap-1"
        aria-label={messages.chart.timeframe}
      >
        <span className="mr-2 text-[10px] font-semibold tracking-wider text-[var(--muted)] uppercase">
          {messages.chart.timeframe}
        </span>
        {marketIntervals.map((value) => (
          <a
            key={value}
            href={`/chart?instrument=${encodeURIComponent(instrument.id)}&interval=${value}`}
            aria-current={interval === value ? "page" : undefined}
            onClick={(event) => {
              if (
                event.button === 0 &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                selectInterval(value);
              }
            }}
            className={cn(
              "rounded px-3 py-2 font-mono text-xs text-[var(--muted)]",
              interval === value && "bg-emerald-400/10 text-emerald-300",
            )}
          >
            {value}
          </a>
        ))}
      </nav>
      <p className="mt-2 text-[10px] text-[var(--muted)]">
        {messages.chart.closedOnly}
        {snapshot &&
          ` · ${snapshot.version} · ${snapshot.trend.version} · ${snapshot.state.algorithm_version} · trade-setup-v1`}
      </p>
      {(health === "degraded" || health === "failed") && (
        <div
          role="alert"
          className="mt-4 border border-amber-300/25 p-3 text-xs"
        >
          {health === "degraded"
            ? messages.chart.contextDegraded
            : messages.chart.contextRefreshFailed}{" "}
          <button
            className="underline"
            onClick={() => {
              void reconciler.current?.refresh(true);
              store.retryAnalysis(instrument.id, interval);
            }}
          >
            {messages.chart.retryContext}
          </button>
        </div>
      )}
      {(entry?.analysisPending || entry?.analysisError) && (
        <p role="status" className="mt-3 text-xs text-amber-200">
          {entry.analysisError
            ? messages.chart.analysisUnavailable
            : messages.chart.analysisLoading}
          {entry.analysisError && (
            <button
              className="ml-2 underline"
              onClick={() => store.retryAnalysis(instrument.id, interval)}
            >
              {messages.chart.retryContext}
            </button>
          )}
        </p>
      )}
      {!entry ? (
        <div role="status" className="mt-4 border p-8 text-sm">
          {health === "failed"
            ? messages.chart.historyUnavailable
            : messages.chart.contextLoading}
        </div>
      ) : entry.history.items.length === 0 ? (
        <div className="mt-4 border p-8">
          <DatabaseZap />
          <p>{messages.chart.historyUnavailable}</p>
        </div>
      ) : (
        <section className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="overflow-hidden border bg-[var(--panel)]">
            <MaChartLayer
              key={`${instrument.id}:${interval}`}
              snapshot={snapshot}
              history={entry.history}
              levels={
                snapshot ? [...snapshot.resistances, ...snapshot.supports] : []
              }
              marketState={snapshot?.state}
              marketStateMarkers={snapshot?.markers ?? []}
              tradeSetup={entry.setup ?? undefined}
              currentPrice={observedPrice.current}
              instrumentId={instrument.id}
              interval={interval}
              onConfirmedCandle={(value) => confirm(value, interval)}
              onObservedPrice={(value) => {
                observedPrice.current = value;
                if (primaryReady.current !== key) {
                  primaryReady.current = key;
                  setStreamReady(key);
                }
              }}
              onStreamResume={() => {
                void reconciler.current?.refresh();
              }}
              onStreamDisconnected={() => {
                primaryReady.current = null;
                setStreamReady(null);
              }}
              instrumentLabel={`${instrument.provider_instrument_id} ${messages.chart.perpetual}`}
              providerLabel={instrument.venue ?? "Bybit"}
              quoteCurrency={instrument.quote_currency}
              analystHref={analystHref(instrument.id, interval)}
              openAnalystLabel={messages.chart.openAnalyst}
              liveLabel={messages.chart.live}
              delayedLabel={messages.chart.delayed}
              partialLabel={messages.chart.partial}
              closedLabel={messages.chart.closed}
              returnLatestLabel={messages.chart.returnLatest}
              locale={locale}
              chartMessages={messages.chart}
            />
          </div>
          {snapshot && (
            <aside className="space-y-4">
              <section className="border p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="section-label">{messages.chart.trend}</span>
                  <Activity className="size-4 text-emerald-300" />
                </div>
                <p className="mt-4 text-2xl font-semibold uppercase">
                  {messages.chart[snapshot.trend.direction]}
                </p>
                <p className="mt-1 font-mono text-sm text-[var(--muted)]">
                  {messages.chart.trendStrength}: {snapshot.trend.strength}/100
                </p>
                <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
                  {locale === "zh-CN"
                    ? messages.chart.trendDescription
                    : snapshot.trend.reason}
                </p>
              </section>
              <LevelTable
                title={messages.chart.resistance}
                levels={snapshot.resistances}
                locale={locale}
                quoteCurrency={instrument.quote_currency}
                messages={messages}
              />
              <LevelTable
                title={messages.chart.support}
                levels={snapshot.supports}
                locale={locale}
                quoteCurrency={instrument.quote_currency}
                messages={messages}
              />
            </aside>
          )}
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
    </>
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
  messages: Props["messages"];
}) {
  return (
    <section className="border p-4">
      <h2 className="section-label">{title}</h2>
      {!levels.length ? (
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
                  {formatDateTime(level.last_tested_at, locale, {
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
