import type { Messages } from "@/lib/i18n/messages";
import type { MaEntryAnalysis } from "@/lib/market/ma-confluence-entry";
import { guideReady, type TradeGuideV1 } from "@/lib/market/trade-guide";
import { describeGuideDecision } from "@/lib/market/trade-guide-decision";

export function TradeGuidePanel({
  guide,
  analysis,
  copy,
  locale,
}: {
  guide: TradeGuideV1;
  analysis?: MaEntryAnalysis;
  copy: Messages["chart"]["tradeGuide"];
  locale: "en" | "zh-CN";
}) {
  const ready = guideReady(guide),
    watch = guide.state === "WATCH_LONG" || guide.state === "WATCH_SHORT",
    decision = describeGuideDecision(guide, analysis);
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
      <ol
        aria-label={copy.decision.label}
        className="grid gap-2 text-xs sm:grid-cols-3"
      >
        <li className="min-w-0 rounded border border-white/10 p-2">
          <p className="text-[var(--muted)]">
            1 · {copy.decision.direction} · {guide.timeframe}
          </p>
          <p className="mt-1" data-guide-direction={decision.direction}>
            {copy.decision.directions[decision.direction]}
          </p>
        </li>
        <li className="min-w-0 rounded border border-white/10 p-2">
          <p className="text-[var(--muted)]">2 · {copy.decision.location}</p>
          {decision.zone ? (
            <p className="mt-1">
              {ready ? copy.entry : copy.potentialEntry}:{" "}
              <span className="font-mono">
                {number(decision.zone.low)} – {number(decision.zone.high)}
              </span>
            </p>
          ) : (
            <p className="mt-1">
              {guide.state === "MISSED"
                ? copy.decision.missedLocation
                : copy.decision.noLocation}
            </p>
          )}
        </li>
        <li className="min-w-0 rounded border border-white/10 p-2">
          <p className="text-[var(--muted)]">
            3 · {copy.decision.confirmation}
          </p>
          <p className="mt-1" data-guide-confirmation={decision.confirmation}>
            {copy.decision.confirmations[decision.confirmation]}
          </p>
        </li>
      </ol>
      <p className="text-[10px] text-[var(--muted)]">
        {copy.decision.closedOnly}
      </p>
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
        {copy.nextAction}:{" "}
        {decision.waitingAction
          ? copy.decision.actions[decision.waitingAction]
          : copy.actions[guide.next_action]}
      </p>
      <p className="text-xs text-[var(--muted)]">
        {guide.reason_codes
          .map((reason) =>
            reason === "confirmation_pending" &&
            decision.confirmation === "price_observed"
              ? copy.decision.evidencePending
              : copy.reasons[reason],
          )
          .join(" · ")}
      </p>
      <p className="text-[10px] text-[var(--muted)]">{copy.disclaimer}</p>
    </section>
  );
}
