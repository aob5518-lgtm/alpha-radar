import type {
  ConfidenceLevel,
  EventType,
  ImpactLevel,
} from "@alpha-radar/types/radar";
import { Filter, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { DemoBadge } from "@/components/demo-badge";
import { assetTypeLabel } from "@/lib/i18n/labels";
import {
  confidenceLabel,
  directionLabel,
  eventTypeLabel,
  impactLabel,
} from "@/lib/i18n/intelligence-labels";
import { getTranslations } from "@/lib/i18n/server";
import {
  allDemoAssets,
  demoRadarItems,
  localize,
} from "@/lib/intelligence/demo-data";
import {
  filterDiscoverAssets,
  relatedItemsForAsset,
} from "@/lib/intelligence/derive";

interface DiscoverPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}
const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function DiscoverPage({
  searchParams,
}: DiscoverPageProps) {
  const { locale, messages } = await getTranslations();
  const query = await searchParams;
  const assetClass = first(query.class);
  const catalyst = first(query.catalyst) as EventType | undefined;
  const impact = first(query.impact) as ImpactLevel | undefined;
  const confidence = first(query.confidence) as ConfidenceLevel | undefined;
  const narrative = first(query.narrative);
  const capitalFlow = first(query.capital_flow);
  const risk = first(query.risk);
  const assets = filterDiscoverAssets(allDemoAssets, demoRadarItems, {
    assetClass,
    catalyst,
    impact,
    confidence,
    narrative,
    capitalFlow:
      capitalFlow === "positive" || capitalFlow === "mixed"
        ? capitalFlow
        : undefined,
    risk:
      risk === "high" || risk === "moderate" || risk === "low"
        ? risk
        : undefined,
  });

  return (
    <main className="page-shell">
      <header className="border-b pb-7">
        <p className="section-label">{messages.discover.eyebrow}</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              {messages.discover.title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              {messages.discover.description}
            </p>
          </div>
          <DemoBadge label={messages.common.demoData} />
        </div>
      </header>
      <form className="panel mt-6 grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
        <Select
          name="class"
          label={messages.discover.class}
          value={assetClass}
          all={messages.common.all}
          options={[
            ...new Set(allDemoAssets.map((asset) => asset.assetType)),
          ].map((value) => [
            value,
            assetTypeLabel(
              value as Parameters<typeof assetTypeLabel>[0],
              messages,
            ),
          ])}
        />
        <Select
          name="catalyst"
          label={messages.discover.catalyst}
          value={catalyst}
          all={messages.common.all}
          options={(
            [
              "macro",
              "regulation",
              "earnings",
              "etf",
              "market_structure",
            ] as EventType[]
          ).map((value) => [value, eventTypeLabel(value, messages)])}
        />
        <Select
          name="narrative"
          label={messages.discover.narrative}
          value={narrative}
          all={messages.common.all}
          options={[
            ["liquidity", messages.home.liquidity],
            ["institutional_adoption", messages.home.institutionalAdoption],
            ["ai_infrastructure", messages.home.aiInfrastructure],
            ["regulatory_clarity", messages.home.regulatoryClarity],
          ]}
        />
        <Select
          name="impact"
          label={messages.radar.impact}
          value={impact}
          all={messages.common.all}
          options={(["high", "medium", "low"] as ImpactLevel[]).map((value) => [
            value,
            impactLabel(value, messages),
          ])}
        />
        <Select
          name="capital_flow"
          label={messages.discover.capitalFlow}
          value={capitalFlow}
          all={messages.common.all}
          options={[
            ["positive", messages.discover.positive],
            ["mixed", messages.discover.mixed],
          ]}
        />
        <Select
          name="risk"
          label={messages.discover.risk}
          value={risk}
          all={messages.common.all}
          options={[
            ["high", messages.discover.high],
            ["moderate", messages.discover.moderate],
            ["low", messages.discover.low],
          ]}
        />
        <div className="flex items-end gap-2">
          <Select
            name="confidence"
            label={messages.radar.confidence}
            value={confidence}
            all={messages.common.all}
            options={(["high", "medium", "low"] as ConfidenceLevel[]).map(
              (value) => [value, confidenceLabel(value, messages)],
            )}
          />
          <button
            className="grid h-10 shrink-0 place-items-center rounded-lg bg-emerald-400 px-4 text-zinc-950"
            aria-label={messages.assets.apply}
          >
            <Filter className="size-4" />
          </button>
        </div>
      </form>
      {assets.length === 0 ? (
        <div className="panel mt-6 py-20 text-center">
          <h2 className="font-semibold">{messages.discover.emptyTitle}</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {messages.discover.emptyDescription}
          </p>
        </div>
      ) : (
        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          {assets.map((asset) => {
            const events = relatedItemsForAsset(demoRadarItems, asset.assetId);
            const primary = events[0];
            const primaryImpact = primary?.impacts.find(
              (entry) => entry.assetId === asset.assetId,
            );
            const score =
              50 +
              Math.min(
                39,
                events.length * 8 + (primaryImpact?.impact === "high" ? 10 : 0),
              );
            return (
              <article key={asset.assetId} className="panel p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-mono text-xl font-bold text-emerald-300">
                      {asset.symbol}
                    </span>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {localize(asset.name, locale)} ·{" "}
                      {assetTypeLabel(
                        asset.assetType as Parameters<typeof assetTypeLabel>[0],
                        messages,
                      )}
                    </p>
                  </div>
                  <DemoBadge label={messages.common.demoData} />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3">
                  <MiniField
                    label={messages.discover.sampleScore}
                    value={String(score)}
                  />
                  <MiniField
                    label={messages.radar.impact}
                    value={
                      primary ? impactLabel(primary.importance, messages) : "—"
                    }
                  />
                  <MiniField
                    label={messages.radar.confidence}
                    value={
                      primary
                        ? confidenceLabel(primary.confidence, messages)
                        : "—"
                    }
                  />
                </div>
                <dl className="mt-5 grid gap-3 border-t pt-4 sm:grid-cols-2">
                  <DiscoveryField
                    label={messages.discover.catalyst}
                    value={
                      primary
                        ? eventTypeLabel(primary.eventType, messages)
                        : "—"
                    }
                  />
                  <DiscoveryField
                    label={messages.discover.narrative}
                    value={
                      primary
                        ? discoverNarrativeLabel(primary.narrative, messages)
                        : "—"
                    }
                  />
                  <DiscoveryField
                    label={messages.discover.capitalFlow}
                    value={
                      primaryImpact
                        ? directionLabel(primaryImpact.direction, messages)
                        : "—"
                    }
                  />
                  <DiscoveryField
                    label={messages.discover.risk}
                    value={
                      primary ? impactLabel(primary.importance, messages) : "—"
                    }
                  />
                  <DiscoveryField
                    label={messages.discover.recentEvents}
                    value={String(events.length)}
                  />
                </dl>
                <div className="mt-5 rounded-lg border bg-black/15 p-4">
                  <p className="section-label">
                    {messages.discover.alphaContext}
                  </p>
                  <p className="mt-2 text-sm leading-6">
                    {primary
                      ? localize(primary.summary, locale)
                      : messages.assets.noDemoEvents}
                  </p>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1 text-[var(--muted)]">
                    <ShieldCheck className="size-3" />
                    {messages.discover.scoreDisclaimer}
                  </span>
                  <Link
                    className="font-semibold text-emerald-300"
                    href={`/radar?asset=${asset.symbol}`}
                  >
                    {messages.assets.viewInRadar}
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
      )}
      <p className="mt-8 text-center text-xs text-[var(--muted)]">
        {messages.common.demoDisclaimer}
      </p>
    </main>
  );
}

function Select({
  name,
  label,
  value,
  all,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  all: string;
  options: string[][];
}) {
  return (
    <label className="w-full text-xs text-[var(--muted)]">
      {label}
      <select
        name={name}
        defaultValue={value ?? ""}
        className="field-select mt-1"
      >
        <option value="">{all}</option>
        {options.map(([optionValue, optionLabel]) =>
          optionValue && optionLabel ? (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          ) : null,
        )}
      </select>
    </label>
  );
}
function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-[var(--muted)] uppercase">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function DiscoveryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );
}

function discoverNarrativeLabel(
  narrative: string,
  messages: Awaited<ReturnType<typeof getTranslations>>["messages"],
): string {
  const labels: Record<string, string> = {
    liquidity: messages.home.liquidity,
    institutional_adoption: messages.home.institutionalAdoption,
    ai_infrastructure: messages.home.aiInfrastructure,
    regulatory_clarity: messages.home.regulatoryClarity,
  };
  return labels[narrative] ?? narrative;
}
