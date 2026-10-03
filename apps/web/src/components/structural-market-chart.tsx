"use client";

import type { StructuralLevel } from "@alpha-radar/types/core-3";
import type { MarketCandle } from "@alpha-radar/types/market-data";
import type { MarketInterval } from "@alpha-radar/types/market-data";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineStyle,
  createChart,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

import {
  updateLivePartialCandle,
  type LivePartialCandle,
} from "@/lib/market/live-candle";

interface Props {
  candles: MarketCandle[];
  levels: StructuralLevel[];
  currentPrice: number | null;
  assetId: string;
  interval: MarketInterval;
}

export function StructuralMarketChart({
  candles,
  levels,
  currentPrice,
  assetId,
  interval,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<{
    price: number;
    change: number | null;
  } | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, {
      height: 500,
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
    const closed = candles
      .filter((candle) => candle.is_closed)
      .map((candle) => ({
        time: Math.floor(Date.parse(candle.open_time) / 1000) as UTCTimestamp,
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      }));
    candleSeries.setData(closed);

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeries.setData(
      candles
        .filter((candle) => candle.is_closed && candle.volume !== null)
        .map((candle) => ({
          time: Math.floor(Date.parse(candle.open_time) / 1000) as UTCTimestamp,
          value: Number(candle.volume),
          color:
            Number(candle.close) >= Number(candle.open)
              ? "rgba(52,211,153,.28)"
              : "rgba(251,113,133,.28)",
        })),
    );

    for (const level of levels) {
      candleSeries.createPriceLine({
        price: level.representative_price,
        color: level.kind === "resistance" ? "#fb7185" : "#34d399",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: level.label,
      });
    }
    const liveLine =
      currentPrice !== null
        ? candleSeries.createPriceLine({
            price: currentPrice,
            color: "#f4f4f5",
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: "PRICE",
          })
        : null;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    const socketUrl = new URL(
      `/api/v1/assets/${encodeURIComponent(assetId)}/stream`,
      apiUrl,
    );
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(socketUrl);
    let current: LivePartialCandle | null = null;
    socket.onmessage = (message) => {
      const tick = JSON.parse(String(message.data)) as {
        type: string;
        price?: string;
        open_24h?: string | null;
        provider_timestamp?: string;
      };
      if (tick.type !== "tick" || !tick.price || !tick.provider_timestamp)
        return;
      const price = Number(tick.price);
      current = updateLivePartialCandle(
        current,
        price,
        Date.parse(tick.provider_timestamp) / 1000,
        interval,
      );
      candleSeries.update({ ...current, time: current.time as UTCTimestamp });
      liveLine?.applyOptions({ price });
      const open24 = tick.open_24h ? Number(tick.open_24h) : null;
      setLive({
        price,
        change: open24 && open24 > 0 ? ((price - open24) / open24) * 100 : null,
      });
    };
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(([entry]) => {
      if (entry) chart.applyOptions({ width: entry.contentRect.width });
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      socket.close();
      chart.remove();
    };
  }, [assetId, candles, currentPrice, interval, levels]);

  return (
    <div className="relative">
      <div ref={container} className="min-h-[500px] w-full" />
      {live && (
        <div className="absolute top-3 left-3 rounded bg-black/70 px-2 py-1 font-mono text-xs">
          <span className="mr-2 text-emerald-300">LIVE / PARTIAL</span>
          {live.price.toLocaleString()}{" "}
          {live.change !== null && (
            <span
              className={
                live.change >= 0 ? "text-emerald-300" : "text-rose-300"
              }
            >
              {live.change >= 0 ? "+" : ""}
              {live.change.toFixed(2)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
