import type { MarketCandle } from "@alpha-radar/types/market-data";

interface MarketHistoryChartProps {
  candles: MarketCandle[];
  label: string;
}

export function MarketHistoryChart({
  candles,
  label,
}: MarketHistoryChartProps) {
  const width = 640;
  const height = 180;
  const padding = 8;
  const closes = candles.map((candle) => Number(candle.close));
  const minimum = Math.min(...closes);
  const maximum = Math.max(...closes);
  const range = maximum - minimum;
  const denominator = Math.max(candles.length - 1, 1);
  const points = closes
    .map((close, index) => {
      const x = padding + (index / denominator) * (width - padding * 2);
      const normalized = range === 0 ? 0.5 : (close - minimum) / range;
      const y = height - padding - normalized * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="mt-6 h-44 w-full overflow-visible rounded-xl bg-zinc-950/40"
    >
      <polyline
        points={points}
        fill="none"
        stroke="rgb(52 211 153)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
