import type { CanonicalEvent } from "@alpha-radar/types/events";

export type EventCategoryFilter = "all" | "macro" | "crypto";
export type EventView = "latest" | "24h" | "7d" | "today" | "week" | "calendar";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const eventViews: Record<EventCategoryFilter, readonly EventView[]> = {
  all: ["latest"],
  macro: ["today", "week", "calendar"],
  crypto: ["latest", "24h", "7d"],
};

export function defaultEventView(category: EventCategoryFilter): EventView {
  return category === "macro" ? "today" : "latest";
}

export function filterEvents(
  events: CanonicalEvent[],
  options: {
    category: EventCategoryFilter;
    view: EventView;
    includeMedium: boolean;
    now?: Date;
  },
): CanonicalEvent[] {
  const now = options.now ?? new Date();
  const important = events.filter(
    (event) =>
      event.importance !== "low" &&
      (options.includeMedium || event.importance !== "medium"),
  );

  if (options.category === "macro") {
    return filterMacroEvents(important, options.view, now);
  }
  if (options.category === "crypto") {
    return filterCryptoEvents(important, options.view, now);
  }
  return filterMixedLatest(important, now);
}

export function canonicalEventTimestamp(event: CanonicalEvent): number | null {
  return firstValidTimestamp([
    event.actual_release_at,
    event.detected_at,
    event.scheduled_at,
    event.scheduled_date ? `${event.scheduled_date}T12:00:00` : null,
  ]);
}

function filterCryptoEvents(
  events: CanonicalEvent[],
  view: EventView,
  now: Date,
): CanonicalEvent[] {
  const duration = view === "24h" ? DAY_MS : 7 * DAY_MS;
  const nowMs = now.getTime();
  return events
    .filter((event) => event.category === "crypto")
    .filter((event) =>
      withinPastWindow(canonicalEventTimestamp(event), nowMs, duration),
    )
    .sort(compareNewestCanonical);
}

function filterMacroEvents(
  events: CanonicalEvent[],
  view: EventView,
  now: Date,
): CanonicalEvent[] {
  const macroView =
    view === "today" || view === "week" || view === "calendar" ? view : "today";
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(
    end.getDate() +
      (macroView === "today" ? 1 : macroView === "week" ? 7 : 366),
  );

  return events.filter((event) => {
    if (event.category !== "macro") return false;
    const scheduled = scheduledTimestamp(event);
    return scheduled === null
      ? macroView === "calendar"
      : scheduled >= start.getTime() && scheduled < end.getTime();
  });
}

function filterMixedLatest(
  events: CanonicalEvent[],
  now: Date,
): CanonicalEvent[] {
  const nowMs = now.getTime();
  const recent: CanonicalEvent[] = [];
  const upcomingMacro: CanonicalEvent[] = [];

  for (const event of events) {
    if (event.category === "crypto") {
      if (withinPastWindow(canonicalEventTimestamp(event), nowMs, 7 * DAY_MS)) {
        recent.push(event);
      }
      continue;
    }

    const scheduled = scheduledTimestamp(event);
    if (
      scheduled !== null &&
      scheduled >= nowMs &&
      scheduled < nowMs + 45 * DAY_MS
    ) {
      upcomingMacro.push(event);
    }
  }

  return [
    ...recent.sort(compareNewestCanonical),
    ...upcomingMacro.sort(
      (left, right) =>
        (scheduledTimestamp(left) ?? 0) - (scheduledTimestamp(right) ?? 0),
    ),
  ];
}

function scheduledTimestamp(event: CanonicalEvent): number | null {
  return firstValidTimestamp([
    event.scheduled_at,
    event.scheduled_date ? `${event.scheduled_date}T12:00:00` : null,
  ]);
}

function firstValidTimestamp(values: Array<string | null>): number | null {
  for (const value of values) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function withinPastWindow(
  timestamp: number | null,
  now: number,
  duration: number,
): boolean {
  return timestamp !== null && timestamp <= now && timestamp >= now - duration;
}

function compareNewestCanonical(
  left: CanonicalEvent,
  right: CanonicalEvent,
): number {
  return (
    (canonicalEventTimestamp(right) ?? 0) - (canonicalEventTimestamp(left) ?? 0)
  );
}
