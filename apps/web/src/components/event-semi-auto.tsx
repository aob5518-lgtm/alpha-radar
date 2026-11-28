"use client";

import type {
  RealBet,
  SemiIntent,
  SemiMetrics,
  SemiRiskSettings,
  SemiState,
} from "@alpha-radar/types/event-semi-auto";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import {
  executionTime,
  payoutBreakeven,
  validPayout,
} from "@/lib/event-semi-auto";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";

type T = (zh: string, en: string) => string;
type Send = (
  path: string,
  data: object,
  method?: "POST" | "PATCH",
) => Promise<boolean>;
const api = "/api/v1/event-semi-auto";
const panel = "rounded-md border bg-[var(--panel)] p-3 sm:p-4";
const input =
  "min-h-11 w-full rounded border bg-[var(--background)] px-2 py-1 text-sm";
const button =
  "min-h-11 rounded border px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40";
const primary = button + " border-emerald-500 text-emerald-300";
const danger = button + " border-red-500 text-red-300";

function statusLabel(status: string, t: T): string {
  const labels: Record<string, string> = {
    PENDING_REVIEW: t("待审核", "Pending review"),
    APPROVED_BY_USER: t("已审核", "Approved"),
    REJECTED_BY_USER: t("已跳过", "Skipped by user"),
    EXPIRED: t("已过期", "Expired"),
    EXECUTED_MANUALLY: t("已记录手动执行", "Manual execution recorded"),
    CANCELLED_BY_RISK: t("风控拦截", "Blocked by risk"),
    SETTLED: t("已结算", "Settled"),
    OPEN: t("等待结算确认", "Awaiting settlement confirmation"),
    WIN: t("赢", "Win"),
    LOSS: t("亏", "Loss"),
    TIE: t("平局", "Tie"),
    CANCELLED: t("已取消", "Cancelled"),
    MANUAL_CONFIRMATION: t("人工确认", "Operator-reported"),
    BINANCE_EVENT_VERIFIED: t("币安合约已核验", "Verified Binance contract"),
    BINANCE_INDEX_PROXY: t("Binance Index 研究代理", "Binance Index proxy"),
    UNKNOWN: t("未确认", "Unconfirmed"),
  };
  return labels[status] ?? status;
}

function reasonLabel(reason: string, t: T): string {
  switch (reason) {
    case "payout_low":
      return t(
        "赔率低于策略最低要求，建议不要下注。",
        "Payout is below the configured minimum. Skip this entry.",
      );
    case "location":
      return t("位置不好", "Unfavorable price");
    case "discretion":
      return t("手动判断不做", "Discretionary skip");
    case "other":
      return t("其他", "Other");
    case "daily_loss_limit":
      return t("达到今日亏损上限", "Daily risk limit");
    case "cooldown":
      return t("冷却中", "Cooldown");
    case "existing_active_bet":
    case "max_active_bets":
      return t("已有活动仓位", "Active exposure limit");
    case "macro_event":
      return t("重大事件窗口", "Major macro event window");
    case "signal_expired":
      return t("信号已过期", "Signal expired");
    case "stale_data":
      return t("价格数据未满足时效要求", "Fresh reference price unavailable");
    case "signal_not_strong":
      return t("需要 STRONG 信号", "STRONG signal required");
    case "score_below_threshold":
      return t("证据分不足", "Score below minimum");
    case "market_disabled":
    case "horizon_disabled":
      return t("该合约或期限已关闭", "Market or horizon disabled");
    case "stake_limit":
      return t("金额超过单笔上限", "Stake exceeds the per-bet cap");
    case "settings_changed":
      return t("风控设置已更新", "Risk settings changed");
    case "price_drift":
      return t(
        "价格已明显偏离信号触发位置，请重新核对。",
        "Price has moved away from the signal reference. Review the drift.",
      );
    case "disabled":
      return t("半自动已关闭", "Semi-Auto is disabled");
    case "operator_required":
      return t("请检查操作者令牌。", "Check your operator token.");
    case "stale_settings":
      return t(
        "设置已更新，请重试。",
        "Settings have changed. Review and retry.",
      );
    case "awaiting_expiry":
      return t(
        "合约到期后可以记录结算。",
        "Settlement can be recorded after expiry.",
      );
    case "invalid_execution_times":
      return t(
        "检查实际开仓、到期时间和期限。",
        "Check the actual open time, expiry and horizon.",
      );
    case "invalid_request":
    case "validation_error":
      return t("请检查输入。", "Check the entered values.");
    case "identity_mismatch":
      return t(
        "方向或期限与信号不一致。",
        "Direction or horizon does not match the intent.",
      );
    case "acknowledgement_required":
      return t("请勾选风险确认。", "Acknowledge the risk first.");
    case "duplicate_order_reference":
      return t(
        "这个订单编号已记录。",
        "This order reference is already recorded.",
      );
    default:
      return t("当前操作不可用。", "This action is currently unavailable.");
  }
}

