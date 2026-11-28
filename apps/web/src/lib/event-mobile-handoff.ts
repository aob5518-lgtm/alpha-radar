import type { SemiIntent } from "@alpha-radar/types/event-semi-auto";

export const binanceAppEntry = "https://www.binance.com/en/download";

export function instruction(intent: SemiIntent): string {
  const market = intent.symbol === "BTCUSDT" ? "BTC" : "ETH";
  const direction = intent.direction === "higher" ? "HIGHER" : "LOWER";
  return [
    market + " " + intent.horizon_minutes + "m",
    direction,
    Number(intent.suggested_stake).toFixed(2) + " USDT",
    "Min payout " + Number(intent.minimum_payout).toFixed(2) + "x",
  ].join("\n");
}

export function actionable(intent: SemiIntent, enabled: boolean, now: number) {
  return (
    enabled &&
    (intent.signal_state === "STRONG_HIGHER" ||
      intent.signal_state === "STRONG_LOWER") &&
    (intent.status === "PENDING_REVIEW" ||
      intent.status === "APPROVED_BY_USER") &&
    !intent.risk_reason &&
    !intent.handoff_started_at &&
    !intent.execution_started_at &&
    Date.parse(intent.execution_deadline ?? intent.expires_at) > now
  );
}

export function returnable(intents: readonly SemiIntent[]): SemiIntent[] {
  return intents.filter(
    (intent) => Boolean(intent.handoff_started_at) && !intent.returned_at,
  );
}

export async function copyInstruction(
  intent: SemiIntent,
  committed?: Promise<boolean>,
) {
  try {
    if (
      committed &&
      typeof ClipboardItem !== "undefined" &&
      navigator.clipboard?.write
    ) {
      const content = committed.then((ok) => {
        if (!ok) throw new Error("Intent was not saved");
        return new Blob([instruction(intent)], { type: "text/plain" });
      });
      void content.catch(() => undefined);
      await navigator.clipboard.write([
        new ClipboardItem({ "text/plain": content }),
      ]);
      return;
    }
    if (committed && !(await committed)) return;
    await navigator.clipboard?.writeText(instruction(intent));
  } catch {
    // Denied clipboard access does not prevent the official handoff.
  }
}
