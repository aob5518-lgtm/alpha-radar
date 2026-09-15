import {
  Activity,
  ArrowRight,
  Flame,
  Layers3,
  ShieldAlert,
  Sparkles,
  Waves,
} from "lucide-react";
import Link from "next/link";

import { DemoBadge } from "@/components/demo-badge";
import { EventCard } from "@/components/radar/event-card";
import { getTranslations } from "@/lib/i18n/server";
import { demoRadarItems, localize } from "@/lib/intelligence/demo-data";
import { orderRadarItems } from "@/lib/intelligence/derive";

export default async function Home() {
  const { locale, messages } = await getTranslations();
  const ordered = orderRadarItems(demoRadarItems);
  const breaking = ordered.filter((item) => item.status === "breaking");
  const macroRegulation = ordered.filter(
    (item) => item.eventType === "macro" || item.eventType === "regulation",
  );
  const activeAssets = [
    ...new Set(
      ordered.flatMap((item) => item.assets.map((asset) => asset.symbol)),
    ),
  ].slice(0, 8);
  const narrativeRows = [
    [messages.home.liquidity, messages.home.elevated, "76%"],
    [messages.home.institutionalAdoption, messages.home.constructive, "68%"],
    [messages.home.aiInfrastructure, messages.home.constructive, "62%"],
    [messages.home.regulatoryClarity, messages.home.selective, "49%"],
  ];

  return (
    <main className="page-shell">
      <section className="flex flex-col gap-5 border-b pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-label">{messages.home.eyebrow}</p>
          <h1 className="mt-2 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
            {messages.home.title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--muted)]">
            {messages.home.description}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <DemoBadge label={messages.common.demoData} />
          <span className="text-xs text-[var(--muted)]">
            {messages.common.simulatedSnapshot}
          </span>
        </div>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Activity}
          title={messages.home.marketRegime}
          value={messages.home.regimeValue}
          detail={messages.home.regimeDetail}
        />
        <MetricCard
          icon={Flame}
          title={messages.home.breakingEvents}
          value={String(breaking.length)}
          detail={
            breaking[0]
              ? localize(breaking[0].title, locale)
              : messages.radar.emptyTitle
          }
        />
        <MetricCard
          icon={Layers3}
          title={messages.home.macroRegulation}
          value={String(macroRegulation.length)}
          detail={messages.home.riskContext}
        />
        <MetricCard
          icon={Waves}
          title={messages.home.capitalFlow}
          value={messages.home.constructive}
          detail={messages.home.flowContext}
        />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,.8fr)]">
        <div>
          <SectionHeading
            title={messages.home.topEvents}
            href="/radar"
            linkLabel={messages.common.viewAll}
          />
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {ordered.slice(0, 4).map((item) => (
              <Link key={item.id} href={`/radar?event=${item.id}`}>
                <EventCard
                  item={item}
                  locale={locale}
                  messages={messages}
                  compact
                />
              </Link>
            ))}
          </div>
        </div>
        <div className="space-y-6">
          <section>
            <SectionHeading title={messages.home.narrativeHeat} />
            <div className="panel mt-3 divide-y">
              {narrativeRows.map(([name, state, score]) => (
                <div
                  key={name}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <div>
                    <p className="text-sm font-medium">{name}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">{state}</p>
                  </div>
                  <span className="font-mono text-sm text-emerald-300">
                    {score}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <SectionHeading title={messages.home.activeAssets} />
            <div className="panel mt-3 flex flex-wrap gap-2 p-4">
              {activeAssets.map((symbol) => (
                <Link
                  key={symbol}
                  href={`/radar?asset=${symbol}`}
                  className="data-pill hover:border-emerald-400 hover:text-emerald-300"
                >
                  {symbol}
                  <ArrowRight className="size-3" />
                </Link>
              ))}
            </div>
          </section>
        </div>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <ContextCard
          icon={Sparkles}
          title={messages.home.opportunityRadar}
          body={messages.home.opportunityContext}
          demoLabel={messages.common.demoData}
        />
        <ContextCard
          icon={ShieldAlert}
          title={messages.home.riskRadar}
          body={messages.home.riskContext}
          demoLabel={messages.common.demoData}
        />
        <ContextCard
          icon={Layers3}
          title={messages.home.macroRegulation}
          body={
            macroRegulation[0]
              ? localize(
                  macroRegulation[0].watchNext ?? macroRegulation[0].summary,
                  locale,
                )
              : messages.radar.emptyDescription
          }
          demoLabel={messages.common.demoData}
        />
      </section>
      <p className="mt-8 text-center text-xs text-[var(--muted)]">
        {messages.common.demoDisclaimer}
      </p>
    </main>
  );
}

function MetricCard({
  icon: Icon,
  title,
  value,
  detail,
}: {
  icon: typeof Activity;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="panel p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--muted)]">{title}</p>
        <Icon className="size-4 text-emerald-300" aria-hidden="true" />
      </div>
      <p className="mt-3 text-xl font-semibold">{value}</p>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">
        {detail}
      </p>
    </article>
  );
}
function SectionHeading({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
      {href && linkLabel && (
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs text-emerald-300"
        >
          {linkLabel}
          <ArrowRight className="size-3" />
        </Link>
      )}
    </div>
  );
}
function ContextCard({
  icon: Icon,
  title,
  body,
  demoLabel,
}: {
  icon: typeof Sparkles;
  title: string;
  body: string;
  demoLabel: string;
}) {
  return (
    <article className="panel p-5">
      <Icon className="size-5 text-emerald-300" aria-hidden="true" />
      <h2 className="mt-5 font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{body}</p>
      <div className="mt-4">
        <DemoBadge label={demoLabel} />
      </div>
    </article>
  );
}
