import type { IntentAlert } from "@alpha-radar/types/event-alerts";

export const alertApi = "/api/v1/event-semi-auto/alerts";

export function validIntent(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function intentHref(id: string) {
  return validIntent(id) ? "/event-contracts?intent=" + id : "/event-contracts";
}

export function activeAlerts(items: IntentAlert[], now: number) {
  return items
    .filter((item) => item.actionable && Date.parse(item.expires_at) > now)
    .reverse();
}

export type Preferences = {
  popup: boolean;
  sound: boolean;
  vibration: boolean;
};
export const defaultPreferences: Preferences = {
  popup: true,
  sound: false,
  vibration: false,
};

export async function alertRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(alertApi + path, {
    ...init,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  if (!response.ok) throw new Error(String(response.status));
  return (response.status === 204 ? undefined : await response.json()) as T;
}
