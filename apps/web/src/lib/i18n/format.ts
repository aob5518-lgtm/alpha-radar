import type { Locale } from "./config";

export function formatDateTime(
  value: Date | string | number,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(new Date(value));
}

export function formatNumber(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatPercent(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return formatNumber(value, locale, {
    style: "percent",
    maximumFractionDigits: 2,
    ...options,
  });
}

export function formatCurrency(
  value: number,
  locale: Locale,
  currency: string,
  options: Intl.NumberFormatOptions = {},
): string {
  return formatNumber(value, locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    ...options,
  });
}

export function formatMarketPrice(
  value: number,
  locale: Locale,
  quoteCurrency: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const priceOptions: Intl.NumberFormatOptions = {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
    ...options,
  };
  if (/^[A-Z]{3}$/.test(quoteCurrency)) {
    return formatCurrency(value, locale, quoteCurrency, priceOptions);
  }
  return `${formatNumber(value, locale, priceOptions)} ${quoteCurrency}`;
}
