"use client";

import { assetTypes } from "@alpha-radar/types/assets";
import {
  confidenceLevels,
  directions,
  eventTypes,
  horizons,
  impactLevels,
  radarStatuses,
  radarTimeRanges,
  sourceTiers,
  type RadarFilters,
  type RadarItem,
} from "@alpha-radar/types/radar";
import { ArrowDownRight, Grid3X3, ListTree, Network } from "lucide-react";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  parseRadarState,
  serializeRadarState,
  type RadarState,
} from "@/lib/intelligence/url-state";

import { DemoBadge } from "@/components/demo-badge";
import { EventCard } from "@/components/radar/event-card";
import { EventDrawer } from "@/components/radar/event-drawer";
import type { Locale } from "@/lib/i18n/config";
import { assetTypeLabel } from "@/lib/i18n/labels";
import {
  directionLabel,
  eventTypeLabel,
  impactLabel,
  sourceTierLabel,
  statusLabel,
  confidenceLabel,
  horizonLabel,
  orderLabel,
} from "@/lib/i18n/intelligence-labels";
import type { Messages } from "@/lib/i18n/messages";
import {
  allDemoAssets,
  DEMO_REFERENCE_TIME,
  demoRadarItems,
  localize,
} from "@/lib/intelligence/demo-data";
import {
  buildHeatmap,
  buildImpactMap,
  filterRadarItems,
} from "@/lib/intelligence/derive";
import {
  directionTone,
  impactTone,
  statusTone,
} from "@/lib/intelligence/presentation";
import { cn } from "@/lib/utils";

const emptyToUndefined = <T extends string>(value: string): T | undefined =>
  value ? (value as T) : undefined;

interface RadarWorkspaceProps {
  locale: Locale;
  messages: Messages;
}