function formatters(locale: Locale) {
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 8 });
  const currency = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const time = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
  });
  return {
    value: (n: string | number | null) =>
      n === null ? "—" : value.format(Number(n)),
    cash: (n: string | null) =>
      n === null ? "—" : currency.format(Number(n)) + " USDT",
    rate: (n: string | number | null) =>
      n === null ? "—" : currency.format(Number(n) * 100) + "%",
    payout: (n: string | null) =>
      n === null ? "—" : currency.format(Number(n)) + "×",
    time: (n: string | null) => (n ? time.format(new Date(n)) : "—"),
  };
}
type Format = ReturnType<typeof formatters>;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}

function IntentReview({
  intent,
  disabled,
  send,
  t,
  fmt,
  close,
}: {
  intent: SemiIntent;
  disabled: boolean;
  send: Send;
  t: T;
  fmt: Format;
  close: () => void;
}) {
  const [payout, setPayout] = useState(intent.approved_payout ?? "");
  const [acknowledged, setAcknowledged] = useState(false);
  const [driftAcknowledged, setDriftAcknowledged] = useState(false);
  const [rejection, setRejection] = useState("");
  const [recording, setRecording] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const url = `/intents/${intent.id}`;
  const canApprove =
    acknowledged &&
    !disabled &&
    !intent.risk_reason &&
    validPayout(payout, intent.minimum_payout);
  const approved = intent.status === "APPROVED_BY_USER";
  function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim();
    const openAt = executionTime(field("open_at"));
    const expires = executionTime(field("expires"));
    if (!openAt || !expires || !canApprove) return;
    void send(url + "/confirm", {
      acknowledged: true,
      drift_acknowledged: driftAcknowledged,
      actual_premium: field("premium"),
      actual_payout: payout,
      actual_open_at: openAt,
      actual_expiry_at: expires,
      actual_open_price: field("price"),
      direction: field("direction"),
      horizon_minutes: Number(field("horizon")),
      order_reference: field("reference") || null,
      notes: field("notes") || null,
    }).then((ok) => {
      if (ok) close();
    });
  }
  return (
    <article className={panel + " space-y-3"} data-intent-review={intent.id}>
      <div className="flex justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {t("准备下注", "Prepare entry")} · {intent.symbol}{" "}
          {intent.horizon_minutes}m
        </h2>
        <button type="button" onClick={close} className={button}>
          {t("关闭", "Close")}
        </button>
      </div>
      <p className="text-xl font-semibold">
        {intent.direction.toUpperCase()} · {fmt.cash(intent.suggested_stake)} ·
        ≥{fmt.payout(intent.minimum_payout)}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <div>
          <dt>{t("证据分", "Evidence score")}</dt>
          <dd>{intent.signal_score}</dd>
        </div>
        <div>
          <dt>{t("信号时间", "Signal time")}</dt>
          <dd>{fmt.time(intent.generated_at)}</dd>
        </div>
        <div>
          <dt>{t("审核截止", "Intent expires")}</dt>
          <dd>{fmt.time(intent.expires_at)}</dd>
        </div>
        <div>
          <dt>{t("信号参考价", "Signal reference price")}</dt>
          <dd>{fmt.value(intent.signal_reference_price)}</dd>
        </div>
        <div>
          <dt>{t("风控", "Risk")}</dt>
          <dd>
            {intent.risk_reason
              ? reasonLabel(intent.risk_reason, t)
              : t("通过", "Passed")}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-amber-300">
        {t(
          "Radar 信号参考价 ≠ Binance 实际开仓价。",
          "Radar signal reference and Binance execution price are distinct.",
        )}
      </p>
      {intent.drift_warning && (
        <p className="text-sm text-amber-300">
          {reasonLabel("price_drift", t)} ({fmt.value(intent.drift_atr)} ATR)
        </p>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-0.5 size-5 shrink-0"
        />
        {t(
          "我会在 Binance App 核对方向、期限、金额和真实赔率，并亲自确认最终订单。",
          "I will check direction, horizon, stake and payout in the Binance App and confirm any order myself.",
        )}
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={!acknowledged || disabled || Boolean(intent.risk_reason)}
          onClick={() =>
            void send(url + "/decision", {
              action: "handoff",
              acknowledged,
            }).then(setHandoff)
          }
        >
          {t("准备打开 Binance", "Prepare to open Binance")}
        </button>
        {handoff && acknowledged && !intent.risk_reason && !disabled && (
          <a
            className={button}
            href="https://www.binance.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("打开 Binance", "Open Binance")}
          </a>
        )}
      </div>
      <Field label={t("实际赔率 / Payout", "Actual payout (total multiplier)")}>
        <input
          className={input}
          type="number"
          inputMode="decimal"
          min="1.000001"
          max="100"
          step="0.000001"
          value={payout}
          onChange={(event) => setPayout(event.target.value)}
        />
      </Field>
      <p className="text-sm">
        {t("盈亏平衡命中率", "Break-even hit rate")}{" "}
        {fmt.rate(payoutBreakeven(payout))}
      </p>
      {payout && !validPayout(payout, intent.minimum_payout) && (
        <p className="text-sm text-red-300" role="alert">
          {reasonLabel("payout_low", t)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primary}
          disabled={!canApprove}
          onClick={() =>
            void send(url + "/decision", {
              action: "approve",
              acknowledged,
              payout,
            })
          }
        >
          {approved
            ? t("更新已核对赔率", "Update reviewed payout")
            : t("确认已核对赔率", "Approve reviewed payout")}
        </button>
        <button
          type="button"
          className={button}
          disabled={!approved || !canApprove}
          onClick={() => setRecording(true)}
        >
          {t("我已下注", "I placed the order")}
        </button>
      </div>
      {approved && recording && (
        <form className="space-y-3 rounded border p-3" onSubmit={record}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t("实际金额（USDT）", "Actual premium (USDT)")}>
              <input
                className={input}
                name="premium"
                type="number"
                min=".01"
                step=".01"
                max="10000"
                inputMode="decimal"
                required
                defaultValue={Number(intent.suggested_stake)}
              />
            </Field>
            <Field label={t("实际开仓价", "Actual open price")}>
              <input
                className={input}
                name="price"
                type="number"
                min=".000000000001"
                step="any"
                inputMode="decimal"
                required
              />
            </Field>
            <Field
              label={t(
                "实际开仓时间（本地时间）",
                "Actual open time (local time)",
              )}
            >
              <input
                className={input}
                name="open_at"
                type="datetime-local"
                step="1"
                required
              />
            </Field>
            <Field
              label={t(
                "实际到期时间（本地时间）",
                "Actual expiry (local time)",
              )}
            >
              <input
                className={input}
                name="expires"
                type="datetime-local"
                step="1"
                required
              />
            </Field>
            <Field label={t("确认方向", "Confirm direction")}>
              <select
                className={input}
                name="direction"
                defaultValue={intent.direction}
              >
                <option value="higher">HIGHER</option>
                <option value="lower">LOWER</option>
              </select>
            </Field>
            <Field label={t("确认期限", "Confirm horizon")}>
              <select
                className={input}
                name="horizon"
                defaultValue={intent.horizon_minutes}
              >
                <option value="10">10m</option>
                <option value="30">30m</option>
              </select>
            </Field>
            <Field label={t("订单编号（选填）", "Order reference (optional)")}>
              <input className={input} name="reference" maxLength={128} />
            </Field>
            <Field label={t("备注（选填）", "Notes (optional)")}>
              <input className={input} name="notes" maxLength={500} />
            </Field>
          </div>
          {intent.drift_warning && (
            <label className="flex items-center gap-2 text-sm">
              <input
                className="size-5"
                type="checkbox"
                checked={driftAcknowledged}
                onChange={(event) => setDriftAcknowledged(event.target.checked)}
              />
              {t(
                "已核对价格偏离与实际开仓价",
                "I reviewed the price drift and actual open price",
              )}
            </label>
          )}
          <button
            className={primary}
            disabled={
              !canApprove || (intent.drift_warning && !driftAcknowledged)
            }
          >
            {t("确认已下注", "Record manual execution")}
          </button>
        </form>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("跳过理由（选填）", "Skip reason (optional)")}>
          <select
            className={input}
            value={rejection}
            onChange={(event) => setRejection(event.target.value)}
          >
            <option value="">—</option>
            <option value="payout_low">
              {t("赔率太低", "Payout too low")}
            </option>
            {["location", "discretion", "other"].map((reason) => (
              <option value={reason} key={reason}>
                {reasonLabel(reason, t)}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className={button}
          disabled={disabled}
          onClick={() =>
            void send(url + "/decision", {
              action: "reject",
              reason: rejection || null,
            }).then((ok) => {
              if (ok) close();
            })
          }
        >
          {t("跳过这次", "Skip this intent")}
        </button>
      </div>
    </article>
  );
}

function BetDetails({ bet, t, fmt }: { bet: RealBet; t: T; fmt: Format }) {
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
      <div>
        <dt>{t("金额 / 赔率", "Premium / payout")}</dt>
        <dd>
          {fmt.cash(bet.actual_premium)} · {fmt.payout(bet.actual_payout)}
        </dd>
      </div>
      <div>
        <dt>{t("信号参考价", "Signal reference price")}</dt>
        <dd>{fmt.value(bet.signal_reference_price)}</dd>
      </div>
      <div>
        <dt>{t("实际开仓价", "Actual open price")}</dt>
        <dd>{fmt.value(bet.actual_open_price)}</dd>
      </div>
      <div>
        <dt>{t("实际开仓时间", "Actual open time")}</dt>
        <dd>{fmt.time(bet.actual_open_at)}</dd>
      </div>
      <div>
        <dt>{t("实际到期时间", "Actual expiry")}</dt>
        <dd>{fmt.time(bet.expiry_at)}</dd>
      </div>
      <div>
        <dt>{t("结算来源", "Settlement source")}</dt>
        <dd>{statusLabel(bet.settlement_source, t)}</dd>
      </div>
      {bet.settled_at && (
        <div>
          <dt>{t("结算时间", "Settlement recorded at")}</dt>
          <dd>{fmt.time(bet.settled_at)}</dd>
        </div>
      )}
      {bet.settlement_price && (
        <div>
          <dt>{t("实际结算价", "Actual settlement price")}</dt>
          <dd>{fmt.value(bet.settlement_price)}</dd>
        </div>
      )}
      {bet.net_pnl !== null && (
        <div>
          <dt>{t("净盈亏", "Net P&L")}</dt>
          <dd>{fmt.cash(bet.net_pnl)}</dd>
        </div>
      )}
      {bet.order_reference && (
        <div className="break-all">
          <dt>{t("订单编号", "Order reference")}</dt>
          <dd>{bet.order_reference}</dd>
        </div>
      )}
      {bet.notes && (
        <div className="break-all">
          <dt>{t("备注", "Notes")}</dt>
          <dd>{bet.notes}</dd>
        </div>
      )}
    </dl>
  );
}

function SettleForm({
  bet,
  busy,
  send,
  t,
}: {
  bet: RealBet;
  busy: boolean;
  send: Send;
  t: T;
}) {
  const [result, setResult] = useState("WIN");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void send(`/bets/${bet.id}/settle`, {
      result,
      settlement_price: form.get("price") || null,
      actual_return: form.get("actual_return") || null,
    });
  }
  return (
    <details className="mt-2">
      <summary className="cursor-pointer py-2 text-sm text-emerald-300">
        {t("记录人工结算", "Record manual settlement")}
      </summary>
      <form onSubmit={submit} className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label={t("实际结果", "Reported result")}>
            <select
              className={input}
              value={result}
              onChange={(event) => setResult(event.target.value)}
            >
              {["WIN", "LOSS", "TIE", "CANCELLED"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </Field>
          <Field
            label={t(
              "实际结算价（选填）",
              "Actual settlement price (optional)",
            )}
          >
            <input
              className={input}
              name="price"
              type="number"
              min=".000000000001"
              step="any"
            />
          </Field>
          {(result === "TIE" || result === "CANCELLED") && (
            <Field label={t("实际返还金额", "Actual gross return")}>
              <input
                className={input}
                name="actual_return"
                type="number"
                min="0"
                max="1000000"
                step=".01"
                required
              />
            </Field>
          )}
        </div>
        <button className={primary} disabled={busy}>
          {t("保存结算", "Save settlement")}
        </button>
      </form>
    </details>
  );
}

function Metrics({ data, t, fmt }: { data: SemiMetrics; t: T; fmt: Format }) {
  const fields: [string, string | number][] = [
    [t("实际记录", "Real bets"), data.bets],
    [t("赢 / 亏", "Wins / losses"), `${data.wins} / ${data.losses}`],
    [t("命中率", "Win rate"), fmt.rate(data.win_rate)],
    [t("累计盈亏", "Net P&L"), fmt.cash(data.net_pnl)],
    [t("保费回报率", "Return on premium"), fmt.rate(data.return_on_premium)],
    [t("最大金额回撤", "Maximum cash drawdown"), fmt.cash(data.max_drawdown)],
    [t("最长连亏", "Max losing streak"), data.max_losing_streak],
    [t("平均赔率", "Average payout"), fmt.payout(data.average_payout)],
    [t("平均金额", "Average premium"), fmt.cash(data.average_premium)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {fields.map(([label, value]) => (
        <div className="min-w-0 rounded border p-2" key={label}>
          <dt className="text-xs text-[var(--muted)]">{label}</dt>
          <dd className="font-mono text-sm break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

type NumericKey =
  | "minimum_score"
  | "max_consecutive_losses"
  | "cooldown_minutes"
  | "max_active_real_bets";
type DecimalKey = Exclude<
  keyof SemiRiskSettings,
  NumericKey | "markets" | "horizons"
>;

function Settings({
  state,
  busy,
  t,
  send,
}: {
  state: SemiState;
  busy: boolean;
  t: T;
  send: Send;
}) {
  const fields: [NumericKey | DecimalKey, string, string][] = [
    ["fixed_stake", t("固定金额（USDT）", "Fixed stake (USDT)"), ".01"],
    ["max_stake", t("单笔上限（USDT）", "Per-bet cap (USDT)"), ".01"],
    ["max_daily_loss", t("日亏损上限（USDT）", "Daily loss cap (USDT)"), ".01"],
    [
      "max_consecutive_losses",
      t("连续亏损上限", "Consecutive loss limit"),
      "1",
    ],
    ["cooldown_minutes", t("冷却分钟数", "Cooldown minutes"), "1"],
    ["max_active_real_bets", t("活动仓位上限", "Active exposure limit"), "1"],
    ["minimum_score", t("最低证据分", "Minimum evidence score"), "1"],
    ["minimum_payout_10m", t("10m 最低赔率", "10m minimum payout"), ".000001"],
    ["minimum_payout_30m", t("30m 最低赔率", "30m minimum payout"), ".000001"],
    [
      "max_drift_atr",
      t("价格偏离阈值（ATR）", "Price drift threshold (ATR)"),
      ".001",
    ],
  ];
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const updated: SemiRiskSettings = {
      ...state.settings,
      markets: state.signals
        .map((item) => item.symbol)
        .filter(
          (symbol, idx, all) => all.indexOf(symbol) === idx && form.has(symbol),
        ),
      horizons: ([10, 30] as const).filter((term) => form.has(String(term))),
    };
    for (const [key] of fields) {
      const value = String(form.get(key) ?? "");
      if (
        key === "minimum_score" ||
        key === "max_consecutive_losses" ||
        key === "cooldown_minutes" ||
        key === "max_active_real_bets"
      ) {
        updated[key] = Number(value);
      } else {
        updated[key] = value;
      }
    }
    void send(
      "/settings",
      { revision: state.revision, action: "settings", settings: updated },
      "PATCH",
    );
  }
  return (
    <details className={panel}>
      <summary className="cursor-pointer">
        {t("实盘风控设置", "Real risk settings")}
      </summary>
      <form
        className="mt-3 space-y-3"
        key={state.revision ?? "defaults"}
        onSubmit={save}
      >
        <div className="flex flex-wrap gap-4">
          {(["BTCUSDT", "ETHUSDT"] as const).map((symbol) => (
            <label key={symbol} className="flex items-center gap-1">
              <input
                type="checkbox"
                name={symbol}
                defaultChecked={state.settings.markets.includes(symbol)}
              />
              {symbol}
            </label>
          ))}
          {([10, 30] as const).map((horizon) => (
            <label key={horizon} className="flex items-center gap-1">
              <input
                type="checkbox"
                name={String(horizon)}
                defaultChecked={state.settings.horizons.includes(horizon)}
              />
              {horizon}m
            </label>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([key, label, step]) => (
            <Field label={label} key={key}>
              <input
                className={input}
                required
                type="number"
                name={key}
                step={step}
                defaultValue={Number(state.settings[key])}
              />
            </Field>
          ))}
        </div>
        <button className={primary} disabled={busy}>
          {t("保存风控设置", "Save risk settings")}
        </button>
      </form>
    </details>
  );
}

export function EventSemiAuto({
  locale,
  shadow,
}: {
  locale: Locale;
  shadow: Messages["chart"]["eventContracts"]["shadow"];
}) {
  const [draft, setDraft] = useState("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<SemiState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activation, setActivation] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [intentPage, setIntentPage] = useState<SemiIntent[] | null>(null);
  const [betPage, setBetPage] = useState<RealBet[] | null>(null);
  const [intentCursor, setIntentCursor] = useState<string | null>(null);
  const [betCursor, setBetCursor] = useState<string | null>(null);
  const t: T = (zh, en) => (locale === "zh-CN" ? zh : en);
  const fmt = formatters(locale);

  useEffect(() => {
    if (!token || busy) return;
    const abort = new AbortController();
    async function getState() {
      try {
        setState(
          (await request(token, "", { signal: abort.signal })) as SemiState,
        );
      } catch (failure) {
        if (abort.signal.aborted) return;
        const code =
          failure instanceof Error ? failure.message : "semi_auto_unavailable";
        if (code === "operator_required") setState(null);
        setError(code);
      }
    }
    void getState();
    const timer = setInterval(() => void getState(), 4000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [token, busy]);

  const send: Send = async (path, data, method = "POST") => {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await request(token, path, { method, body: JSON.stringify(data) });
      setState((await request(token, "")) as SemiState);
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "semi_auto_unavailable",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  function control(action: "enable" | "disable" | "kill") {
    if (state)
      void send(
        "/settings",
        { action, revision: state.revision, acknowledged: activation },
        "PATCH",
      );
  }
  async function older(kind: "intent" | "bet") {
    if (!state || busy) return;
    const before =
      kind === "intent"
        ? intentPage === null
          ? state.next_intent_before
          : intentCursor
        : betPage === null
          ? state.next_bet_before
          : betCursor;
    if (!before) return;
    setBusy(true);
    setError("");
    try {
      const page = (await request(
        token,
        `?${kind}_before=${encodeURIComponent(before)}`,
      )) as SemiState;
      if (kind === "intent") {
        setIntentPage([...(intentPage ?? state.intents), ...page.intents]);
        setIntentCursor(page.next_intent_before);
      } else {
        setBetPage([...(betPage ?? state.history), ...page.history]);
        setBetCursor(page.next_bet_before);
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "semi_auto_unavailable",
      );
    } finally {
      setBusy(false);
    }
  }
  function lockPanel() {
    setToken("");
    setDraft("");
    setState(null);
    setError("");
    setReviewId(null);
    setIntentPage(null);
    setBetPage(null);
    setActivation(false);
  }
  const selected = state?.signals.find(
    (item) => item.intent?.id === reviewId,
  )?.intent;
  const decisions: [string, string][] = [
    ["eligible", t("符合条件", "Eligible")],
    ["executed", t("已执行", "Executed")],
    ["rejected", t("已跳过", "Skipped")],
    ["expired", t("已过期", "Expired")],
    ["blocked", t("被拦截", "Blocked")],
  ];
  return (
    <section className="space-y-4" data-event-mode="semi-auto">
      <header className={panel + " space-y-2"}>
        <h1 className="text-xl font-semibold">
          {t("事件合约 · 半自动", "Event Contracts · Semi-Auto")}
        </h1>
        <p className="text-sm text-amber-300">
          {t(
            "最终订单由你本人在 Binance App 提交并确认。Alpha Radar 只记录你的手动操作。",
            "Submit and confirm any actual order yourself in the Binance App. Alpha Radar records your manual activity.",
          )}
        </p>
        {state && (
          <p
            data-semi-enabled={state.enabled}
            className={
              state.enabled ? "text-emerald-300" : "text-[var(--muted)]"
            }
          >
            {state.enabled
              ? t("半自动实盘已启用", "Live Semi-Auto enabled")
              : state.killed
                ? t("停止开关已启动", "Kill switch active")
                : t("半自动实盘已关闭", "Live Semi-Auto disabled")}
          </p>
        )}
      </header>
      {error && (
        <p
          className="rounded border border-red-500 p-2 text-sm text-red-300"
          role="alert"
        >
          {reasonLabel(error, t)}
        </p>
      )}
      {!state ? (
        <form
          className={panel + " flex flex-wrap items-end gap-2"}
          onSubmit={(event) => {
            event.preventDefault();
            setError("");
            setToken(draft.trim());
            setDraft("");
          }}
        >
          <div className="grow">
            <Field label={t("操作者令牌", "Operator token")}>
              <input
                className={input}
                type="password"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                required
                autoComplete="off"
              />
            </Field>
          </div>
          <button className={primary}>
            {t("打开私有实盘面板", "Unlock private live panel")}
          </button>
        </form>
      ) : (
        <>
          <section className={panel + " space-y-2"}>
            <div className="flex flex-wrap gap-2">
              {!state.enabled && (
                <button
                  type="button"
                  className={primary}
                  disabled={busy || (!state.acknowledged && !activation)}
                  onClick={() => control("enable")}
                >
                  {t("启用半自动实盘", "Enable live Semi-Auto")}
                </button>
              )}
              {state.enabled && (
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => control("disable")}
                >
                  {t("暂停", "Pause")}
                </button>
              )}
              <button
                type="button"
                className={danger}
                disabled={busy || state.killed}
                onClick={() => control("kill")}
              >
                {t("停止半自动实盘", "Stop live Semi-Auto")}
              </button>
              <button
                type="button"
                className={button}
                onClick={lockPanel}
                disabled={busy}
              >
                {t("锁定面板", "Lock panel")}
              </button>
            </div>
            {!state.acknowledged && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-5 shrink-0"
                  checked={activation}
                  onChange={(event) => setActivation(event.target.checked)}
                />
                {t(
                  "这是实盘辅助工具。我负责在 Binance App 核对方向、期限、金额和赔率，并确认最终订单。",
                  "This tool supports live review. I am responsible for checking direction, horizon, amount and payout and confirming the final Binance App order.",
                )}
              </label>
            )}
            <p className="text-sm text-[var(--muted)]">
              {t("今日已记录盈亏（UTC）", "Reported daily P&L (UTC)")}{" "}
              {fmt.cash(state.daily_pnl)}
              {state.cooldown_until &&
                new Date(state.cooldown_until).getTime() > Date.now() &&
                ` · ${t("冷却至", "Cooldown until")} ${fmt.time(state.cooldown_until)}`}
            </p>
          </section>
          <section className="space-y-2">
            <h2 className="font-semibold">
              {t("当前信号", "Current signals")}
            </h2>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {state.signals.map((card) => {
                const assessment = card.assessment;
                const eligible =
                  state.enabled && card.intent && !card.intent.risk_reason;
                const reason = Object.entries(shadow.reasons).find(
                  ([key]) => key === assessment?.reason,
                )?.[1];
                return (
                  <article
                    className={panel + " space-y-1"}
                    data-semi-signal={card.symbol + ":" + card.horizon_minutes}
                    key={card.symbol + card.horizon_minutes}
                  >
                    <h3 className="font-semibold">
                      {card.symbol} · {card.horizon_minutes}m
                    </h3>
                    <p className="text-sm">
                      {assessment?.state.replaceAll("_", " ") ?? "—"} ·{" "}
                      {assessment?.score ?? "—"}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {reason ?? shadow.reasons.warming_up}
                    </p>
                    <p className="text-sm">
                      {fmt.cash(card.suggested_stake)} · ≥
                      {fmt.payout(card.minimum_payout)}
                    </p>
                    <p className="text-xs">
                      {!state.enabled
                        ? reasonLabel("disabled", t)
                        : eligible
                          ? t("风控通过", "Risk checks passed")
                          : card.intent?.risk_reason
                            ? reasonLabel(card.intent.risk_reason, t)
                            : t(
                                "等待可审核信号",
                                "Waiting for an actionable signal",
                              )}
                    </p>
                    {eligible && card.intent && (
                      <button
                        type="button"
                        className={primary}
                        onClick={() => setReviewId(card.intent?.id ?? null)}
                      >
                        {t("准备下注", "Prepare entry")}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
          {selected ? (
            <IntentReview
              key={selected.id}
              intent={selected}
              disabled={busy || !state.enabled}
              send={send}
              t={t}
              fmt={fmt}
              close={() => setReviewId(null)}
            />
          ) : (
            reviewId && (
              <p role="status">
                {t(
                  "该信号已过期或不再可审核。",
                  "The selected intent is no longer actionable.",
                )}
              </p>
            )
          )}
          <section className={panel + " space-y-2"}>
            <h2 className="font-semibold">
              {t("活动实盘记录", "Active real bets")}
            </h2>
            {state.active.length === 0 && (
              <p className="text-sm text-[var(--muted)]">
                {t("暂无活动记录", "No active records")}
              </p>
            )}
            {state.active.map((bet) => (
              <article key={bet.id} className="space-y-2 rounded border p-2">
                <h3>
                  {bet.symbol} · {bet.horizon_minutes}m ·{" "}
                  {bet.direction.toUpperCase()}
                </h3>
                <p className="text-sm">{statusLabel(bet.status, t)}</p>
                <BetDetails bet={bet} t={t} fmt={fmt} />
                <SettleForm bet={bet} busy={busy} send={send} t={t} />
              </article>
            ))}
          </section>
          <section className={panel + " space-y-3"}>
            <h2 className="font-semibold">
              {t("实盘表现 · 手动记录", "Real performance · Operator records")}
            </h2>
            <Metrics data={state.real} t={t} fmt={fmt} />
            <h3 className="font-semibold">
              {t("模拟与实盘", "Paper and real")}
            </h3>
            {!state.comparison_start ? (
              <p className="text-sm text-[var(--muted)]">
                {t(
                  "不同样本期不可直接比较。",
                  "Comparison requires overlapping sample periods.",
                )}
              </p>
            ) : (
              <p className="text-xs text-[var(--muted)]">
                {fmt.time(state.comparison_start)} –{" "}
                {fmt.time(state.comparison_end)}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {state.comparison.map((row) => (
                <article
                  className="min-w-0 rounded border p-2 text-sm"
                  key={row.symbol + row.horizon_minutes}
                >
                  <h4>
                    {row.symbol} · {row.horizon_minutes}m
                  </h4>
                  {(
                    [
                      ["paper", t("模拟", "Paper")],
                      ["real", t("实盘", "Real")],
                    ] as const
                  ).map(([key, label]) => (
                    <p className="break-words" key={key}>
                      {label} · {t("笔数", "Bets")} {row[key].bets} ·{" "}
                      {t("命中率", "Win rate")} {fmt.rate(row[key].win_rate)} ·{" "}
                      {fmt.cash(row[key].net_pnl)} ·{" "}
                      {fmt.payout(row[key].average_payout)}
                    </p>
                  ))}
                </article>
              ))}
            </div>
          </section>
          <details className={panel}>
            <summary className="cursor-pointer">
              {t("意图与实盘历史", "Intent and real bet history")}
            </summary>
            <dl className="mt-3 flex flex-wrap gap-3 text-sm">
              {decisions.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{state.decisions[key] ?? 0}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 space-y-2">
              {(intentPage ?? state.intents).map((item) => (
                <article key={item.id} className="rounded border p-2 text-sm">
                  <p>
                    {fmt.time(item.created_at)} · {item.symbol} ·{" "}
                    {item.horizon_minutes}m ·{" "}
                    {item.signal_state.replaceAll("_", " ")} ·{" "}
                    {item.signal_score}
                  </p>
                  <p>
                    {fmt.cash(item.suggested_stake)} · ≥
                    {fmt.payout(item.minimum_payout)} ·{" "}
                    {statusLabel(item.status, t)}
                  </p>
                  {(item.risk_reason || item.reject_reason) && (
                    <p>
                      {reasonLabel(
                        item.risk_reason ?? item.reject_reason ?? "",
                        t,
                      )}
                    </p>
                  )}
                </article>
              ))}
            </div>
            {(intentPage === null
              ? state.next_intent_before
              : intentCursor) && (
              <button
                type="button"
                className={button}
                onClick={() => void older("intent")}
                disabled={busy}
              >
                {t("更多意图", "Older intents")}
              </button>
            )}
            <div className="mt-3 space-y-2">
              {(betPage ?? state.history).map((bet) => (
                <details className="rounded border p-2" key={bet.id}>
                  <summary className="cursor-pointer text-sm">
                    {bet.symbol} · {bet.horizon_minutes}m ·{" "}
                    {statusLabel(bet.status, t)} · {fmt.cash(bet.net_pnl)}
                  </summary>
                  <BetDetails bet={bet} t={t} fmt={fmt} />
                </details>
              ))}
            </div>
            {(betPage === null ? state.next_bet_before : betCursor) && (
              <button
                type="button"
                className={button}
                onClick={() => void older("bet")}
                disabled={busy}
              >
                {t("更多实盘记录", "Older real records")}
              </button>
            )}
          </details>
          <Settings state={state} busy={busy} t={t} send={send} />
        </>
      )}
    </section>
  );
}

async function request(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(api + path, {
    ...options,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(body?.error?.code ?? "semi_auto_unavailable");
  }
  return response.status === 204 ? null : await response.json();
}
