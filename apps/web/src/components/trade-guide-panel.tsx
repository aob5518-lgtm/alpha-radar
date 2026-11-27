import type { ReactNode } from "react";

import type { Messages } from "@/lib/i18n/messages";
import type { MaEntryAnalysis } from "@/lib/market/ma-confluence-entry";
import { guideReady, type TradeGuideV1 } from "@/lib/market/trade-guide";
import { describeGuideDecision } from "@/lib/market/trade-guide-decision";

export function TradeGuidePanel({
  guide,
  analysis,
  copy,
  locale,
  technicalDetails,
}: {
  guide: TradeGuideV1;
  analysis?: MaEntryAnalysis;
  copy: Messages["chart"]["tradeGuide"];
  locale: "en" | "zh-CN";
  technicalDetails?: ReactNode;
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
      className="relative space-y-2 border-t border-white/10 py-3"
      data-trade-guide-state={guide.state}
      data-guide-instrument={guide.market_instrument_id}
      data-guide-timeframe={guide.timeframe}
    >
      <div className="flex items-center justify-between gap-2">
        <strong
          className={`inline-block rounded px-3 py-1 text-base ${ready ? "bg-emerald-400/20 text-emerald-300" : "bg-white/10 text-[var(--text)]"}`}
        >
          {copy.states[guide.state]}
          {(ready || watch) &&
            guide.quality_grade &&
            guide.quality_grade !== "none" &&
            ` · ${guide.quality_grade}`}
        </strong>
        <details>
          <summary className="cursor-pointer rounded px-2 py-1 text-xs text-[var(--muted)]">
            {copy.explanation}
          </summary>
          <div className="absolute inset-x-0 top-12 z-30 max-h-[50vh] space-y-3 overflow-y-auto rounded border bg-[var(--panel)] p-3 text-xs text-[var(--muted)] shadow-xl">
            <p>{copy.decision.closedOnly}</p>
            <p>{copy.disclaimer}</p>
            {technicalDetails && (
              <section className="space-y-2 border-t pt-3">
                <h3 className="font-semibold">{copy.technicalDetails}</h3>
                {technicalDetails}
              </section>
            )}
          </div>
        </details>
      </div>
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
    </section>
  );
}
