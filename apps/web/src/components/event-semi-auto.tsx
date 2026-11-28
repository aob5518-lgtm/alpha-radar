"use client";

import type {
  RealBet,
  SemiIntent,
  SemiMetrics,
  SemiRiskSettings,
  SemiState,
} from "@alpha-radar/types/event-semi-auto";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { executionTime, validPayout } from "@/lib/event-semi-auto";
import {
  actionable,
  binanceAppEntry,
  copyInstruction,
  returnable,
} from "@/lib/event-mobile-handoff";
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
    RECONCILIATION_REQUIRED: t("待核对订单", "Reconciliation required"),
    FAILED: t("执行失败", "Execution failed"),
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
    case "BLOCKED_PAYOUT":
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
    case "live_execution_disabled":
      return t(
        "服务器已暂停发起新订单。",
        "The server has paused new execution starts.",
      );
    case "execution_outcome_unknown":
    case "reconciliation_pending":
      return t(
        "请先核对交易所订单记录，避免重复下注。",
        "Check your exchange order history before placing another order.",
      );
    case "execution_evidence_required":
      return t(
        "请核实订单是否存在。若已成交，请填写订单编号。",
        "Verify whether the order exists. Enter its reference if it was placed.",
      );
    case "adapter_unavailable":
      return t(
        "当前执行方式不可用。",
        "The selected execution adapter is unavailable.",
      );
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
    case "handoff_required":
      return t("找不到有效的交接记录。", "No valid handoff was found.");
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
  start,
  t,
  fmt,
  close,
  now,
}: {
  intent: SemiIntent;
  disabled: boolean;
  send: Send;
  start: (
    intent: SemiIntent,
    driftAcknowledged: boolean,
    payout: string,
  ) => Promise<void>;
  t: T;
  fmt: Format;
  close: () => void;
  now: number;
}) {
  const [sheet, setSheet] = useState(false);
  const [driftAcknowledged, setDriftAcknowledged] = useState(false);
  const [recording, setRecording] = useState(false);
  const [payout, setPayout] = useState("");
  const [direction, setDirection] = useState(intent.direction);
  const [horizon, setHorizon] = useState(intent.horizon_minutes);
  const [mismatchAcknowledged, setMismatchAcknowledged] = useState(false);
  const url = "/intents/" + intent.id;
  const recovery = Boolean(
    intent.handoff_started_at || intent.execution_started_at,
  );
  const uncertain = intent.execution_status === "RECONCILIATION_REQUIRED";
  const manual = intent.execution_adapter === "MANUAL";
  const expired =
    Date.parse(intent.execution_deadline ?? intent.expires_at) <= now;
  const [verifiedNoOrder, setVerifiedNoOrder] = useState(false);
  const mismatch =
    direction !== intent.direction || horizon !== intent.horizon_minutes;

  function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim();
    const openAt = executionTime(field("open_at"));
    const expires = executionTime(field("expires"));
    if (!openAt || !expires || (mismatch && !mismatchAcknowledged)) return;
    void send(url + "/confirm", {
      acknowledged: true,
      record_handoff: true,
      mismatch_acknowledged: mismatchAcknowledged,
      actual_premium: field("premium"),
      actual_payout: payout,
      actual_open_at: openAt,
      actual_expiry_at: expires,
      actual_open_price: field("price"),
      direction,
      horizon_minutes: horizon,
      order_reference: field("reference") || null,
    }).then((ok) => {
      if (ok) close();
    });
  }

  return (
    <article
      className={panel + " min-w-0 space-y-3"}
      data-intent-review={intent.id}
    >
      <h2 className="font-semibold">
        {recovery
          ? t("刚才准备的订单", "Previously prepared order")
          : t("当前可审核信号", "Actionable signal")}
      </h2>
      <p className="text-2xl font-semibold">
        {intent.symbol.slice(0, -4)} · {intent.horizon_minutes}m ·{" "}
        {intent.direction.toUpperCase()}
      </p>
      <p className="text-lg">
        {fmt.cash(intent.suggested_stake)} · ≥
        {fmt.payout(intent.minimum_payout)}
      </p>
      <p className="text-sm">
        {intent.signal_state.replaceAll("_", " ")} · {t("证据分", "Score")}{" "}
        {intent.signal_score} · {t("信号参考价", "Signal reference")}{" "}
        {fmt.value(intent.signal_reference_price)}
      </p>
      <p className="text-sm text-amber-300" data-handoff-expired={expired}>
        {expired
          ? t("该信号已过期", "This signal has expired")
          : t("有效时间", "Time remaining") +
            " " +
            Math.ceil((Date.parse(intent.expires_at) - now) / 1000) +
            "s"}
      </p>
      {recovery ? (
        <>
          {uncertain && (
            <p role="status">{reasonLabel("execution_outcome_unknown", t)}</p>
          )}
          <p>
            {t(
              "你是否已经在 Binance 完成下注？",
              "Did you place the order in Binance?",
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={primary}
              disabled={disabled}
              onClick={() => setRecording(true)}
            >
              {t("已下注", "I placed it")}
            </button>
            <button
              type="button"
              className={button}
              disabled={
                disabled ||
                (Boolean(intent.execution_adapter) && !verifiedNoOrder)
              }
              onClick={() =>
                void send(url + "/decision", {
                  action: intent.execution_adapter
                    ? "reconcile_no_order"
                    : "reject",
                  acknowledged: verifiedNoOrder,
                }).then((ok) => {
                  if (ok) close();
                })
              }
            >
              {t("未下注", "I did not place it")}
            </button>
          </div>
          {intent.execution_adapter && (
            <Field
              label={t(
                "我已核对交易所订单记录，确认没有下单",
                "I checked the exchange order history and confirmed no order was placed",
              )}
            >
              <input
                type="checkbox"
                className="size-5"
                checked={verifiedNoOrder}
                onChange={(event) => setVerifiedNoOrder(event.target.checked)}
              />
            </Field>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              onClick={() => void copyInstruction(intent)}
            >
              {t("复制订单信息", "Copy order details")}
            </button>
          </div>
          <BinanceSteps t={t} />
        </>
      ) : (
        <>
          {sheet ? (
            <section
              className="space-y-3 rounded border p-3"
              aria-label={t("前往币安前确认", "Review before opening Binance")}
            >
              <BinanceSteps t={t} />
              <p className="text-sm">
                {t(
                  "请在币安核对实际赔率和开仓价。赔率低于门槛时请跳过。",
                  "Check payout and open price in Binance. Skip if payout is below the minimum.",
                )}
              </p>
              <Field
                label={t(
                  "币安当前显示的赔率",
                  "Payout currently shown in Binance",
                )}
              >
                <input
                  className={input}
                  inputMode="decimal"
                  value={payout}
                  onChange={(event) => setPayout(event.target.value)}
                />
              </Field>
              {intent.drift_warning && (
                <Field label={reasonLabel("price_drift", t)}>
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={driftAcknowledged}
                    onChange={(event) =>
                      setDriftAcknowledged(event.target.checked)
                    }
                  />
                </Field>
              )}
              <button
                type="button"
                className={primary + " w-full"}
                data-handoff-launch=""
                disabled={
                  disabled ||
                  expired ||
                  !validPayout(payout, intent.minimum_payout) ||
                  Boolean(intent.risk_reason) ||
                  (intent.drift_warning && !driftAcknowledged)
                }
                onClick={() => void start(intent, driftAcknowledged, payout)}
              >
                {manual
                  ? t("开始手动下单记录", "Start manual execution record")
                  : t("前往 Binance", "Continue to Binance")}
              </button>
            </section>
          ) : (
            <button
              type="button"
              className={primary + " w-full"}
              data-handoff-cta=""
              disabled={disabled || expired}
              onClick={() => setSheet(true)}
            >
              {manual
                ? t("审核手动下单", "Review manual execution")
                : t("前往 Binance 下单", "Open Binance to place order")}
            </button>
          )}
          <button
            type="button"
            className={button}
            disabled={disabled || expired}
            onClick={() =>
              void send(url + "/decision", { action: "reject" }).then((ok) => {
                if (ok) close();
              })
            }
          >
            {t("跳过", "Skip")}
          </button>
        </>
      )}
      {recovery && recording && (
        <form
          className="space-y-3 rounded border p-3"
          onSubmit={record}
          data-handoff-record=""
        >
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
              />
            </Field>
            <Field
              label={t(
                "实际赔率倍数（总返还 ÷ 金额）",
                "Actual payout multiplier (total return ÷ premium)",
              )}
            >
              <input
                className={input}
                type="number"
                min="1.000001"
                max="100"
                step="0.000001"
                inputMode="decimal"
                required
                value={payout}
                onChange={(event) => setPayout(event.target.value)}
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
            <Field label={t("实际方向", "Actual direction")}>
              <select
                className={input}
                value={direction}
                onChange={(event) => {
                  setDirection(
                    event.target.value === "lower" ? "lower" : "higher",
                  );
                  setMismatchAcknowledged(false);
                }}
              >
                <option value="higher">HIGHER</option>
                <option value="lower">LOWER</option>
              </select>
            </Field>
            <Field label={t("实际期限", "Actual horizon")}>
              <select
                className={input}
                value={horizon}
                onChange={(event) => {
                  setHorizon(event.target.value === "30" ? 30 : 10);
                  setMismatchAcknowledged(false);
                }}
              >
                <option value={10}>10m</option>
                <option value={30}>30m</option>
              </select>
            </Field>
            <Field label={t("订单编号（选填）", "Order reference (optional)")}>
              <input
                className={input}
                name="reference"
                maxLength={128}
                required={uncertain}
              />
            </Field>
          </div>
          {payout && Number(payout) < Number(intent.minimum_payout) && (
            <p role="status" className="text-amber-300">
              {t(
                "实际赔率低于策略最低要求，记录将标记为低于门槛。",
                "Actual payout was below policy and will be flagged.",
              )}
            </p>
          )}
          {mismatch && (
            <Field
              label={t(
                "实际方向或期限与信号不同，我确认按币安成交记录。",
                "I confirm the actual direction or horizon differs from the signal.",
              )}
            >
              <input
                className="size-5"
                type="checkbox"
                checked={mismatchAcknowledged}
                onChange={(event) =>
                  setMismatchAcknowledged(event.target.checked)
                }
              />
            </Field>
          )}
          <button
            className={primary + " sticky bottom-2 w-full bg-[var(--panel)]"}
            disabled={disabled || (mismatch && !mismatchAcknowledged)}
          >
            {t("记录实际成交", "Record actual execution")}
          </button>
        </form>
      )}
    </article>
  );
}

function BinanceSteps({ t }: { t: T }) {
  return (
    <p className="text-sm text-[var(--muted)]">
      {t(
        "币安 App → 合约 → 事件合约。选择 BTC／ETH、10m／30m，核对方向、金额和赔率，再确认。",
        "Binance App → Futures → Events. Select BTC/ETH and 10m/30m, check direction, premium and payout, then confirm.",
      )}
    </p>
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
      {bet.price_drift_absolute !== null && (
        <div>
          <dt>{t("实际价格偏离", "Actual price drift")}</dt>
          <dd>
            {fmt.value(bet.price_drift_absolute)} ·{" "}
            {fmt.value(bet.price_drift_percent)}% ·{" "}
            {fmt.value(bet.price_drift_atr)} ATR
          </dd>
        </div>
      )}
      {bet.signal_to_execution_ms !== null && (
        <div>
          <dt>{t("信号 → 交接 → 开仓", "Signal → handoff → execution")}</dt>
          <dd>
            {fmt.value((bet.signal_to_handoff_ms ?? 0) / 1000)}s +{" "}
            {fmt.value((bet.handoff_to_execution_ms ?? 0) / 1000)}s
          </dd>
        </div>
      )}
      {(bet.payout_below_policy ||
        bet.late_execution_confirmation ||
        bet.direction_mismatch ||
        bet.horizon_mismatch) && (
        <div className="text-amber-300">
          <dt>{t("成交审核", "Execution audit")}</dt>
          {bet.payout_below_policy && (
            <dd>{t("实际赔率低于门槛", "Payout below policy")}</dd>
          )}
          {bet.late_execution_confirmation && (
            <dd>{t("过期后补录", "Recorded after signal expiry")}</dd>
          )}
          {bet.direction_mismatch && (
            <dd>{t("方向不同", "Direction mismatch")}</dd>
          )}
          {bet.horizon_mismatch && <dd>{t("期限不同", "Horizon mismatch")}</dd>}
        </div>
      )}
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

function HandoffMetrics({
  state,
  t,
  fmt,
}: {
  state: SemiState;
  t: T;
  fmt: Format;
}) {
  const data = state.handoff_metrics;
  const seconds = (ms: number | null) =>
    ms === null ? "—" : fmt.value(ms / 1000) + "s";
  const values = [
    [t("符合条件", "Eligible"), state.decisions.eligible ?? 0],
    [t("已发起币安交接", "Binance handoffs started"), data.opened],
    [t("已补录成交", "Executions recorded"), data.executed],
    [t("跳过交接", "Handoffs skipped"), data.skipped],
    [t("交接期间过期", "Expired during handoff"), data.expired_during_handoff],
    [t("低赔率成交", "Below-policy payouts"), data.payout_below_policy],
    [
      t("信号至成交中位数", "Median signal to execution"),
      seconds(data.median_signal_to_execution_ms),
    ],
    [
      t("信号至成交 P90", "P90 signal to execution"),
      seconds(data.p90_signal_to_execution_ms),
    ],
  ];
  return (
    <div className="space-y-2 border-t pt-3">
      <h3 className="font-semibold">{t("移动端交接", "Mobile handoff")}</h3>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {values.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        {t(
          "价格偏离（不超限 / 超限 / 无 ATR）",
          "Price drift (within / above limit / no ATR)",
        )}{" "}
        · {data.drift_within_limit} / {data.drift_above_limit} /{" "}
        {data.drift_unavailable}
      </p>
    </div>
  );
}

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
  const writing = useRef(false);
  const resume = useRef(true);
  const [now, setNow] = useState(Date.now);
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
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!token || busy) return;
    const abort = new AbortController();
    let polling = false;
    async function getState() {
      if (polling || writing.current || document.visibilityState !== "visible")
        return;
      polling = true;
      try {
        let current = (await request(token, "", {
          signal: abort.signal,
        })) as SemiState;
        if (abort.signal.aborted || writing.current) return;
        if (resume.current) {
          const pending = returnable(current.handoffs);
          if (pending.length) {
            await Promise.all(
              pending.map((intent) =>
                request(token, "/intents/" + intent.id + "/decision", {
                  method: "POST",
                  body: JSON.stringify({ action: "return" }),
                  signal: abort.signal,
                }),
              ),
            );
            current = (await request(token, "", {
              signal: abort.signal,
            })) as SemiState;
          }
          resume.current = false;
        }
        if (!abort.signal.aborted && !writing.current) setState(current);
      } catch (failure) {
        if (abort.signal.aborted) return;
        const code =
          failure instanceof Error ? failure.message : "semi_auto_unavailable";
        if (code === "operator_required") setState(null);
        setError(code);
      } finally {
        polling = false;
      }
    }
    function foreground() {
      if (document.visibilityState !== "visible") return;
      resume.current = true;
      void getState();
    }
    void getState();
    const timer = setInterval(() => void getState(), 4000);
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("pageshow", foreground);
    window.addEventListener("focus", foreground);
    return () => {
      abort.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("pageshow", foreground);
      window.removeEventListener("focus", foreground);
    };
  }, [token, busy]);

  const send: Send = async (path, data, method = "POST") => {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      await request(token, path, { method, body: JSON.stringify(data) });
      setIntentPage(null);
      setBetPage(null);
      return true;
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "semi_auto_unavailable",
      );
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  async function start(
    intent: SemiIntent,
    driftAcknowledged: boolean,
    payout: string,
  ) {
    if (writing.current) return;
    const manual = intent.execution_adapter === "MANUAL";
    const tab = manual ? null : window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    resume.current = false;
    writing.current = true;
    setBusy(true);
    setError("");
    const saved = request(token, "/intents/" + intent.id + "/decision", {
      method: "POST",
      body: JSON.stringify({
        action: manual ? "execute" : "handoff",
        acknowledged: true,
        drift_acknowledged: driftAcknowledged,
        payout,
      }),
    }) as Promise<SemiIntent>;
    const ready = saved.then(
      (result) =>
        result.id === intent.id &&
        result.execution_status ===
          (manual ? "EXECUTING" : "HANDOFF_STARTED") &&
        Boolean(result.execution_started_at) &&
        !result.returned_at &&
        Date.parse(result.expires_at) > Date.now(),
      () => false,
    );
    if (!manual) void copyInstruction(intent, ready);
    try {
      const result = await saved;
      if (!(await ready)) {
        tab?.close();
        return;
      }
      setReviewId(result.id);
      setIntentPage(null);
      if (!manual) {
        if (tab && !tab.closed) tab.location.replace(binanceAppEntry);
        else window.location.assign(binanceAppEntry);
      }
    } catch (failure) {
      tab?.close();
      setError(
        failure instanceof Error ? failure.message : "semi_auto_unavailable",
      );
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
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
    resume.current = true;
    setToken("");
    setDraft("");
    setState(null);
    setError("");
    setReviewId(null);
    setIntentPage(null);
    setBetPage(null);
    setActivation(false);
  }
  const eligible =
    state?.signals.flatMap(({ intent }) =>
      intent &&
      actionable(
        intent,
        state.enabled && state.live_execution_enabled && !state.killed,
        now,
      ) &&
      state.execution_adapters.some(
        (adapter) =>
          adapter.adapter === intent.execution_adapter &&
          adapter.available &&
          adapter.healthy,
      )
        ? [intent]
        : [],
    ) ?? [];
  const selected =
    eligible.find((intent) => intent.id === reviewId) ?? eligible[0];
  const recovered =
    state?.handoffs.find((intent) => intent.id === reviewId) ??
    state?.handoffs[0];
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
            data-semi-enabled={
              state.enabled && state.live_execution_enabled && !state.killed
            }
            className={
              state.enabled && state.live_execution_enabled && !state.killed
                ? "text-emerald-300"
                : "text-[var(--muted)]"
            }
          >
            {state.killed
              ? t("停止开关已启动", "Kill switch active")
              : !state.live_execution_enabled
                ? reasonLabel("live_execution_disabled", t)
                : state.enabled
                  ? t("半自动实盘已启用", "Live Semi-Auto enabled")
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
          {recovered && (
            <>
              {state.handoffs.length > 1 && (
                <Field label={t("待补录交接", "Pending handoffs")}>
                  <select
                    className={input}
                    value={recovered.id}
                    onChange={(event) => setReviewId(event.target.value)}
                  >
                    {state.handoffs.map((intent) => (
                      <option key={intent.id} value={intent.id}>
                        {intent.symbol} · {intent.horizon_minutes}m ·{" "}
                        {fmt.time(intent.handoff_started_at)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <IntentReview
                key={recovered.id}
                intent={recovered}
                disabled={busy}
                send={send}
                start={start}
                t={t}
                fmt={fmt}
                now={now}
                close={() => setReviewId(null)}
              />
            </>
          )}
          {selected && (
            <IntentReview
              key={selected.id}
              intent={selected}
              disabled={busy}
              send={send}
              start={start}
              t={t}
              fmt={fmt}
              now={now}
              close={() => setReviewId(null)}
            />
          )}
          <section className="space-y-2">
            <h2 className="font-semibold">
              {t("当前信号", "Current signals")}
            </h2>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {state.signals.map((card) => {
                const assessment = card.assessment;
                const canReview =
                  card.intent &&
                  eligible.some((intent) => intent.id === card.intent?.id);
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
                        : canReview
                          ? t("风控通过", "Risk checks passed")
                          : card.intent?.risk_reason
                            ? reasonLabel(card.intent.risk_reason, t)
                            : t(
                                "等待可审核信号",
                                "Waiting for an actionable signal",
                              )}
                    </p>
                    {canReview &&
                      card.intent &&
                      card.intent.id !== selected?.id && (
                        <button
                          type="button"
                          className={primary}
                          onClick={() => setReviewId(card.intent?.id ?? null)}
                        >
                          {t("查看信号", "Review signal")}
                        </button>
                      )}
                  </article>
                );
              })}
            </div>
          </section>
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
          <section className={panel + " space-y-3"}>
            <h2 className="font-semibold">
              {t("实盘表现 · 手动记录", "Real performance · Operator records")}
            </h2>
            <Metrics data={state.real} t={t} fmt={fmt} />
            <HandoffMetrics state={state} t={t} fmt={fmt} />
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
                    {statusLabel(
                      item.execution_status === "FAILED" ||
                        item.execution_status === "RECONCILIATION_REQUIRED"
                        ? item.execution_status
                        : item.status,
                      t,
                    )}
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
