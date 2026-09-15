import type { RadarItem } from "@alpha-radar/types/radar";
import { ArrowRight, Clock3, Radio, ShieldCheck } from "lucide-react";

import { DemoBadge } from "@/components/demo-badge";
import type { Locale } from "@/lib/i18n/config";
import {
  confidenceLabel,
  eventTypeLabel,
  impactLabel,
  statusLabel,
} from "@/lib/i18n/intelligence-labels";
import type { Messages } from "@/lib/i18n/messages";
import { DEMO_REFERENCE_TIME, localize } from "@/lib/intelligence/demo-data";
import {
  formatDemoDate,
  formatRelativeToSnapshot,
  impactTone,
  statusTone,
} from "@/lib/intelligence/presentation";
import { cn } from "@/lib/utils";

interface EventCardProps {
  item: RadarItem;
  locale: Locale;
  messages: Messages;
  onSelect?: (item: RadarItem) => void;
  compact?: boolean;
}

export function EventCard({
  item,
  locale,
  messages,
  onSelect,
  compact = false,
}: EventCardProps) {
  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("data-pill", statusTone(item.status))}>
          <Radio className="size-3" aria-hidden="true" />
          {statusLabel(item.status, messages)}
        </span>
        <span className="data-pill">
          {eventTypeLabel(item.eventType, messages)}
        </span>
        <DemoBadge label={messages.common.demoData} />
      </div>
      <h3
        className={cn(
          "mt-4 leading-snug font-semibold",
          compact ? "text-base" : "text-lg",
        )}
      >
        {localize(item.title, locale)}
      </h3>
      {!compact && (
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--muted)]">
          {localize(item.summary, locale)}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {item.impacts.slice(0, compact ? 3 : 5).map((impact) => (
          <span
            key={impact.assetId}
            className={cn("data-pill", impactTone(impact.impact))}
          >
            {impact.symbol} · {impactLabel(impact.impact, messages)}
          </span>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-xs text-[var(--muted)]">
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="size-3.5" aria-hidden="true" />
          {formatRelativeToSnapshot(
            item.detectedAt,
            DEMO_REFERENCE_TIME,
            messages,
          )}{" "}
          · {formatDemoDate(item.eventTime ?? item.detectedAt, locale)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          {confidenceLabel(item.confidence, messages)} · {item.sourceCount}{" "}
          {messages.radar.sourceCount}
          {onSelect && <ArrowRight className="size-3.5" aria-hidden="true" />}
        </span>
      </div>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="panel block w-full p-5 text-left transition hover:border-zinc-500 hover:bg-white/[0.025]"
        aria-label={`${messages.common.openDetails}: ${localize(item.title, locale)}`}
      >
        {content}
      </button>
    );
  }
  return <article className="panel p-5">{content}</article>;
}
