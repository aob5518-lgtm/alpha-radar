import { ArrowLeft, ArrowRight, DatabaseZap } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DemoBadge } from "@/components/demo-badge";
import { getAsset } from "@/lib/api/assets";
import { eventTypeLabel, impactLabel } from "@/lib/i18n/intelligence-labels";
import { assetStatusLabel, assetTypeLabel } from "@/lib/i18n/labels";
import { getTranslations } from "@/lib/i18n/server";
import { demoRadarItems, localize } from "@/lib/intelligence/demo-data";
import { relatedItemsForAsset } from "@/lib/intelligence/derive";

export const dynamic = "force-dynamic";

interface AssetPageProps {
  params: Promise<{ identifier: string }>;
}

export default async function AssetPage({ params }: AssetPageProps) {
  const { locale, messages } = await getTranslations();
  const { identifier } = await params;
  const asset = await getAsset(identifier);
  if (!asset) notFound();
  const intelligence = relatedItemsForAsset(demoRadarItems, asset.id);

  return (
    <main className="page-shell">
      <Link
        href="/assets"
        className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {messages.assets.backToDirectory}
      </Link>

      <section className="mt-8 rounded-3xl border bg-[var(--card)] p-7 sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-emerald-400 px-2.5 py-1 text-sm font-bold text-zinc-950">
                {asset.symbol}
              </span>
              <span className="text-sm text-[var(--muted)]">
                {assetTypeLabel(asset.asset_type, messages)}
              </span>
            </div>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">
              {asset.name}
            </h1>
            <p className="mt-4 max-w-2xl text-[var(--muted)]">
              {asset.chain ??
                asset.sector ??
                messages.assets.classificationUnavailable}
              {asset.country ? ` · ${asset.country}` : ""}
            </p>
          </div>
          <div className="text-xs text-[var(--muted)]">
            <p>{messages.assets.canonicalUuid}</p>
            <p className="mt-1 font-mono text-zinc-300">{asset.id}</p>
            <Link
              href={`/radar?asset=${asset.id}`}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border px-3 py-2 font-sans font-semibold text-emerald-300 hover:bg-white/5"
            >
              {messages.assets.viewInRadar}
              <ArrowRight className="size-3" />
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border bg-[var(--card)] p-6">
        <h2 className="text-lg font-medium">
          {messages.assets.overview.title}
        </h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[var(--muted)] uppercase">
              {messages.assets.overview.slug}
            </dt>
            <dd className="mt-1">{asset.slug}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)] uppercase">
              {messages.assets.overview.status}
            </dt>
            <dd className="mt-1">{assetStatusLabel(asset.status, messages)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)] uppercase">
              {messages.assets.overview.providerMappings}
            </dt>
            <dd className="mt-1">{asset.provider_mappings.length}</dd>
          </div>
        </dl>
      </section>

      <div className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100">
        {messages.assets.demoContext}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <IntelligenceSection
          title={messages.assets.sections.events}
          demoLabel={messages.common.demoData}
        >
          {intelligence.length ? (
            <div className="space-y-3">
              {intelligence.slice(0, 3).map((event) => (
                <Link
                  key={event.id}
                  href={`/radar?asset=${asset.id}&event=${event.id}`}
                  className="block rounded-lg border p-3 text-sm hover:border-emerald-400"
                >
                  <span className="line-clamp-2 font-medium">
                    {localize(event.title, locale)}
                  </span>
                  <span className="mt-2 block text-xs text-[var(--muted)]">
                    {eventTypeLabel(event.eventType, messages)} ·{" "}
                    {impactLabel(event.importance, messages)}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty text={messages.assets.noDemoEvents} />
          )}
        </IntelligenceSection>
        <IntelligenceSection
          title={messages.assets.sections.catalysts}
          demoLabel={messages.common.demoData}
        >
          {intelligence[0]?.watchNext ? (
            <p className="text-sm leading-6 text-[var(--muted)]">
              {localize(intelligence[0].watchNext, locale)}
            </p>
          ) : (
            <Empty text={messages.assets.noDemoEvents} />
          )}
        </IntelligenceSection>
        <PlaceholderSection
          title={messages.assets.sections.market}
          description={messages.assets.sections.notIntegratedDescription}
        />
        <PlaceholderSection
          title={messages.assets.sections.fundamentals}
          description={messages.assets.sections.notIntegratedDescription}
        />
        <PlaceholderSection
          title={messages.assets.sections.capitalFlow}
          description={messages.assets.sections.notIntegratedDescription}
        />
        <IntelligenceSection
          title={messages.assets.sections.narratives}
          demoLabel={messages.common.demoData}
        >
          {intelligence.length ? (
            <div className="flex flex-wrap gap-2">
              {[...new Set(intelligence.map((event) => event.narrative))].map(
                (narrative) => (
                  <span key={narrative} className="data-pill">
                    {narrativeLabel(narrative, messages)}
                  </span>
                ),
              )}
            </div>
          ) : (
            <Empty text={messages.assets.noDemoEvents} />
          )}
        </IntelligenceSection>
        <IntelligenceSection
          title={messages.assets.sections.risk}
          demoLabel={messages.common.demoData}
        >
          {intelligence[0] ? (
            <p className="text-sm leading-6 text-[var(--muted)]">
              {localize(intelligence[0].risks, locale)}
            </p>
          ) : (
            <Empty text={messages.assets.noDemoEvents} />
          )}
        </IntelligenceSection>
      </div>
    </main>
  );
}

function IntelligenceSection({
  title,
  demoLabel,
  children,
}: {
  title: string;
  demoLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel min-h-44 p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">{title}</h2>
        <DemoBadge label={demoLabel} />
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}
function PlaceholderSection({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="panel min-h-44 p-6">
      <DatabaseZap className="size-5 text-[var(--muted)]" aria-hidden="true" />
      <h2 className="mt-6 text-lg font-medium">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        {description}
      </p>
    </section>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="text-sm leading-6 text-[var(--muted)]">{text}</p>;
}

function narrativeLabel(
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
