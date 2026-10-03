import type {
  MarketInstrument,
  MarketInterval,
} from "@alpha-radar/types/market-data";
import { ChevronDown } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

const quickSymbols = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE"];
const moreSymbols = ["ADA", "SUI", "LINK", "AVAX", "LTC", "BCH"];

export function ChartAssetSelector({
  instruments,
  selected,
  interval,
  moreLabel,
}: {
  instruments: MarketInstrument[];
  selected: MarketInstrument;
  interval: MarketInterval;
  moreLabel: string;
}) {
  const bySymbol = new Map(instruments.map((item) => [item.symbol, item]));
  const link = (instrument: MarketInstrument) =>
    `/chart?instrument=${encodeURIComponent(instrument.id)}&interval=${interval}`;
  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Contracts">
      {quickSymbols.map((symbol) => {
        const instrument = bySymbol.get(symbol);
        return instrument ? (
          <Link
            key={symbol}
            href={link(instrument)}
            aria-current={instrument.id === selected.id ? "page" : undefined}
            className={cn(
              "rounded px-3 py-2 font-mono text-xs text-[var(--muted)]",
              instrument.id === selected.id &&
                "bg-emerald-400/10 text-emerald-300",
            )}
          >
            {symbol}
          </Link>
        ) : null;
      })}
      <details className="relative">
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded px-3 py-2 text-xs text-[var(--muted)]">
          {moreLabel} <ChevronDown className="size-3" />
        </summary>
        <div className="absolute top-full right-0 z-20 mt-1 grid min-w-32 border bg-[var(--panel)] p-1 shadow-xl">
          {moreSymbols.map((symbol) => {
            const instrument = bySymbol.get(symbol);
            return instrument ? (
              <Link
                key={symbol}
                href={link(instrument)}
                className={cn(
                  "rounded px-3 py-2 font-mono text-xs hover:bg-white/[.04]",
                  instrument.id === selected.id && "text-emerald-300",
                )}
              >
                {symbol}
              </Link>
            ) : null;
          })}
        </div>
      </details>
    </nav>
  );
}
