"use client";

import type { StructuralLevel } from "@alpha-radar/types/core-3";
import type {
  MarketCandle,
  MarketHistory,
  MarketInterval,
} from "@alpha-radar/types/market-data";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineStyle,
  createChart,
  type LogicalRange,
  type UTCTimestamp,
} from "lightweight-charts";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  latestLogicalRange,
  mergeOlderCandles,
  preserveLogicalRange,
} from "@/lib/market/chart-history";
import {
  type LivePartialCandle,
  updateLivePartialCandle,
} from "@/lib/market/live-candle";

interface Props {
  history: MarketHistory;
  levels: StructuralLevel[];
  currentPrice: number | null;
  instrumentId: string;
  interval: MarketInterval;
  instrumentLabel: string;
  providerLabel: string;
  quoteCurrency: string;
  analystHref: string;
  openAnalystLabel: string;
  liveLabel: string;
  delayedLabel: string;
  partialLabel: string;
  closedLabel: string;
  returnLatestLabel: string;
}

type StreamMessage =
  | { type: "price"; price: string; provider_timestamp: string }
  | { type: "trade"; price: string; provider_timestamp: string }
  | {
      type: "candle";
      open_time: string;
      open: string;
      high: string;
      low: string;
      close: string;
      volume: string | null;
      is_closed: boolean;
    };

function candleData(candle: MarketCandle) {
  return {
    time: Math.floor(Date.parse(candle.open_time) / 1000) as UTCTimestamp,
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close),
  };
}

