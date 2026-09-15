"use client";

import type { RadarItem } from "@alpha-radar/types/radar";
import { ArrowDownRight, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { DemoBadge } from "@/components/demo-badge";
import { RelatedStrategy } from "@/components/strategy/strategy-ui";
import type { Locale } from "@/lib/i18n/config";
import {
  confidenceLabel,
  directionLabel,
  eventTypeLabel,
  horizonLabel,
  impactLabel,
  intelligenceKindLabel,
  orderLabel,
  pricedInLabel,
  sourceTierLabel,
  statusLabel,
} from "@/lib/i18n/intelligence-labels";
import type { Messages } from "@/lib/i18n/messages";
import { localize } from "@/lib/intelligence/demo-data";
import {
  directionTone,
  impactTone,
  statusTone,
} from "@/lib/intelligence/presentation";
import { cn } from "@/lib/utils";

interface EventDrawerProps {
  item: RadarItem;
  items: RadarItem[];
  locale: Locale;
  messages: Messages;
  onClose: () => void;
  onSelect: (item: RadarItem) => void;
}

export function EventDrawer({
  item,
  items,
  locale,
  messages,
  onClose,
  onSelect,
}: EventDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) =>
      event.key === "Escape" && onClose();
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, item.id]);

  const related = item.relatedEventIds.flatMap((id) => {
    const match = items.find((candidate) => candidate.id === id);
    return match ? [match] : [];
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65"
      role="presentation"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-detail-title"
        className="absolute inset-y-0 right-0 w-full max-w-2xl overflow-y-auto border-l bg-[var(--panel)] p-5 shadow-2xl sm:p-8"
      >
        <div className="flex items-center justify-between gap-4">
          <p className="section-label">{messages.radar.eventDetail}</p>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label={messages.common.close}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <span className={cn("data-pill", statusTone(item.status))}>
            {statusLabel(item.status, messages)}
          </span>
          <span className="data-pill">
            {eventTypeLabel(item.eventType, messages)}
          </span>
          <DemoBadge label={messages.common.demoData} />
        </div>
        <h2
          id="event-detail-title"
          className="mt-5 text-3xl font-semibold tracking-tight"
        >
          {localize(item.title, locale)}
        </h2>

        <section className="mt-8 border-t pt-6">
          <h3 className="text-sm font-semibold">
            {messages.radar.whatHappened}
          </h3>
          <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
            {localize(item.summary, locale)}
          </p>
        </section>
        <section className="mt-6 space-y-4">
          <h3 className="text-sm font-semibold">
            {messages.radar.whyItMatters}
          </h3>
          {item.blocks.map((block) => (
            <div key={block.kind} className="rounded-xl border bg-black/15 p-4">
              <span className="section-label">
                {intelligenceKindLabel(block.kind, messages)}
              </span>
              <p className="mt-2 text-sm leading-6">
                {localize(block.content, locale)}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-8 border-t pt-6">
          <h3 className="text-sm font-semibold">
            {messages.radar.affectedAssets}
          </h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {item.assets.map((asset) => (
              <Link
                key={asset.assetId}
                href={`/assets/${asset.slug}`}
                className="data-pill hover:border-emerald-400 hover:text-emerald-300"
              >
                {asset.symbol}
                <ExternalLink className="size-3" />
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-8 border-t pt-6">
          <h3 className="text-sm font-semibold">
            {messages.radar.impactAnalysis}
          </h3>
          <div className="mt-4 space-y-3">
            {item.impacts.map((impact) => (
              <div
                key={impact.assetId}
                className="grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-[5rem_1fr_auto]"
              >
                <Link
                  href={`/assets/${item.assets.find((asset) => asset.assetId === impact.assetId)?.slug ?? impact.assetId}`}
                  className="font-bold text-emerald-300"
                >
                  {impact.symbol}
                  <ExternalLink className="ml-1 inline size-3" />
                </Link>
                <div className="flex flex-wrap gap-2">
                  <span
                    className={cn("data-pill", directionTone(impact.direction))}
                  >
                    {directionLabel(impact.direction, messages)}
                  </span>
                  <span className={cn("data-pill", impactTone(impact.impact))}>
                    {impactLabel(impact.impact, messages)}
                  </span>
                  <span className="data-pill">
                    {horizonLabel(impact.horizon, messages)}
                  </span>
                </div>
                <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
                  <ArrowDownRight className="size-3" />
                  {orderLabel(impact.order, messages)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <dl className="mt-8 grid gap-4 border-t pt-6 sm:grid-cols-3">
          <div>
            <dt className="section-label">{messages.radar.confidence}</dt>
            <dd className="mt-2">
              {confidenceLabel(item.confidence, messages)}
            </dd>
          </div>
          <div>
            <dt className="section-label">{messages.radar.impact}</dt>
            <dd className="mt-2">{impactLabel(item.importance, messages)}</dd>
          </div>
          <div>
            <dt className="section-label">{messages.radar.pricedIn}</dt>
            <dd className="mt-2">{pricedInLabel(item.pricedIn, messages)}</dd>
          </div>
        </dl>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <section className="panel p-4">
            <h3 className="text-sm font-semibold">{messages.radar.risks}</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {localize(item.risks, locale)}
            </p>
          </section>
          <section className="panel p-4">
            <h3 className="text-sm font-semibold">
              {messages.radar.whatChanged}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {item.whatChanged
                ? localize(item.whatChanged, locale)
                : messages.radar.noUpdate}
            </p>
          </section>
        </div>
        <section className="panel mt-4 p-4">
          <h3 className="text-sm font-semibold">{messages.radar.watchNext}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {item.watchNext
              ? localize(item.watchNext, locale)
              : messages.radar.noUpdate}
          </p>
        </section>
        <section className="mt-8 border-t pt-6">
          <h3 className="text-sm font-semibold">{messages.radar.sources}</h3>
          <div className="mt-3 space-y-2">
            {item.sources.map((source) => (
              <div
                key={source.id}
                className="flex items-center justify-between rounded-lg border p-3 text-sm"
              >
                <span>
                  {source.name}
                  <span className="ml-2 text-xs text-amber-300">
                    {messages.radar.sampleSource}
                  </span>
                </span>
                <span className="data-pill">
                  {sourceTierLabel(source.tier, messages)}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section className="mt-8 border-t pt-6">
          <h3 className="text-sm font-semibold">
            {messages.radar.relatedEvents}
          </h3>
          <div className="mt-3 space-y-2">
            {related.length ? (
              related.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onSelect(event)}
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm hover:bg-white/[0.03]"
                >
                  <span>{localize(event.title, locale)}</span>
                  <ArrowDownRight className="size-4 -rotate-90" />
                </button>
              ))
            ) : (
              <p className="text-sm text-[var(--muted)]">
                {messages.radar.noRelatedEvents}
              </p>
            )}
          </div>
        </section>
        <RelatedStrategy
          eventId={item.id}
          locale={locale}
          messages={messages}
        />
        <p className="mt-8 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-xs leading-5 text-amber-100">
          {messages.common.demoDisclaimer}
        </p>
      </aside>
    </div>
  );
}
