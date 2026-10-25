import {
  DEFAULT_MA,
  validMaSettings,
  type MaSettings,
} from "./ma-confluence-entry.ts";
export interface OverlayVisibility {
  levels: boolean;
  markers: boolean;
  ma: boolean;
  entries: boolean;
}
export interface OverlayPreferences {
  version: 1;
  visibility: OverlayVisibility;
  ma: MaSettings;
}
export const OVERLAY_STORAGE_KEY = "alpha-radar:chart-overlays:v1";
export const DEFAULT_OVERLAYS: OverlayVisibility = {
  levels: true,
  markers: true,
  ma: true,
  entries: true,
};
export function parseOverlayPreferences(
  raw: string | null,
): OverlayPreferences {
  const fallback = {
    version: 1 as const,
    visibility: { ...DEFAULT_OVERLAYS },
    ma: { ...DEFAULT_MA },
  };
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== 1
    )
      return fallback;
    const record = value as {
      visibility?: Partial<OverlayVisibility>;
      ma?: unknown;
    };
    const visibility = { ...DEFAULT_OVERLAYS };
    for (const key of Object.keys(visibility) as Array<keyof OverlayVisibility>)
      if (typeof record.visibility?.[key] === "boolean")
        visibility[key] = record.visibility[key]!;
    return {
      version: 1,
      visibility,
      ma: { ...validMaSettings(record.ma), enabled: true },
    };
  } catch {
    return fallback;
  }
}
