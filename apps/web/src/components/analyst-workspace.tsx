"use client";

import type {
  AnalystResponse,
  AnalystStatement,
} from "@alpha-radar/types/core-3";
import type { MarketInterval } from "@alpha-radar/types/market-data";
import { Bot, Send, User } from "lucide-react";
import { FormEvent, useState } from "react";

import { getClientTranslations } from "@/lib/i18n/client";

interface Turn {
  question: string;
  answer: AnalystResponse | null;
  error?: string;
}

export function AnalystWorkspace({
  assetId,
  symbol,
  timeframe,
  configured,
}: {
  assetId: string | null;
  symbol: string | null;
  timeframe: MarketInterval;
  configured: boolean;
}) {
  const { messages } = getClientTranslations();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const enabled = configured && !!assetId;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = question.trim();
    if (!enabled || !value || pending) return;
    setQuestion("");
    setPending(true);
    try {
      const response = await fetch("/api/analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: value, asset_id: assetId, timeframe }),
      });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const answer = (await response.json()) as AnalystResponse;
      setTurns((items) => [...items, { question: value, answer }]);
    } catch (error) {
      setTurns((items) => [
        ...items,
        {
          question: value,
          answer: null,
          error: error instanceof Error ? error.message : "Unavailable",
        },
      ]);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="grid min-h-[calc(100vh-8rem)] lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-r p-4">
        <h2 className="text-sm font-semibold">
          {messages.analyst.contextTitle}
        </h2>
        <dl className="mt-4 space-y-3 text-xs">
          <Row label={messages.chart.asset} value={symbol ?? "—"} />
          <Row label={messages.chart.timeframe} value={timeframe} />
          <Row label={messages.analyst.engine} value="V1.1" />
        </dl>
        <p className="mt-6 text-xs leading-5 text-[var(--muted)]">
          {messages.analyst.guardrailDescription}
        </p>
      </aside>
      <section className="flex min-h-0 flex-col">
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {turns.length === 0 && (
            <div className="mx-auto mt-24 max-w-lg text-center">
              <Bot className="mx-auto size-7 text-emerald-300" />
              <h2 className="mt-3 font-semibold">
                {enabled ? messages.analyst.title : messages.analyst.disabled}
              </h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {enabled
                  ? messages.analyst.description
                  : assetId
                    ? messages.analyst.answerUnavailable
                    : messages.analyst.noContext}
              </p>
            </div>
          )}
          {turns.map((turn, index) => (
            <div key={index} className="mx-auto max-w-3xl space-y-4">
              <div className="flex gap-3">
                <User className="mt-1 size-4" />
                <p className="text-sm">{turn.question}</p>
              </div>
              {turn.answer ? (
                <Answer answer={turn.answer} />
              ) : (
                <p className="ml-7 text-sm text-rose-300">{turn.error}</p>
              )}
            </div>
          ))}
          {pending && (
            <p className="mx-auto max-w-3xl text-sm text-[var(--muted)]">
              {messages.analyst.analyzing}
            </p>
          )}
        </div>
        <form
          onSubmit={submit}
          className="sticky bottom-0 flex border-t bg-[var(--panel)] p-3"
        >
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={!enabled || pending}
            maxLength={2000}
            placeholder={messages.analyst.placeholder}
            className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
          />
          <button
            disabled={!enabled || pending || !question.trim()}
            className="icon-button"
            aria-label={messages.analyst.send}
          >
            <Send className="size-4" />
          </button>
        </form>
      </section>
    </div>
  );
}

function Answer({ answer }: { answer: AnalystResponse }) {
  const { messages } = getClientTranslations();
  const sections: [string, AnalystStatement[]][] = [
    [messages.analyst.marketState, answer.market_state],
    [messages.analyst.trend, answer.trend],
    [messages.analyst.importantEvents, answer.important_recent_events],
    [messages.analyst.bullCase, answer.bull_case],
    [messages.analyst.bearCase, answer.bear_case],
    [messages.analyst.triggers, answer.trigger_conditions],
    [messages.analyst.invalidation, answer.invalidation_and_risk],
    [messages.analyst.watchNext, answer.watch_next],
  ];
  return (
    <div className="ml-7 space-y-4 border-l pl-4">
      {sections
        .filter(([, rows]) => rows.length)
        .map(([title, rows]) => (
          <section key={title}>
            <h3 className="section-label">{title}</h3>
            <div className="mt-2 space-y-2">
              {rows.map((row, index) => (
                <div key={index}>
                  <p className="text-sm leading-6">
                    <span className="mr-2 text-[10px] font-semibold text-emerald-300">
                      {messages.analyst[row.kind]}
                    </span>
                    {row.text}
                  </p>
                  {row.source_reference_ids.length > 0 && (
                    <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                      {messages.analyst.evidence}:{" "}
                      {row.source_reference_ids.join(" · ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      <Levels
        title={messages.analyst.keyResistance}
        levels={answer.key_resistance.map(
          (level) => `${level.label} ${level.representative_price}`,
        )}
      />
      <Levels
        title={messages.analyst.keySupport}
        levels={answer.key_support.map(
          (level) => `${level.label} ${level.representative_price}`,
        )}
      />
      <p className="text-[10px] text-[var(--muted)]">
        {answer.model_provider} · {answer.model_version} · {answer.generated_at}{" "}
        · {answer.technical_model_version}
      </p>
    </div>
  );
}

function Levels({ title, levels }: { title: string; levels: string[] }) {
  return levels.length ? (
    <section>
      <h3 className="section-label">{title}</h3>
      <p className="mt-2 font-mono text-sm">{levels.join(" · ")}</p>
    </section>
  ) : null;
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-t pt-3">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
