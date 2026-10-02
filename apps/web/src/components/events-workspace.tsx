"use client";

import type { CanonicalEvent } from "@alpha-radar/types/events";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";

import { getClientTranslations } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type View = "today" | "week" | "calendar";

export function EventsWorkspace({ events }: { events: CanonicalEvent[] }) {
  const { locale, messages } = getClientTranslations();
  const [view, setView] = useState<View>("today");
  const [includeMedium, setIncludeMedium] = useState(false);
  const [selectedId, setSelectedId] = useState(events[0]?.id ?? null);
  const filtered = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(
      end.getDate() + (view === "today" ? 1 : view === "week" ? 7 : 366),
    );
    return events.filter((event) => {
      if (!includeMedium && !["critical", "high"].includes(event.importance))
        return false;
      const value = event.scheduled_at
        ? new Date(event.scheduled_at)
        : event.scheduled_date
          ? new Date(`${event.scheduled_date}T12:00:00`)
          : null;
      return value ? value >= start && value < end : view === "calendar";
    });
  }, [events, includeMedium, view]);
  const selected =
    events.find((event) => event.id === selectedId) ?? filtered[0] ?? null;
  const labels = {
    today: messages.events.today,
    week: messages.events.thisWeek,
    calendar: messages.events.calendar,
  };

  return (
    <div className="grid min-h-[calc(100vh-9rem)] lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="min-w-0 border-r">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <nav className="flex gap-1">
            {(Object.keys(labels) as View[]).map((item) => (
              <button
                key={item}
                onClick={() => setView(item)}
                className={cn(
                  "rounded px-3 py-2 text-xs",
                  view === item && "bg-white/8 text-white",
                )}
              >
                {labels[item]}
              </button>
            ))}
          </nav>
          <button
            className="data-pill"
            onClick={() => setIncludeMedium((value) => !value)}
          >
            {includeMedium
              ? messages.events.includeMedium
              : messages.events.criticalHigh}
          </button>
        </div>
        <div className="hidden grid-cols-[7rem_minmax(14rem,1fr)_5rem_repeat(3,5rem)_8rem] gap-2 border-b px-4 py-2 text-[10px] text-[var(--muted)] uppercase xl:grid">
          <span>{messages.events.time}</span>
          <span>{messages.events.event}</span>
          <span>{messages.events.importance}</span>
          <span>{messages.events.actual}</span>
          <span>{messages.events.expected}</span>
          <span>{messages.events.previous}</span>
          <span>{messages.events.affectedAssets}</span>
        </div>
        {filtered.length === 0 ? (
          <p className="p-8 text-sm text-[var(--muted)]">
            {messages.events.emptyTitle}
          </p>
        ) : (
          <div className="divide-y">
            {filtered.map((event) => (
              <button
                key={event.id}
                onClick={() => setSelectedId(event.id)}
                className={cn(
                  "grid w-full gap-2 px-4 py-4 text-left hover:bg-white/[.03] xl:grid-cols-[7rem_minmax(14rem,1fr)_5rem_repeat(3,5rem)_8rem]",
                  selected?.id === event.id && "bg-white/[.04]",
                )}
              >
                <span className="font-mono text-xs">
                  {formatEventTime(
                    event,
                    locale,
                    messages.events.timeNotAnnounced,
                  )}
                </span>
                <span>
                  <strong className="text-sm">{event.title}</strong>
                  <small className="mt-1 block text-[var(--muted)]">
                    {event.event_type} · {event.status}
                  </small>
                </span>
                <span
                  className={cn(
                    "text-xs font-semibold uppercase",
                    event.importance === "critical"
                      ? "text-rose-300"
                      : "text-amber-300",
                  )}
                >
                  {event.importance}
                </span>
                <Value value={event.actual} />
                <Value value={event.forecast} />
                <Value value={event.previous} />
                <span className="text-xs">
                  {event.affected_assets
                    .map((asset) => asset.symbol)
                    .join(" · ") || "—"}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      <EventDetail event={selected} locale={locale} />
    </div>
  );
}

function EventDetail({
  event,
  locale,
}: {
  event: CanonicalEvent | null;
  locale: string;
}) {
  const { messages } = getClientTranslations();
  if (!event)
    return (
      <aside className="p-5 text-sm text-[var(--muted)]">
        {messages.events.eventDetail}
      </aside>
    );
  return (
    <aside className="space-y-5 p-5">
      <div>
        <span className="data-pill">{event.importance}</span>
        <h2 className="mt-3 text-lg font-semibold">{event.title}</h2>
        <p className="mt-2 text-xs text-[var(--muted)]">
          {formatEventTime(event, locale, messages.events.timeNotAnnounced)} ·
          UTC{" "}
          {event.scheduled_at
            ? new Date(event.scheduled_at).toISOString()
            : "—"}{" "}
          · {event.scheduled_timezone ?? "—"}
        </p>
      </div>
      <Detail title={messages.analyst.fact} text={event.summary} />
      <Detail title={messages.analyst.analysis} text={event.why_it_matters} />
      {event.bull_case && (
        <Detail
          title={`${messages.analyst.scenario} · ${messages.analyst.bullCase}`}
          text={event.bull_case}
        />
      )}
      {event.bear_case && (
        <Detail
          title={`${messages.analyst.scenario} · ${messages.analyst.bearCase}`}
          text={event.bear_case}
        />
      )}
      <section>
        <h3 className="section-label">{messages.analyst.watchNext}</h3>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[var(--muted)]">
          {event.watch_next.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="section-label">{messages.events.sources}</h3>
        <div className="mt-2 space-y-2">
          {event.sources.map((source) => (
            <a
              key={source.source_document_id}
              href={source.canonical_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-xs text-emerald-300"
            >
              <ExternalLink className="size-3" />
              {source.source_name}
            </a>
          ))}
        </div>
      </section>
    </aside>
  );
}

function Detail({ title, text }: { title: string; text: string }) {
  return (
    <section>
      <h3 className="section-label">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
        {text.replace(/^(FACT|ANALYSIS|SCENARIO):\s*/, "")}
      </p>
    </section>
  );
}
function Value({ value }: { value: string | null }) {
  return <span className="font-mono text-xs">{value ?? "—"}</span>;
}
function formatEventTime(
  event: CanonicalEvent,
  locale: string,
  unavailable: string,
) {
  if (!event.scheduled_at)
    return event.scheduled_date
      ? `${event.scheduled_date} · ${unavailable}`
      : unavailable;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(event.scheduled_at));
}