export function RadarWorkspace({ locale, messages }: RadarWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = parseRadarState(
    new URLSearchParams(searchParams.toString()),
    allDemoAssets,
  );
  const { filters, view } = state;
  const selected = demoRadarItems.find((item) => item.id === state.eventId);
  const navigate = (next: RadarState) =>
    router.push(`${pathname}?${serializeRadarState(next)}`, { scroll: false });
  const selectItem = (item: RadarItem) =>
    navigate({ ...state, eventId: item.id });
  const setView = (view: RadarState["view"]) => navigate({ ...state, view });
  const visible = useMemo(
    () => filterRadarItems(demoRadarItems, filters, DEMO_REFERENCE_TIME),
    [filters],
  );
  const impactedAssets = new Set(
    visible.flatMap((item) => item.assets.map((asset) => asset.assetId)),
  ).size;
  const update = (next: Partial<RadarFilters>) =>
    navigate({ ...state, filters: { ...filters, ...next } });
  const metrics = [
    [
      messages.radar.highImpactEvents,
      visible.filter((item) => item.importance === "high").length,
    ],
    [
      messages.radar.breaking,
      visible.filter((item) => item.status === "breaking").length,
    ],
    [
      messages.radar.developing,
      visible.filter((item) => item.status === "developing").length,
    ],
    [
      messages.radar.bullish,
      visible.filter((item) =>
        item.impacts.some((impact) => impact.direction === "bullish"),
      ).length,
    ],
    [
      messages.radar.bearish,
      visible.filter((item) =>
        item.impacts.some((impact) => impact.direction === "bearish"),
      ).length,
    ],
    [messages.radar.assetsAffected, impactedAssets],
  ] as const;

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {metrics.map(([label, value]) => (
          <div key={label} className="panel p-4">
            <p className="text-xs text-[var(--muted)]">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>
      <section
        aria-label={messages.radar.filterLabel}
        className="panel mt-5 p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs text-[var(--muted)]">
            {messages.radar.timeRange}
            <select
              className="field-select mt-1"
              value={filters.timeRange}
              onChange={(event) =>
                update({
                  timeRange: event.target.value as RadarFilters["timeRange"],
                })
              }
            >
              {radarTimeRanges.map((range) => (
                <option key={range} value={range}>
                  {range.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <FilterSelect
            label={messages.radar.eventType}
            value={filters.eventType}
            onChange={(value) => update({ eventType: emptyToUndefined(value) })}
            all={messages.common.all}
            options={eventTypes.map((value) => [
              value,
              eventTypeLabel(value, messages),
            ])}
          />
          <FilterSelect
            label={messages.radar.asset}
            value={filters.assetId}
            onChange={(value) => update({ assetId: emptyToUndefined(value) })}
            all={messages.common.all}
            options={allDemoAssets.map((asset) => [
              asset.assetId,
              asset.symbol,
            ])}
          />
          <FilterSelect
            label={messages.radar.assetType}
            value={filters.assetType}
            onChange={(value) => update({ assetType: emptyToUndefined(value) })}
            all={messages.common.all}
            options={assetTypes.map((value) => [
              value,
              assetTypeLabel(value, messages),
            ])}
          />
          <FilterSelect
            label={messages.radar.direction}
            value={filters.direction}
            onChange={(value) => update({ direction: emptyToUndefined(value) })}
            all={messages.common.all}
            options={directions.map((value) => [
              value,
              directionLabel(value, messages),
            ])}
          />
          <FilterSelect
            label={messages.radar.impact}
            value={filters.impact}
            onChange={(value) => update({ impact: emptyToUndefined(value) })}
            all={messages.common.all}
            options={impactLevels.map((value) => [
              value,
              impactLabel(value, messages),
            ])}
          />
          <FilterSelect
            label={messages.radar.confidence}
            value={filters.confidence}
            onChange={(value) =>
              update({ confidence: emptyToUndefined(value) })
            }
            all={messages.common.all}
            options={confidenceLevels.map((value) => [
              value,
              confidenceLabel(value, messages),
            ])}
          />
          <FilterSelect
            label={messages.radar.status}
            value={filters.status}
            onChange={(value) => update({ status: emptyToUndefined(value) })}
            all={messages.common.all}
            options={radarStatuses.map((value) => [
              value,
              statusLabel(value, messages),
            ])}
          />
          <FilterSelect
            label={messages.radar.horizon}
            value={filters.horizon}
            onChange={(value) => update({ horizon: emptyToUndefined(value) })}
            all={messages.common.all}
            options={horizons.map((value) => [
              value,
              horizonLabel(value, messages),
            ])}
          />
          <FilterSelect
            label={messages.radar.sourceTier}
            value={filters.sourceTier}
            onChange={(value) =>
              update({ sourceTier: emptyToUndefined(value) })
            }
            all={messages.common.all}
            options={sourceTiers.map((value) => [
              value,
              sourceTierLabel(value, messages),
            ])}
          />
        </div>
        <button
          type="button"
          className="mt-4 text-xs font-semibold text-emerald-300 hover:text-emerald-200"
          onClick={() => navigate({ ...state, filters: { timeRange: "7d" } })}
        >
          {messages.common.resetFilters}
        </button>
      </section>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={messages.radar.viewLabel}
          className="inline-flex rounded-lg border bg-black/20 p-1"
        >
          <ViewButton
            active={view === "timeline"}
            onClick={() => setView("timeline")}
            label={messages.radar.timeline}
            icon={ListTree}
          />
          <ViewButton
            active={view === "impact"}
            onClick={() => setView("impact")}
            label={messages.radar.impactMap}
            icon={Network}
          />
          <ViewButton
            active={view === "heatmap"}
            onClick={() => setView("heatmap")}
            label={messages.radar.heatmap}
            icon={Grid3X3}
          />
        </div>
        <DemoBadge label={messages.common.sampleIntelligence} />
      </div>

      <section className="mt-5">
        {visible.length === 0 ? (
          <div className="panel py-20 text-center">
            <h2 className="text-lg font-semibold">
              {messages.radar.emptyTitle}
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {messages.radar.emptyDescription}
            </p>
          </div>
        ) : view === "timeline" ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {visible.map((item) => (
              <EventCard
                key={item.id}
                item={item}
                locale={locale}
                messages={messages}
                onSelect={selectItem}
              />
            ))}
          </div>
        ) : view === "impact" ? (
          <ImpactMap
            items={visible}
            locale={locale}
            messages={messages}
            onSelect={selectItem}
          />
        ) : (
          <Heatmap
            items={visible}
            locale={locale}
            messages={messages}
            onSelect={selectItem}
          />
        )}
      </section>
      {selected && (
        <EventDrawer
          item={selected}
          items={demoRadarItems}
          locale={locale}
          messages={messages}
          onClose={() => navigate({ ...state, eventId: undefined })}
          onSelect={selectItem}
        />
      )}
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  all,
  options,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  all: string;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <label className="text-xs text-[var(--muted)]">
      {label}
      <select
        className="field-select mt-1"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{all}</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: typeof ListTree;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold",
        active ? "bg-white/10 text-white" : "text-[var(--muted)]",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

function ImpactMap({
  items,
  locale,
  messages,
  onSelect,
}: {
  items: RadarItem[];
  locale: Locale;
  messages: Messages;
  onSelect: (item: RadarItem) => void;
}) {
  const edges = buildImpactMap(items);
  return (
    <div className="panel overflow-hidden">
      <div className="border-b p-5">
        <h2 className="font-semibold">{messages.radar.eventToAssets}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {messages.radar.impactMapDescription}
        </p>
      </div>
      <div className="divide-y">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            className="grid w-full gap-4 p-5 text-left hover:bg-white/[0.025] lg:grid-cols-[minmax(14rem,1fr)_2fr]"
          >
            <div>
              <span className={cn("data-pill", statusTone(item.status))}>
                {statusLabel(item.status, messages)}
              </span>
              <h3 className="mt-3 font-semibold">
                {localize(item.title, locale)}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {edges
                .filter((edge) => edge.eventId === item.id)
                .map((edge) => (
                  <span
                    key={edge.assetId}
                    className={cn("data-pill", directionTone(edge.direction))}
                  >
                    <ArrowDownRight
                      className={cn(
                        "size-3",
                        edge.order !== "first" && "opacity-50",
                      )}
                    />
                    {orderLabel(edge.order, messages)} · {edge.symbol} ·{" "}
                    {directionLabel(edge.direction, messages)}
                  </span>
                ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Heatmap({
  items,
  locale,
  messages,
  onSelect,
}: {
  items: RadarItem[];
  locale: Locale;
  messages: Messages;
  onSelect: (item: RadarItem) => void;
}) {
  const cells = buildHeatmap(items);
  const assets = [
    ...new Map(
      items
        .flatMap((item) => item.assets)
        .map((asset) => [asset.assetId, asset]),
    ).values(),
  ];
  return (
    <div className="panel overflow-hidden">
      <div className="border-b p-5">
        <h2 className="font-semibold">{messages.radar.heatmap}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {messages.radar.heatmapDescription}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 min-w-64 bg-[var(--card)] p-4 text-left">
                {messages.radar.eventType}
              </th>
              {assets.map((asset) => (
                <th key={asset.assetId} className="p-3 text-center">
                  {asset.symbol}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item) => (
              <tr key={item.id}>
                <th className="sticky left-0 bg-[var(--card)] p-3 text-left">
                  <button
                    type="button"
                    onClick={() => onSelect(item)}
                    className="max-w-64 text-left font-medium hover:text-emerald-300"
                  >
                    {localize(item.title, locale)}
                  </button>
                </th>
                {assets.map((asset) => {
                  const cell = cells.find(
                    (candidate) =>
                      candidate.eventId === item.id &&
                      candidate.assetId === asset.assetId,
                  );
                  return (
                    <td key={asset.assetId} className="p-2 text-center">
                      {cell ? (
                        <span
                          className={cn(
                            "data-pill justify-center",
                            directionTone(cell.direction),
                            impactTone(cell.impact),
                          )}
                        >
                          {directionLabel(cell.direction, messages)} ·{" "}
                          {impactLabel(cell.impact, messages)}
                        </span>
                      ) : (
                        <span
                          aria-label={messages.common.notAvailable}
                          className="text-zinc-700"
                        >
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
