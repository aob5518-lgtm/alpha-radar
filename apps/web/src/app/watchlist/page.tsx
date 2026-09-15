import { Bell, Star } from "lucide-react";

import { DemoBadge } from "@/components/demo-badge";
import { getTranslations } from "@/lib/i18n/server";
import { demoRadarItems, localize } from "@/lib/intelligence/demo-data";

export default async function WatchlistPage() {
  const { locale, messages } = await getTranslations();
  const sample = demoRadarItems[1];
  return (
    <main className="page-shell">
      <ShellHeader
        eyebrow={messages.watchlist.eyebrow}
        title={messages.watchlist.title}
        description={messages.watchlist.description}
        demo={messages.common.demoData}
      />
      <section className="panel mt-6 border-dashed p-10 text-center">
        <Star className="mx-auto size-7 text-[var(--muted)]" />
        <h2 className="mt-4 font-semibold">{messages.watchlist.emptyTitle}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
          {messages.watchlist.emptyDescription}
        </p>
      </section>
      {sample && (
        <section className="panel mt-6 p-5">
          <div className="flex justify-between">
            <p className="section-label">{messages.watchlist.demoTitle}</p>
            <DemoBadge label={messages.common.demoData} />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-4">
            <Cell title={messages.radar.asset} value="BTC" />
            <Cell
              title={messages.watchlist.latestEvent}
              value={localize(sample.title, locale)}
            />
            <Cell
              title={messages.watchlist.impactChange}
              value={messages.labels.directions.mixed}
            />
            <Cell
              title={messages.watchlist.alertState}
              value={messages.watchlist.notSaved}
              icon
            />
          </div>
        </section>
      )}
    </main>
  );
}
function Cell({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)]">{title}</p>
      <p className="mt-2 line-clamp-2 text-sm font-medium">
        {icon && <Bell className="mr-1 inline size-3" />}
        {value}
      </p>
    </div>
  );
}
function ShellHeader({
  eyebrow,
  title,
  description,
  demo,
}: {
  eyebrow: string;
  title: string;
  description: string;
  demo: string;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-7">
      <div>
        <p className="section-label">{eyebrow}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          {description}
        </p>
      </div>
      <DemoBadge label={demo} />
    </header>
  );
}
