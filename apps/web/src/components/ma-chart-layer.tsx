"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
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
import {
  calculateTradeGuide,
  guideReady,
  type TradeGuideV1,
} from "@/lib/market/trade-guide";

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
  const previous = useRef<TradeGuideV1 | undefined>(undefined);
  const guide = useMemo(
    () =>
      snapshot && analysis
        ? calculateTradeGuide(
            snapshot,
            analysis,
            props.tradeSetup,
            props.instrumentId,
            props.interval,
            previous.current,
          )
        : undefined,
    [snapshot, analysis, props.tradeSetup, props.instrumentId, props.interval],
  );
  useEffect(() => {
    if (guide && guideReady(guide)) previous.current = guide;
    else if (
      !guide ||
      guide.state === "WAIT" ||
      previous.current?.ma_settings_key !== guide.ma_settings_key
    )
      previous.current = undefined;
  }, [guide]);
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
        <details
          className="space-y-1 border-b px-3 py-2 text-xs"
          data-ma-state={analysis.state}
        >
          <summary className="cursor-pointer">
            {props.chartMessages.tradeGuide.maDetails}
          </summary>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <span>
              {analysis.settings.type}
              {analysis.settings.period}:{" "}
              {analysis.ma_value?.toLocaleString(props.locale, {
                maximumFractionDigits: 6,
              }) ?? "—"}{" "}
              · {copy.slopes[analysis.ma_slope]}
            </span>
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
          <p className="text-[var(--muted)]">
            {analysis.reason_codes
              .slice(0, 4)
              .map((code) => copy.reasons[code])
              .join(" · ")}
          </p>
          <p className="text-[10px] text-[var(--muted)]">{copy.disclaimer}</p>
        </details>
      )}
      <StructuralMarketChart
        {...props}
        maAnalysis={analysis}
        tradeGuide={guide}
        guideMode
        overlays={preferences.visibility}
      />
    </>
  );
}
