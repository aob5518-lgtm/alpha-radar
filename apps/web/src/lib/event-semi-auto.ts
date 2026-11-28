export function validPayout(value: string, minimum: string): boolean {
  return (
    /^\d+(?:\.\d{1,6})?$/.test(value) &&
    Number(value) <= 100 &&
    Number(value) > 1 &&
    Number(value) >= Number(minimum)
  );
}

export function payoutBreakeven(value: string): number | null {
  const payout = Number(value);
  return Number.isFinite(payout) && payout > 1 && payout <= 100
    ? 1 / payout
    : null;
}

export function executionTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
