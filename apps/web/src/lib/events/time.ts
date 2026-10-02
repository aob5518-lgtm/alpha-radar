import type { Locale } from "@/lib/i18n/config";

export interface FormattedEventTime {
  value: string;
  hasAnnouncedTime: boolean;
  timezone: string;
}

export function formatEventSchedule(
  scheduledAt: string | null,
  locale: Locale,
  unknownLabel: string,
  timezone = "UTC",
): FormattedEventTime {
  if (!scheduledAt || /^\d{4}-\d{2}-\d{2}$/.test(scheduledAt)) {
    return { value: unknownLabel, hasAnnouncedTime: false, timezone };
  }
  const value = new Date(scheduledAt);
  if (Number.isNaN(value.getTime())) {
    return { value: unknownLabel, hasAnnouncedTime: false, timezone };
  }
  return {
    value: new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "short",
    }).format(value),
    hasAnnouncedTime: true,
    timezone,
  };
}
