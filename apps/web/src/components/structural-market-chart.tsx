"use client";

import type { StructuralLevel } from "@alpha-radar/types/core-3";
import type { MarketCandle } from "@alpha-radar/types/market-data";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineStyle,
  createChart,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

interface Props {
  candles: MarketCandle[];
  levels: StructuralLevel[];
  currentPrice: number | null;
}

export function StructuralMarketChart({
  candles,
  levels,
  currentPrice,
}: Props) {
  const container = useRef<HTMLDivElement>(null);

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
    if (currentPrice !== null) {
      candleSeries.createPriceLine({
        price: currentPrice,
        color: "#f4f4f5",
        lineWidth: 1,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: "PRICE",
      });
    }
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(([entry]) => {
      if (entry) chart.applyOptions({ width: entry.contentRect.width });
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [candles, currentPrice, levels]);

  return <div ref={container} className="min-h-[500px] w-full" />;
}
