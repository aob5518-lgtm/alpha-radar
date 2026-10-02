import { CalendarDays, Clock3, Database, Filter } from "lucide-react";
import Link from "next/link";

import { getTranslations } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

const views = ["today", "week", "calendar"] as const;
type EventView = (typeof views)[number];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseView(value: string | undefined): EventView {
  return views.includes(value as EventView) ? (value as EventView) : "today";
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { messages } = await getTranslations();
  const query = await searchParams;
  const view = parseView(first(query.view));
  const includeMedium = first(query.importance) === "medium";
  const labels: Record<EventView, string> = {
    today: messages.events.today,
    week: messages.events.thisWeek,
    calendar: messages.events.calendar,
  };

  return (
    <main className="page-shell">
      <header className="flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-label">{messages.events.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            {messages.events.title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            {messages.events.description}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <Clock3 className="size-4" aria-hidden="true" />
          {messages.events.timezone}
        </div>
      </header>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <nav className="flex gap-1" aria-label={messages.events.title}>
          {views.map((item) => (
            <Link
              key={item}
              href={`/events?view=${item}${includeMedium ? "&importance=medium" : ""}`}
              aria-current={view === item ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium text-[var(--muted)]",
                view === item && "bg-white/8 text-white",
              )}
            >
              {labels[item]}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 text-xs">
          <Filter className="size-4 text-[var(--muted)]" aria-hidden="true" />
          <span className="text-[var(--muted)]">
            {messages.events.importance}
          </span>
          <Link
            href={`/events?view=${view}${includeMedium ? "" : "&importance=medium"}`}
            className="data-pill"
          >
            {includeMedium
              ? messages.events.includeMedium
              : messages.events.criticalHigh}
          </Link>
        </div>
      </div>

      <section className="mt-5 grid min-h-[34rem] border lg:grid-cols-[13rem_minmax(0,1fr)_22rem]">
        <aside className="border-b p-4 lg:border-r lg:border-b-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="size-4 text-emerald-300" />
            {labels[view]}
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">
            {messages.events.timezone}
          </p>
        </aside>

        <div className="flex min-w-0 flex-col border-b lg:border-r lg:border-b-0">
          <div className="hidden grid-cols-[5rem_minmax(12rem,1fr)_5rem_6rem_repeat(3,5rem)_7rem] gap-2 border-b px-4 py-3 text-[10px] font-semibold tracking-wide text-[var(--muted)] uppercase xl:grid">
            <span>{messages.events.time}</span>
            <span>{messages.events.event}</span>
            <span>{messages.events.importance}</span>
            <span>{messages.events.status}</span>
            <span>{messages.events.expected}</span>
            <span>{messages.events.actual}</span>
            <span>{messages.events.previous}</span>
            <span>{messages.events.affectedAssets}</span>
          </div>
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div className="max-w-md">
              <Database className="mx-auto size-7 text-[var(--muted)]" />
              <h2 className="mt-4 font-semibold">
                {messages.events.emptyTitle}
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {messages.events.emptyDescription}
              </p>
              <p className="mt-4 border-t pt-4 text-xs leading-5 text-[var(--muted)]">
                {messages.events.sourceBoundary}
              </p>
            </div>
          </div>
        </div>

        <aside className="p-5">
          <p className="section-label">{messages.radar.eventDetail}</p>
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            {messages.events.eventDetail}
          </p>
          <dl className="mt-6 grid grid-cols-3 gap-2 text-xs">
            {[
              messages.events.expected,
              messages.events.actual,
              messages.events.previous,
            ].map((label) => (
              <div key={label} className="border-t pt-3">
                <dt className="text-[var(--muted)]">{label}</dt>
                <dd className="mt-2">—</dd>
              </div>
            ))}
          </dl>
        </aside>
      </section>
    </main>
  );
}
