"use client";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { StructuralMarketChart } from "@/components/structural-market-chart";
import type { TechnicalContextSnapshot } from "@/lib/market/technical-context";
import {
  calculateMaEntry,
  MA_RULES,
  type MaSettings,
} from "@/lib/market/ma-confluence-entry";
import {
  OVERLAY_STORAGE_KEY,
  parseOverlayPreferences,
  type OverlayVisibility,
} from "@/lib/market/chart-overlay-preferences";

type Props = ComponentProps<typeof StructuralMarketChart> & {
  snapshot?: TechnicalContextSnapshot | null;
};
export function MaChartLayer({ snapshot, ...props }: Props) {
  const [preferences, setPreferences] = useState(() =>
    parseOverlayPreferences(null),
  );
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    try {
      setPreferences(
        parseOverlayPreferences(localStorage.getItem(OVERLAY_STORAGE_KEY)),
      );
    } catch {
      /* Private browsing can deny storage. */
    }
    setRestored(true);
  }, []);
  useEffect(() => {
    if (restored)
      try {
        localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify(preferences));
      } catch {
        /* Keep current controls usable without persistence. */
      }
  }, [preferences, restored]);
  // Visibility is intentionally NOT a calculation dependency. Existing engines are
  // never called from this layer; price/trade/partial state belongs to the canvas.
  const analysis = useMemo(
    () =>
      snapshot
        ? calculateMaEntry(
            snapshot,
            props.instrumentId,
            props.interval,
            preferences.ma,
          )
        : undefined,
    [snapshot, props.instrumentId, props.interval, preferences.ma],
  );
  const copy = props.chartMessages.maEntry;
  const toggle = (key: keyof OverlayVisibility) =>
    setPreferences((value) => ({
      ...value,
      visibility: { ...value.visibility, [key]: !value.visibility[key] },
    }));
  const configure = (value: Partial<MaSettings>) =>
    setPreferences((prior) => ({ ...prior, ma: { ...prior.ma, ...value } }));
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 text-xs">
        {(
          Object.keys(preferences.visibility) as Array<keyof OverlayVisibility>
        ).map((key) => (
          <label key={key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={preferences.visibility[key]}
              onChange={() => toggle(key)}
            />
            {copy.overlays[key]}
          </label>
        ))}
        <details className="relative ml-auto">
          <summary className="cursor-pointer">{copy.settings}</summary>
          <div className="absolute right-0 z-30 mt-2 flex gap-2 border bg-[var(--panel)] p-3">
            <label>
              {copy.period}
              <input
                className="ml-2 w-16 rounded border bg-transparent px-1"
                type="number"
                min={MA_RULES.minimumPeriod}
                max={MA_RULES.maximumPeriod}
                key={preferences.ma.period}
                defaultValue={preferences.ma.period}
                onBlur={(event) => {
                  const period = Number(event.target.value);
                  if (
                    Number.isInteger(period) &&
                    period >= MA_RULES.minimumPeriod &&
                    period <= MA_RULES.maximumPeriod
                  )
                    configure({ period });
                  else
                    event.currentTarget.value = String(preferences.ma.period);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </label>
            <select
              className="border bg-[var(--panel)]"
              aria-label={copy.averageType}
              value={preferences.ma.type}
              onChange={(event) =>
                configure({
                  type: event.target.value === "EMA" ? "EMA" : "SMA",
                })
              }
            >
              <option>SMA</option>
              <option>EMA</option>
            </select>
          </div>
        </details>
      </div>
      {analysis && (
        <div
          className="space-y-1 border-b px-3 py-2 text-xs"
          data-ma-state={analysis.state}
        >
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              {analysis.settings.type}
              {analysis.settings.period}:{" "}
              {analysis.ma_value?.toLocaleString(props.locale, {
                maximumFractionDigits: 6,
              }) ?? "—"}{" "}
              · {copy.slopes[analysis.ma_slope]}
            </span>
            <strong>
              {copy.opportunity}: {copy.states[analysis.state]}
            </strong>
            <span>
              {copy.score}: {analysis.confidence_score}/100 ·{" "}
              {analysis.quality_tier}
            </span>
          </p>
          {analysis.setup_type && (
            <p>
              {copy.types[analysis.setup_type]} · {copy.candidateLabel}
            </p>
          )}
          {analysis.entry_zone && (
            <p>
              {copy.zone}:{" "}
              {analysis.entry_zone.low.toLocaleString(props.locale, {
                maximumFractionDigits: 6,
              })}{" "}
              –{" "}
              {analysis.entry_zone.high.toLocaleString(props.locale, {
                maximumFractionDigits: 6,
              })}{" "}
              · {copy.trigger}:{" "}
              {analysis.trigger_price?.toLocaleString(props.locale, {
                maximumFractionDigits: 6,
              })}{" "}
              · {copy.invalidation}:{" "}
              {analysis.invalidation_price?.toLocaleString(props.locale, {
                maximumFractionDigits: 6,
              })}{" "}
              · {copy.target}:{" "}
              {analysis.first_target?.toLocaleString(props.locale, {
                maximumFractionDigits: 6,
              }) ?? "—"}
            </p>
          )}
          <p className="text-[var(--muted)]">
            {analysis.reason_codes
              .slice(0, 4)
              .map((code) => copy.reasons[code])
              .join(" · ")}
          </p>
          <p className="text-[10px] text-[var(--muted)]">{copy.disclaimer}</p>
        </div>
      )}
      <StructuralMarketChart
        {...props}
        maAnalysis={analysis}
        overlays={preferences.visibility}
      />
    </>
  );
}
