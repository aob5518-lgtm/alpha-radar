"use client";

import type {
  EventContractHorizon,
  EventContractResearch,
} from "@alpha-radar/types/event-contracts";
import { useEffect, useState } from "react";

import type { Messages } from "@/lib/i18n/messages";
import { formatDateTime, formatMarketPrice } from "@/lib/i18n/format";
import {
  researchIdentityMatches,
  researchPresentation,
} from "@/lib/market/event-contract-research";

interface Props {
  assetId: string;
  symbol: string;
  copy: Messages["chart"]["eventContracts"];
  locale: "en" | "zh-CN";
}

export function EventContractPanel(props: Props) {
  const [horizon, setHorizon] = useState<EventContractHorizon>(10);
  const [expanded, setExpanded] = useState(false);
  return (
    <EventContractView
      key={props.assetId}
      {...props}
      horizon={horizon}
      onHorizonChange={setHorizon}
      expanded={expanded}
      onExpandedChange={setExpanded}
    />
  );
}

function EventContractView({
  assetId,
  symbol,
  copy,
  locale,
  horizon,
  onHorizonChange,
  expanded,
  onExpandedChange,
}: Props & {
  horizon: EventContractHorizon;
  onHorizonChange: (value: EventContractHorizon) => void;
  expanded: boolean;
  onExpandedChange: (value: boolean) => void;
}) {
  const [data, setData] = useState<EventContractResearch | null>(null);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    setData(null);
    setLoading(true);
    let disposed = false;
    let active: AbortController | null = null;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      active = new AbortController();
      try {
        const response = await fetch(
          `/api/v1/event-contracts/${encodeURIComponent(assetId)}?horizon=${horizon}`,
          { cache: "no-store", signal: active.signal },
        );
        if (!response.ok) throw new Error("Research unavailable");
        const next = (await response.json()) as EventContractResearch;
        if (!researchIdentityMatches(next, assetId, symbol, horizon))
          throw new Error("Research identity mismatch");
        if (!disposed) setData(next);
      } catch {
        if (!disposed) setData(null);
      } finally {
        pending = false;
        if (!disposed) {
          setLoading(false);
          setClock(Date.now());
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const clockTimer = window.setInterval(() => setClock(Date.now()), 1000);
    const resume = () => void refresh();
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      active?.abort();
      window.clearInterval(timer);
      window.clearInterval(clockTimer);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [assetId, symbol, horizon]);
  const current = researchPresentation(
    data,
    assetId,
    symbol,
    horizon,
    clock ?? 0,
  );
  const identityMatches =
    data && researchIdentityMatches(data, assetId, symbol, horizon);
  const observations = identityMatches ? data.observations : [];
  return (
    <details
      open={expanded}
      onToggle={(event) => onExpandedChange(event.currentTarget.open)}
      className="relative ml-auto max-w-full text-xs"
      data-event-contract-asset={assetId}
      data-event-contract-horizon={horizon}
      data-event-contract-direction={current.direction}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded border border-amber-300/20 px-2 py-1.5">
        <span>{copy.title}</span>
        <span className="font-mono">
          {symbol} · {horizon}m
        </span>
        <span>
          {loading ? copy.loading : copy.directions[current.direction]}
        </span>
        <span className="text-[10px] text-amber-200">{copy.unvalidated}</span>
      </summary>
      <div className="absolute top-full right-0 z-30 mt-2 max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] overflow-auto rounded border bg-[var(--panel)] p-4 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2">
            {copy.horizon}
            <select
              aria-label={copy.horizon}
              value={horizon}
              className="rounded border bg-[var(--panel)] p-1"
              onChange={(event) =>
                onHorizonChange(event.target.value === "30" ? 30 : 10)
              }
            >
              <option value="10">{copy.tenMinutes}</option>
              <option value="30">{copy.thirtyMinutes}</option>
            </select>
          </label>
          <span className="text-[var(--muted)]">Binance Index</span>
        </div>
        <p role="status" className="mt-3 font-medium">
          {loading ? copy.loading : copy.reasons[current.reason]}
        </p>
        {identityMatches && data.assessment.reference_price && (
          <p className="mt-2 font-mono text-[var(--muted)]">
            {copy.reference}:{" "}
            {formatMarketPrice(
              Number(data.assessment.reference_price),
              locale,
              "USDT",
            )}
          </p>
        )}
        {identityMatches && data.assessment.confirmed_at && (
          <p className="mt-1 text-[var(--muted)]">
            {copy.confirmed}:{" "}
            {formatDateTime(data.assessment.confirmed_at, locale)}
          </p>
        )}
        <p className="mt-3 leading-5 text-amber-100">{copy.disclaimer}</p>
        <p className="mt-2 leading-5 text-[var(--muted)]">{copy.basis}</p>
        <p className="mt-2 leading-5 text-[var(--muted)]">{copy.independent}</p>
        <h3 className="mt-4 font-medium">{copy.observations}</h3>
        {observations.length === 0 ? (
          <p className="mt-2 text-[var(--muted)]">{copy.empty}</p>
        ) : (
          <ol className="mt-2 divide-y">
            {observations.slice(0, 5).map((item) => (
              <li key={item.id} className="py-2">
                <p className="flex flex-wrap justify-between gap-1">
                  <span>{copy.directions[item.direction]}</span>
                  <span>{copy.outcomes[item.outcome]}</span>
                </p>
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  {formatDateTime(item.entry_at, locale)} →{" "}
                  {formatDateTime(item.expires_at, locale)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}
