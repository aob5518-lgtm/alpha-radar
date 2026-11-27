"use client";

import type {
  PaperBet,
  SimulationSettings,
  SimulatorAssessment,
  SimulatorPerformance,
  SimulatorState,
} from "@alpha-radar/types/event-simulator";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";

type Copy = Messages["eventSimulator"];
type Shadow = Messages["chart"]["eventContracts"]["shadow"];
type Formats = ReturnType<typeof formats>;
const api = "/api/v1/event-simulator";
const box = "rounded-md border bg-[var(--panel)] p-4";
const button =
  "rounded border px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-50";
const input =
  "w-full rounded border bg-[var(--background)] px-2 py-1.5 text-sm";

function formats(locale: Locale) {
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 });
  const cents = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const time = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return {
    amount: (value: string | null) =>
      value === null ? "—" : cents.format(Number(value)) + " USDT",
    number: (value: string | number | null) =>
      value === null ? "—" : decimal.format(Number(value)),
    percent: (value: string | number | null) =>
      value === null ? "—" : cents.format(Number(value)) + "%",
    time: (value: string | null) =>
      value === null ? "—" : time.format(new Date(value)),
  };
}

function Metrics({ values }: { values: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-3">
      {values.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded border p-2">
          <dt className="text-xs text-[var(--muted)]">{label}</dt>
          <dd className="mt-1 font-mono text-sm break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function evidence(assessment: SimulatorAssessment, shadow: Shadow) {
  return Object.entries(shadow.evidence)
    .filter(([key]) => assessment.evidence[key])
    .map(([, label]) => label);
}

function reason(assessment: SimulatorAssessment, shadow: Shadow) {
  return (
    Object.entries(shadow.reasons).find(
      ([key]) => key === assessment.reason,
    )?.[1] ?? shadow.reasons.warming_up
  );
}

function Equity({
  points,
  copy,
  format,
}: {
  points: SimulatorState["equity"];
  copy: Copy;
  format: Formats;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    const first = points[0];
    if (!ctx || !first) return;
    const draw = () => {
      const chart = ctx.canvas;
      const width = Math.max(1, chart.clientWidth);
      const height = Math.max(1, chart.clientHeight);
      const dpr = window.devicePixelRatio || 1;
      chart.width = width * dpr;
      chart.height = height * dpr;
      ctx.scale(dpr, dpr);
      const values = points.map((point) => Number(point.bankroll));
      const base = Number(first.bankroll);
      const low = Math.min(...values) - Math.max(1, base * 0.001);
      const high = Math.max(...values) + Math.max(1, base * 0.001);
      const firstTime = Date.parse(first.at);
      const span = Math.max(
        1,
        Date.parse((points.at(-1) ?? first).at) - firstTime,
      );
      const y = (value: number) =>
        8 + ((height - 16) * (high - value)) / (high - low);
      const x = (time: number) => 4 + ((width - 8) * (time - firstTime)) / span;
      ctx.beginPath();
      ctx.strokeStyle = "#64748b";
      ctx.setLineDash([4, 4]);
      ctx.moveTo(0, y(base));
      ctx.lineTo(width, y(base));
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = "#34d399";
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.moveTo(4, y(base));
      let previous = base;
      for (const point of points.slice(1)) {
        const value = Number(point.bankroll);
        const at = x(Date.parse(point.at));
        ctx.lineTo(at, y(previous));
        ctx.lineTo(at, y(value));
        previous = value;
      }
      ctx.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(ctx.canvas);
    return () => observer.disconnect();
  }, [points]);
  const start = points[0];
  const end = points.at(-1);
  return (
    <figure className="rounded border p-3">
      <figcaption className="mb-1 text-sm font-medium">{copy.curve}</figcaption>
      <canvas
        className="block h-24 w-full"
        role="img"
        aria-label={copy.curve}
      />
      <div className="flex flex-wrap justify-between gap-1 text-xs text-[var(--muted)]">
        <span>
          {format.time(start?.at ?? null)} ·{" "}
          {format.amount(start?.bankroll ?? null)}
        </span>
        <span>
          {format.time(end?.at ?? null)} ·{" "}
          {format.amount(end?.bankroll ?? null)}
        </span>
      </div>
    </figure>
  );
}

function Bets({
  bets,
  copy,
  shadow,
  format,
  active,
}: {
  bets: PaperBet[];
  copy: Copy;
  shadow: Shadow;
  format: Formats;
  active?: boolean;
}) {
  const headings = [
    copy.time,
    copy.symbol,
    copy.horizon,
    copy.direction,
    copy.evidence,
    copy.stake,
    copy.payout,
    copy.reference,
    active ? copy.expiry : copy.settlement,
    copy.result,
    ...(active ? [] : [copy.pnl, copy.bankroll]),
    copy.details,
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            {headings.map((label) => (
              <th
                key={label}
                scope="col"
                className="border-b px-2 py-2 font-medium whitespace-nowrap"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bets.map((bet) => (
            <tr
              key={bet.id}
              data-paper-bet={bet.id}
              className="border-b align-top"
            >
              {[
                format.time(bet.bet_created_at),
                bet.symbol,
                bet.horizon_minutes + "m",
                shadow.states[bet.direction === "higher" ? "HIGHER" : "LOWER"],
                bet.signal_score,
                format.amount(bet.virtual_stake),
                format.number(bet.payout_multiplier) + "×",
                format.number(bet.reference_price),
                active
                  ? format.time(bet.expiry_at)
                  : format.number(bet.settlement_price),
                copy.statuses[bet.status],
                ...(active
                  ? []
                  : [
                      format.amount(bet.net_pnl),
                      format.amount(bet.bankroll_after),
                    ]),
              ].map((value, index) => (
                <td
                  key={headings[index]}
                  className="px-2 py-2 whitespace-nowrap"
                >
                  {value}
                </td>
              ))}
              <td className="px-2 py-2">
                <details className="min-w-24">
                  <summary className="cursor-pointer">{copy.details}</summary>
                  <div className="mt-1 min-w-56 space-y-2 text-xs">
                    <p>{reason(bet.assessment, shadow)}</p>
                    <p>{evidence(bet.assessment, shadow).join(" · ")}</p>
                    <p>
                      {copy.regime} ·{" "}
                      {bet.assessment.regime
                        ? copy.regimes[bet.assessment.regime]
                        : "—"}
                    </p>
                    <p>
                      {copy.referenceSource} · {bet.reference_source}
                    </p>
                    <p>
                      {copy.settlementSource} · {bet.settlement_source}
                    </p>
                    <p>
                      {copy.breakeven} ·{" "}
                      {format.percent(Number(bet.breakeven_probability) * 100)}
                    </p>
                    <details>
                      <summary className="cursor-pointer">
                        {copy.snapshot}
                      </summary>
                      <pre className="whitespace-pre-wrap">
                        {JSON.stringify(bet.settings_snapshot, null, 2)}
                      </pre>
                    </details>
                  </div>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  copy,
  format,
  kind,
}: {
  title: string;
  rows: [string, SimulatorPerformance][];
  copy: Copy;
  format: Formats;
  kind: "market" | "score" | "direction";
}) {
  const more =
    kind === "market"
      ? [copy.returnContribution, copy.streak]
      : kind === "direction"
        ? [copy.wins, copy.losses]
        : [];
  return (
    <section className="min-w-0 overflow-x-auto">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <table className="w-full text-left text-xs">
        <thead>
          <tr>
            {[title, copy.bets, copy.winRate, copy.pnl, ...more].map((item) => (
              <th
                key={item}
                scope="col"
                className="border-b p-2 whitespace-nowrap"
              >
                {item}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, row]) => (
            <tr key={label} className="border-b">
              <th scope="row" className="p-2 font-medium whitespace-nowrap">
                {label}
              </th>
              {[
                row.bets,
                format.percent(row.win_rate),
                format.amount(row.net_pnl),
                ...(kind === "market"
                  ? [format.percent(row.return_percent), row.max_losing_streak]
                  : kind === "direction"
                    ? [row.wins, row.losses]
                    : []),
              ].map((value, index) => (
                <td className="p-2 font-mono whitespace-nowrap" key={index}>
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SettingsForm({
  defaults,
  copy,
  busy,
  submit,
}: {
  defaults: SimulationSettings;
  copy: Copy;
  busy: boolean;
  submit: (settings: SimulationSettings) => void;
}) {
  const [mode, setMode] = useState(defaults.stake_mode);
  const [payout10, setPayout10] = useState(defaults.payout_10m);
  const [payout30, setPayout30] = useState(defaults.payout_30m);
  const breakEven = (value: string) =>
    Number(value) > 1 ? (100 / Number(value)).toFixed(2) + "%" : "—";
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: keyof SimulationSettings) =>
      String(data.get(key) ?? "");
    submit({
      starting_bankroll: value("starting_bankroll"),
      markets: (["BTCUSDT", "ETHUSDT"] as const).filter((market) =>
        data.has(market),
      ),
      horizons: ([10, 30] as const).filter((horizon) =>
        data.has(String(horizon)),
      ),
      allow_regular_signals: data.has("allow_regular_signals"),
      minimum_score: Number(value("minimum_score")),
      stake_mode: mode,
      fixed_stake: value("fixed_stake"),
      stake_percent: value("stake_percent"),
      payout_10m: payout10,
      payout_30m: payout30,
      max_daily_loss_percent: value("max_daily_loss_percent"),
      max_consecutive_losses: Number(value("max_consecutive_losses")),
      cooldown_minutes: Number(value("cooldown_minutes")),
      max_active_bets: Number(value("max_active_bets")),
    });
  }
  const numeric: [keyof SimulationSettings, string, number, number, number][] =
    [
      ["starting_bankroll", copy.starting, 1, 10000000, 0.01],
      ["minimum_score", copy.minimumScore, 75, 100, 1],
      ["stake_percent", copy.percentage, 0.01, 2, 0.01],
      ["fixed_stake", copy.fixed, 0.01, 200000, 0.01],
      ["max_daily_loss_percent", copy.dailyLoss, 0.01, 100, 0.01],
      ["max_consecutive_losses", copy.lossLimit, 1, 50, 1],
      ["cooldown_minutes", copy.cooldownMinutes, 1, 1440, 1],
      ["max_active_bets", copy.activeLimit, 1, 4, 1],
    ];
  return (
    <form className="mt-3 space-y-3" onSubmit={onSubmit}>
      <p className="text-sm text-[var(--muted)]">{copy.newSettings}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {numeric.map(([name, label, min, max, step]) => (
          <label key={name} className="text-xs">
            {label}
            <input
              className={input}
              type="number"
              name={name}
              min={min}
              max={max}
              step={step}
              defaultValue={String(defaults[name])}
              required
            />
          </label>
        ))}
        <label className="text-xs">
          {copy.stakeMode}
          <select
            className={input}
            value={mode}
            onChange={(event) =>
              setMode(event.target.value === "fixed" ? "fixed" : "percentage")
            }
          >
            <option value="percentage">{copy.percentage}</option>
            <option value="fixed">{copy.fixed}</option>
          </select>
        </label>
        {(
          [
            [10, payout10, setPayout10],
            [30, payout30, setPayout30],
          ] as const
        ).map(([horizon, payout, setter]) => (
          <label key={horizon} className="text-xs">
            {copy.payout} · {horizon}m
            <input
              className={input}
              type="number"
              min="1.01"
              max="10"
              step=".01"
              value={payout}
              onChange={(event) => setter(event.target.value)}
              required
            />
            <span className="mt-1 block text-[var(--muted)]">
              {copy.breakeven} · {breakEven(payout)}
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <fieldset className="space-x-2">
          <legend>{copy.markets}</legend>
          {(["BTCUSDT", "ETHUSDT"] as const).map((market) => (
            <label key={market}>
              <input
                type="checkbox"
                name={market}
                defaultChecked={defaults.markets.includes(market)}
              />{" "}
              {market.slice(0, 3)}
            </label>
          ))}
        </fieldset>
        <fieldset className="space-x-2">
          <legend>{copy.horizons}</legend>
          {([10, 30] as const).map((horizon) => (
            <label key={horizon}>
              <input
                type="checkbox"
                name={String(horizon)}
                defaultChecked={defaults.horizons.includes(horizon)}
              />{" "}
              {horizon}m
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            name="allow_regular_signals"
            defaultChecked={defaults.allow_regular_signals}
          />{" "}
          {copy.regular}
        </label>
      </div>
      <button className={button} disabled={busy} type="submit">
        {copy.newRun}
      </button>
    </form>
  );
}

export function EventSimulator({
  locale,
  copy,
  shadow,
}: {
  locale: Locale;
  copy: Copy;
  shadow: Shadow;
}) {
  const [result, setResult] = useState<SimulatorState | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [before, setBefore] = useState("");
  const [sessionsBefore, setSessionsBefore] = useState("");
  const [revision, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const token = useRef<HTMLInputElement>(null);
  const format = formats(locale);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (sessionId) query.set("session_id", sessionId);
    if (before) query.set("before", before);
    if (sessionsBefore) query.set("sessions_before", sessionsBefore);
    let interval: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(api + "?" + query, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const next: SimulatorState = await response.json();
        if (!controller.signal.aborted) {
          setResult(next);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) interval = setTimeout(refresh, 8000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(interval);
    };
  }, [sessionId, before, sessionsBefore, revision]);

  async function mutate(method: "POST" | "PATCH", payload: object) {
    const secret = token.current?.value.trim();
    if (!secret) {
      setMessage(copy.auth);
      token.current?.focus();
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(api, {
        method,
        body: JSON.stringify(payload),
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + secret,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        setSessionId("");
        setBefore("");
        setSessionsBefore("");
        setRevision((value) => value + 1);
      } else {
        setMessage(
          response.status === 401
            ? copy.auth
            : response.status === 409
              ? copy.stale
              : response.status === 422
                ? copy.invalid
                : copy.error,
        );
        if (response.status === 409) setRevision((value) => value + 1);
      }
    } catch {
      setMessage(copy.error);
    } finally {
      setBusy(false);
    }
  }

  const session = result?.session;
  const perf = result?.performance;
  return (
    <main className="page-shell space-y-4" data-paper-simulator>
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold sm:text-2xl">{copy.title}</h1>
          <span className="rounded border border-amber-400/40 px-2 py-1 text-xs text-amber-200">
            {copy.badge}
          </span>
        </div>
        <p className="mt-2 text-sm">{copy.disclaimer}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {copy.proxy} · {copy.proxyNote}
        </p>
      </header>
      {failed && <p role="alert">{copy.error}</p>}
      {!result && !failed && <p role="status">{copy.loading}</p>}
      {result && perf && (
        <>
          <section className={box + " space-y-3"}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{copy.status}</h2>
              <span
                className="text-sm"
                data-simulation-status={session?.status}
              >
                {session ? copy[session.status] : copy.noSession}
              </span>
              <span className="text-xs text-[var(--muted)]">
                {result.last_tick_at
                  ? copy.worker + " · " + format.time(result.last_tick_at)
                  : copy.workerWaiting}
              </span>
            </div>
            {session && (
              <Metrics
                values={[
                  [copy.bankroll, format.amount(session.current_bankroll)],
                  [
                    copy.starting,
                    format.amount(session.settings_snapshot.starting_bankroll),
                  ],
                  [copy.available, format.amount(session.available_bankroll)],
                  [copy.pnl, format.amount(session.net_pnl)],
                  [copy.returns, format.percent(perf.return_percent)],
                  [copy.active, session.active_bets],
                  [copy.settled, session.settled_bets],
                  [copy.winRate, format.percent(perf.win_rate)],
                  [
                    copy.drawdown,
                    format.percent(Number(session.max_drawdown) * 100),
                  ],
                  [copy.streak, perf.max_losing_streak],
                ]}
              />
            )}
            {session?.daily_limit_reached && (
              <p className="text-sm text-amber-200">{copy.riskStop}</p>
            )}
            {session?.cooldown_until && (
              <p className="text-sm text-amber-200">
                {copy.cooldown} · {format.time(session.cooldown_until)}
              </p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-xs">
                {copy.past}
                <select
                  className={input}
                  value={sessionId}
                  onChange={(event) => {
                    setSessionId(event.target.value);
                    setBefore("");
                  }}
                >
                  <option value="">{copy.current}</option>
                  {sessionId &&
                    !result.sessions.some((item) => item.id === sessionId) && (
                      <option value={sessionId}>
                        {format.time(session?.started_at ?? null)}
                      </option>
                    )}
                  {result.sessions
                    .filter((item) => item.id !== result.current_session_id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {format.time(item.started_at)} · {copy[item.status]}
                      </option>
                    ))}
                </select>
              </label>
              {result.next_session_cursor && (
                <button
                  className={button}
                  onClick={() =>
                    setSessionsBefore(result.next_session_cursor ?? "")
                  }
                >
                  {copy.moreSessions}
                </button>
              )}
              {sessionsBefore && (
                <button
                  className={button}
                  onClick={() => setSessionsBefore("")}
                >
                  {copy.latest}
                </button>
              )}
              {session && session.status !== "archived" && (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void mutate("PATCH", {
                      session_id: session.id,
                      action: session.status === "running" ? "pause" : "start",
                    })
                  }
                >
                  {session.status === "running" ? copy.pause : copy.start}
                </button>
              )}
            </div>
          </section>
          <section className="space-y-2">
            <h2 className="font-semibold">{copy.signals}</h2>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {result.signals.map((signal) => (
                <article
                  className={box + " space-y-1 text-sm"}
                  key={signal.symbol + signal.horizon_minutes}
                  data-simulator-signal={
                    signal.symbol + ":" + signal.horizon_minutes
                  }
                >
                  <h3 className="font-semibold">
                    {signal.symbol} · {signal.horizon_minutes}m
                  </h3>
                  <p className="text-emerald-200">
                    {shadow.states[signal.assessment.state]}
                  </p>
                  <p>
                    {copy.evidence} ·{" "}
                    {signal.assessment.score === null
                      ? "—"
                      : signal.assessment.score + " / 100"}
                  </p>
                  <p>
                    {copy.reference} · {format.number(signal.reference_price)}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {reason(signal.assessment, shadow)}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {evidence(signal.assessment, shadow).join(" · ")}
                  </p>
                  <p className="border-t pt-1 text-xs">
                    {copy.decisions[signal.eligibility]}
                  </p>
                </article>
              ))}
            </div>
          </section>
          <section className={box + " space-y-2"}>
            <h2 className="font-semibold">{copy.active}</h2>
            {result.active_bets.length ? (
              <Bets
                active
                bets={result.active_bets}
                copy={copy}
                shadow={shadow}
                format={format}
              />
            ) : (
              <p className="text-sm text-[var(--muted)]">
                {session?.status === "running" &&
                !session.settings_snapshot.allow_regular_signals
                  ? copy.emptyRunning
                  : copy.empty}
              </p>
            )}
          </section>
          <section className={box + " space-y-4"}>
            <h2 className="font-semibold">{copy.performance}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm">{copy.accuracy}</h3>
                <Metrics
                  values={[
                    [copy.bets, perf.bets],
                    [copy.wins, perf.wins],
                    [copy.losses, perf.losses],
                    [copy.voids, perf.voids],
                    [copy.winRate, format.percent(perf.win_rate)],
                    [copy.currentStreak, perf.current_losing_streak],
                    [copy.streak, perf.max_losing_streak],
                  ]}
                />
              </div>
              <div>
                <h3 className="mb-2 text-sm">{copy.economics}</h3>
                <Metrics
                  values={[
                    [copy.pnl, format.amount(perf.net_pnl)],
                    [copy.returns, format.percent(perf.return_percent)],
                    [
                      copy.drawdown,
                      session
                        ? format.percent(Number(session.max_drawdown) * 100)
                        : "—",
                    ],
                    [copy.profitFactor, format.number(perf.profit_factor)],
                    [copy.averageWin, format.amount(perf.average_win)],
                    [copy.averageLoss, format.amount(perf.average_loss)],
                  ]}
                />
              </div>
            </div>
            {result.equity.length > 0 && (
              <Equity points={result.equity} copy={copy} format={format} />
            )}
            <Breakdown
              kind="market"
              title={copy.marketBreakdown}
              rows={Object.entries(result.markets).map(([key, value]) => [
                key.replace(":", " · ") + "m",
                value,
              ])}
              copy={copy}
              format={format}
            />
            <p className="text-xs text-[var(--muted)]">
              {copy.historicalThirty}
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <Breakdown
                kind="score"
                title={copy.scoreBreakdown}
                rows={Object.entries(result.score_buckets).filter(
                  ([key, row]) => key !== "<85" || row.bets > 0,
                )}
                copy={copy}
                format={format}
              />
              <Breakdown
                kind="direction"
                title={copy.directionBreakdown}
                rows={Object.entries(result.directions).map(([key, value]) => [
                  shadow.states[key === "higher" ? "HIGHER" : "LOWER"],
                  value,
                ])}
                copy={copy}
                format={format}
              />
            </div>
          </section>
          <section className={box + " space-y-2"}>
            <h2 className="font-semibold">{copy.history}</h2>
            {result.history.length ? (
              <Bets
                bets={result.history}
                copy={copy}
                shadow={shadow}
                format={format}
              />
            ) : (
              <p className="text-sm text-[var(--muted)]">{copy.empty}</p>
            )}
            {before && (
              <button className={button} onClick={() => setBefore("")}>
                {copy.latest}
              </button>
            )}
            {result.next_cursor && (
              <button
                className={button}
                onClick={() => setBefore(result.next_cursor ?? "")}
              >
                {copy.older}
              </button>
            )}
            {result.decisions.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer">{copy.audit}</summary>
                <ul className="mt-2 space-y-1">
                  {result.decisions.map((decision) => (
                    <li key={decision.event_signal_id}>
                      {format.time(decision.decided_at)} · {decision.symbol} ·{" "}
                      {decision.horizon_minutes}m ·{" "}
                      {copy.decisions[decision.reason]}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
          <details className={box} open={message ? true : undefined}>
            <summary className="cursor-pointer font-semibold">
              {copy.settings}
            </summary>
            <label className="mt-3 block max-w-sm text-xs">
              {copy.operator}
              <input
                ref={token}
                type="password"
                autoComplete="off"
                className={input}
              />
            </label>
            {message && (
              <p className="mt-2 text-sm text-amber-200" role="alert">
                {message}
              </p>
            )}
            <SettingsForm
              key={session?.id ?? "initial"}
              defaults={session?.settings_snapshot ?? result.defaults}
              copy={copy}
              busy={busy}
              submit={(settings) => {
                if (!settings.markets.length || !settings.horizons.length) {
                  setMessage(copy.invalid);
                  return;
                }
                if (result.current_session_id && !window.confirm(copy.archive))
                  return;
                void mutate("POST", {
                  current_session_id: result.current_session_id,
                  settings,
                });
              }}
            />
          </details>
        </>
      )}
    </main>
  );
}
