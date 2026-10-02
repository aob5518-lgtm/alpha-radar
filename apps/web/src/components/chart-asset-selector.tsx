"use client";

import type { AssetSummary } from "@alpha-radar/types/assets";
import type { MarketInterval } from "@alpha-radar/types/market-data";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ChartAssetSelector({
  assets,
  selected,
  interval,
  label,
}: {
  assets: AssetSummary[];
  selected: AssetSummary;
  interval: MarketInterval;
  label: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(`${selected.symbol} · ${selected.name}`);
  function navigate(next: string) {
    setValue(next);
    const symbol = next.split(" · ")[0]?.toLowerCase();
    const asset = assets.find(
      (item) =>
        item.symbol.toLowerCase() === symbol ||
        item.name.toLowerCase() === next.toLowerCase(),
    );
    if (asset)
      router.push(
        `/chart?asset=${encodeURIComponent(asset.id)}&interval=${interval}`,
      );
  }
  return (
    <label className="text-[10px] text-[var(--muted)] uppercase">
      {label}
      <input
        list="chart-assets"
        value={value}
        onChange={(event) => navigate(event.target.value)}
        className="mt-1 block h-9 w-52 rounded border bg-transparent px-3 text-sm text-white"
      />
      <datalist id="chart-assets">
        {assets.map((asset) => (
          <option key={asset.id} value={`${asset.symbol} · ${asset.name}`} />
        ))}
      </datalist>
    </label>
  );
}