export function StructuralMarketChart(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const returnLatest = useRef<(() => void) | null>(null);
  const [price, setPrice] = useState(props.currentPrice);
  const [status, setStatus] = useState<{ live: boolean; closed: boolean }>({
    live: false,
    closed: false,
  });

  useEffect(() => {
    if (!container.current) return;
    let allCandles = props.history.items;
    let hasMore = props.history.has_more;
    let nextEnd = props.history.next_end;
    let loadingOlder = false;
    let lastMessageAt = 0;
    let partial: LivePartialCandle | null = null;
    const chart = createChart(container.current, {
      height: 540,
      width: container.current.clientWidth,
      layout: {
        background: { type: ColorType.Solid, color: "#0b111a" },
        textColor: "#a1a1aa",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.035)" },
        horzLines: { color: "rgba(255,255,255,0.035)" },
      },
      rightPriceScale: { borderColor: "#273140" },
      timeScale: { borderColor: "#273140", timeVisible: true },
      crosshair: {
        vertLine: { color: "#525d6d", style: LineStyle.Dashed },
        horzLine: { color: "#525d6d", style: LineStyle.Dashed },
      },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#fb7185",
      borderVisible: false,
      wickUpColor: "#34d399",
      wickDownColor: "#fb7185",
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const renderHistory = () => {
      const closed = allCandles.filter((candle) => candle.is_closed);
      candleSeries.setData(closed.map(candleData));
      volumeSeries.setData(
        closed
          .filter((candle) => candle.volume !== null)
          .map((candle) => ({
            time: candleData(candle).time,
            value: Number(candle.volume),
            color:
              Number(candle.close) >= Number(candle.open)
                ? "rgba(52,211,153,.28)"
                : "rgba(251,113,133,.28)",
          })),
      );
    };
    renderHistory();
    chart
      .timeScale()
      .setVisibleLogicalRange(latestLogicalRange(allCandles.length));
    returnLatest.current = () =>
      chart
        .timeScale()
        .setVisibleLogicalRange(latestLogicalRange(allCandles.length));
    for (const level of props.levels)
      candleSeries.createPriceLine({
        price: level.representative_price,
        color: level.kind === "resistance" ? "#fb7185" : "#34d399",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: level.label,
      });
    const fallbackPrice =
      props.currentPrice ?? Number(allCandles.at(-1)?.close ?? 0);
    const liveLine = candleSeries.createPriceLine({
      price: fallbackPrice,
      color: "#f4f4f5",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: "PRICE",
    });
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    const loadOlder = async (range: LogicalRange | null) => {
      if (!range || range.from > 20 || loadingOlder || !hasMore || !nextEnd)
        return;
      loadingOlder = true;
      try {
        const params = new URLSearchParams({
          interval: props.interval,
          limit: "200",
          end: nextEnd,
        });
        const response = await fetch(
          `${apiUrl}/api/v1/market-instruments/${encodeURIComponent(props.instrumentId)}/history?${params}`,
        );
        if (!response.ok) return;
        const page = (await response.json()) as MarketHistory;
        const priorLength = allCandles.length;
        allCandles = mergeOlderCandles(allCandles, page.items);
        hasMore = page.has_more;
        nextEnd = page.next_end;
        renderHistory();
        chart
          .timeScale()
          .setVisibleLogicalRange(
            preserveLogicalRange(range, allCandles.length - priorLength),
          );
      } finally {
        loadingOlder = false;
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(loadOlder);
    const socketUrl = new URL(
      `/api/v1/market-instruments/${encodeURIComponent(props.instrumentId)}/stream?interval=${props.interval}`,
      apiUrl,
    );
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(socketUrl);
    socket.onmessage = (message) => {
      const update = JSON.parse(String(message.data)) as StreamMessage;
      lastMessageAt = Date.now();
      setStatus((value) => ({ ...value, live: true }));
      if (update.type === "price") {
        const nextPrice = Number(update.price);
        liveLine.applyOptions({ price: nextPrice });
        setPrice(nextPrice);
        return;
      }
      if (update.type === "trade") {
        const tradePrice = Number(update.price);
        partial = updateLivePartialCandle(
          partial,
          tradePrice,
          Math.floor(Date.parse(update.provider_timestamp) / 1000),
          props.interval,
        );
        candleSeries.update({ ...partial, time: partial.time as UTCTimestamp });
        setPrice(tradePrice);
        setStatus({ live: true, closed: false });
        return;
      }
      if (update.type !== "candle") return;
      partial = {
        time: Math.floor(Date.parse(update.open_time) / 1000),
        open: Number(update.open),
        high: Number(update.high),
        low: Number(update.low),
        close: Number(update.close),
      };
      candleSeries.update({ ...partial, time: partial.time as UTCTimestamp });
      if (update.volume !== null)
        volumeSeries.update({
          time: partial.time as UTCTimestamp,
          value: Number(update.volume),
          color:
            partial.close >= partial.open
              ? "rgba(52,211,153,.28)"
              : "rgba(251,113,133,.28)",
        });
      liveLine.applyOptions({ price: partial.close });
      setPrice(partial.close);
      setStatus({ live: true, closed: update.is_closed });
    };
    socket.onclose = () => setStatus((value) => ({ ...value, live: false }));
    socket.onerror = () => setStatus((value) => ({ ...value, live: false }));
    const staleTimer = window.setInterval(() => {
      if (lastMessageAt && Date.now() - lastMessageAt > 10_000)
        setStatus((value) => ({ ...value, live: false }));
    }, 2_000);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) chart.applyOptions({ width: entry.contentRect.width });
    });
    observer.observe(container.current);
    return () => {
      window.clearInterval(staleTimer);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(loadOlder);
      returnLatest.current = null;
      observer.disconnect();
      socket.close();
      chart.remove();
    };
  }, [props]);

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <strong className="font-mono text-sm">{props.instrumentLabel}</strong>
          <span className="font-mono text-lg">
            {price?.toLocaleString(undefined, {
              maximumFractionDigits: price >= 100 ? 2 : 6,
            }) ?? "—"}{" "}
            {props.quoteCurrency}
          </span>
          <span className="text-[10px] text-[var(--muted)]">
            {props.providerLabel} ·{" "}
            {status.live ? props.liveLabel : props.delayedLabel}
            {status.live &&
              ` / ${status.closed ? props.closedLabel : props.partialLabel}`}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => returnLatest.current?.()}
            className="rounded border px-2 py-1 text-[10px] text-[var(--muted)]"
          >
            {props.returnLatestLabel}
          </button>
          <Link
            href={props.analystHref}
            className="flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-semibold text-emerald-300"
          >
            {props.openAnalystLabel} <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>
      <div ref={container} className="min-h-[540px] w-full" />
    </div>
  );
}
