"use client";

import type { SimulatorState } from "@alpha-radar/types/event-simulator";
import { useEffect, useState, type ReactNode } from "react";

import { EventSemiAuto } from "@/components/event-semi-auto";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";

type Mode = "shadow" | "paper" | "semi-auto";
type ShadowCopy = Messages["chart"]["eventContracts"]["shadow"];

function ShadowView({ locale, copy }: { locale: Locale; copy: ShadowCopy }) {
  const [state, setState] = useState<SimulatorState | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    async function poll() {
      try {
        const response = await fetch("/api/v1/event-simulator", {
          cache: "no-store",
          signal: abort.signal,
        });
        if (!response.ok) throw new Error("Unavailable");
        setState((await response.json()) as SimulatorState);
        setFailed(false);
      } catch {
        if (!abort.signal.aborted) setFailed(true);
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, []);
  const zh = locale === "zh-CN";
  return (
    <section className="space-y-3" data-event-mode="shadow">
      <h1 className="text-xl font-semibold">
        {zh ? "事件合约 · 影子观察" : "Event Contracts · Shadow"}
      </h1>
      <p className="text-sm text-[var(--muted)]">
        {zh
          ? "Event Signal V1 · Binance Index 研究代理"
          : "Event Signal V1 · Binance Index research proxy"}
      </p>
      {!state || failed ? (
        <p role="status">
          {failed
            ? zh
              ? "信号暂不可用"
              : "Signals unavailable"
            : zh
              ? "正在加载信号…"
              : "Loading signals…"}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {state.signals.map(
            ({ symbol, horizon_minutes: horizon, assessment }) => (
              <article className="rounded-md border p-3" key={symbol + horizon}>
                <h2 className="font-medium">
                  {symbol} · {horizon}m
                </h2>
                <p>
                  {assessment.state.replaceAll("_", " ")} ·{" "}
                  {assessment.score ?? "—"}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {Object.entries(copy.reasons).find(
                    ([key]) => key === assessment.reason,
                  )?.[1] ?? copy.reasons.warming_up}
                </p>
              </article>
            ),
          )}
        </div>
      )}
    </section>
  );
}

export function EventContractModes({
  locale,
  copy,
  children,
  requestedIntent,
}: {
  locale: Locale;
  copy: ShadowCopy;
  children: ReactNode;
  requestedIntent: string | null;
}) {
  const [mode, setMode] = useState<Mode>(
    requestedIntent ? "semi-auto" : "paper",
  );
  const zh = locale === "zh-CN";
  const tabs: [Mode, string][] = [
    ["shadow", zh ? "影子观察" : "Shadow"],
    ["paper", zh ? "模拟下注" : "Paper"],
    ["semi-auto", zh ? "半自动" : "Semi-Auto"],
  ];
  return (
    <>
      <nav
        aria-label={zh ? "事件合约模式" : "Event Contract modes"}
        className="mb-4 flex flex-wrap gap-2"
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={mode === key}
            onClick={() => setMode(key)}
            className="min-h-11 rounded-md border px-4 text-sm aria-pressed:border-emerald-400 aria-pressed:text-emerald-300"
          >
            {label}
          </button>
        ))}
      </nav>
      {mode === "paper" ? (
        children
      ) : mode === "shadow" ? (
        <ShadowView locale={locale} copy={copy} />
      ) : (
        <EventSemiAuto
          locale={locale}
          shadow={copy}
          requestedIntent={requestedIntent}
        />
      )}
    </>
  );
}
