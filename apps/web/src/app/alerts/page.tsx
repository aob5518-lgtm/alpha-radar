import { BellRing, CalendarClock, ShieldAlert, Waves } from "lucide-react";

import { DemoBadge } from "@/components/demo-badge";
import { getTranslations } from "@/lib/i18n/server";

export default async function AlertsPage() {
  const { messages } = await getTranslations();
  const concepts = [
    [messages.alerts.majorEvents, BellRing],
    [messages.alerts.impactShifts, Waves],
    [messages.alerts.catalystProximity, CalendarClock],
    [messages.alerts.riskChanges, ShieldAlert],
  ] as const;
  return (
    <main className="page-shell">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-7">
        <div>
          <p className="section-label">{messages.alerts.eyebrow}</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
            {messages.alerts.title}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            {messages.alerts.description}
          </p>
        </div>
        <DemoBadge label={messages.common.demoData} />
      </header>
      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {concepts.map(([title, Icon]) => (
          <article key={title} className="panel p-5">
            <Icon className="size-5 text-emerald-300" />
            <h2 className="mt-5 font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {messages.alerts.futureOnly}
            </p>
          </article>
        ))}
      </section>
      <section className="panel mt-6 border-dashed p-12 text-center">
        <BellRing className="mx-auto size-7 text-[var(--muted)]" />
        <h2 className="mt-4 font-semibold">{messages.alerts.emptyTitle}</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {messages.alerts.emptyDescription}
        </p>
      </section>
    </main>
  );
}
