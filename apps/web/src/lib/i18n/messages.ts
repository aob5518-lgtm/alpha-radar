import enMessages from "../../../messages/en.json";
import zhCnMessages from "../../../messages/zh-CN.json";

import type { Locale } from "./config";

export type Messages = typeof enMessages;

const catalogs: Record<Locale, Messages> = {
  en: enMessages,
  "zh-CN": zhCnMessages,
};

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}

export function formatMessage(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
