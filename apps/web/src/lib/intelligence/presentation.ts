import type {
  Direction,
  ImpactLevel,
  RadarItem,
  RadarStatus,
} from "@alpha-radar/types/radar";

import type { Locale } from "@/lib/i18n/config";
import { formatMessage, type Messages } from "@/lib/i18n/messages";

export function formatDemoDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatRelativeToSnapshot(
  value: string,
  referenceTime: string,
  messages: Messages,
): string {
  const difference = Math.max(0, Date.parse(referenceTime) - Date.parse(value));
  const minutes = Math.round(difference / 60_000);
  if (minutes < 60)
    return formatMessage(messages.radar.relativeMinutes, { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24)
    return formatMessage(messages.radar.relativeHours, { count: hours });
  return formatMessage(messages.radar.relativeDays, {
    count: Math.round(hours / 24),
  });
}

export function directionTone(direction: Direction): string {
  return {
    bullish: "tone-positive",
    bearish: "tone-negative",
    mixed: "tone-mixed",
    neutral: "tone-neutral",
  }[direction];
}

export function impactTone(impact: ImpactLevel): string {
  return impact === "high"
    ? "tone-negative"
    : impact === "medium"
      ? "tone-mixed"
      : "tone-neutral";
}

export function statusTone(status: RadarStatus): string {
  return status === "breaking"
    ? "tone-negative"
    : status === "developing"
      ? "tone-mixed"
      : status === "confirmed"
        ? "tone-positive"
        : "tone-neutral";
}

export function mostCommonDirection(item: RadarItem): Direction {
  const counts = new Map<Direction, number>();
  for (const impact of item.impacts)
    counts.set(impact.direction, (counts.get(impact.direction) ?? 0) + 1);
  return (
    [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
    "neutral"
  );
}
