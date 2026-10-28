import type { Messages } from "@/lib/i18n/messages";
import { guideReady, type TradeGuideV1 } from "@/lib/market/trade-guide";

export function TradeGuidePanel({
  guide,
  copy,
  locale,
}: {
  guide: TradeGuideV1;
  copy: Messages["chart"]["tradeGuide"];
  locale: "en" | "zh-CN";
}) {
  const ready = guideReady(guide),
    watch = guide.state === "WATCH_LONG" || guide.state === "WATCH_SHORT";
  const number = (value: number | null) =>
    value?.toLocaleString(locale, { maximumFractionDigits: 6 }) ?? "—";
  const source = (value: TradeGuideV1["tp1_source"]) =>
    value === "swing-high"
      ? copy.swingHigh
      : value === "swing-low"
        ? copy.swingLow
        : value;
  return (
    <section
      className="space-y-2 border-t border-white/10 py-3"
      data-trade-guide-state={guide.state}
      data-guide-instrument={guide.market_instrument_id}
      data-guide-timeframe={guide.timeframe}
    >
      <strong
        className={`inline-block rounded px-3 py-1 text-base ${ready ? "bg-emerald-400/20 text-emerald-300" : "bg-white/10 text-[var(--text)]"}`}
      >
        {copy.states[guide.state]}
        {(ready || watch) &&
          guide.quality_grade &&
          guide.quality_grade !== "none" &&
          ` · ${guide.quality_grade}`}
      </strong>
      {(ready || watch) && guide.entry_zone_low !== null && (
        <p className="text-sm">
          {ready ? copy.entry : copy.potentialEntry}:{" "}
          <span className="font-mono">
            {number(guide.entry_zone_low)} – {number(guide.entry_zone_high)}
          </span>
        </p>
      )}
      {ready && (
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-[var(--muted)]">{copy.reference}</dt>
            <dd className="font-mono">{number(guide.reference_entry_price)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">{copy.stop}</dt>
            <dd className="font-mono">{number(guide.stop_price)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">
              TP1 · {source(guide.tp1_source)}
            </dt>
            <dd className="font-mono">{number(guide.tp1_price)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">
              TP2 {guide.tp2_source && `· ${source(guide.tp2_source)}`}
            </dt>
            <dd className="font-mono">{number(guide.tp2_price)}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">{copy.rr}</dt>
            <dd className="font-mono">
              1 : {guide.reward_risk_tp1?.toFixed(2)}{" "}
              {guide.favorable_reward_risk && (
                <span className="text-xs">· {copy.favorable}</span>
              )}
            </dd>
          </div>
        </dl>
      )}
      {watch && (
        <p className="text-xs text-[var(--muted)]">
          {copy.waitCondition}: {copy.actions[guide.next_action]}
        </p>
      )}
      {(ready || watch) && guide.evidence?.length > 0 && (
        <p
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs"
          aria-label={copy.evidenceLabel}
        >
          {guide.evidence.map((item) => (
            <span key={item.key} title={`${item.points}/${item.maximum}`}>
              {item.tone === "positive"
                ? "✓"
                : item.tone === "negative"
                  ? "−"
                  : "○"}{" "}
              {copy.evidence[item.key][item.tone]}
            </span>
          ))}
        </p>
      )}
      {ready && guide.stop_reason && (
        <p className="text-xs text-[var(--muted)]">
          {copy.stops[guide.stop_reason]}
        </p>
      )}
      <p className="text-sm font-semibold">
        {copy.nextAction}: {copy.actions[guide.next_action]}
      </p>
      <p className="text-xs text-[var(--muted)]">
        {guide.reason_codes.map((reason) => copy.reasons[reason]).join(" · ")}
      </p>
      <p className="text-[10px] text-[var(--muted)]">{copy.disclaimer}</p>
    </section>
  );
}
