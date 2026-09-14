import {
  defaultLocale,
  localeCookieName,
  parseLocale,
  type Locale,
} from "./config";
import { getMessages, type Messages } from "./messages";

export function getClientLocale(cookieString = document.cookie): Locale {
  const localeCookie = cookieString
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${localeCookieName}=`));

  if (!localeCookie) return defaultLocale;

  const value = decodeURIComponent(
    localeCookie.slice(localeCookieName.length + 1),
  );
  return parseLocale(value);
}

export function getClientTranslations(cookieString?: string): {
  locale: Locale;
  messages: Messages;
} {
  const locale = getClientLocale(cookieString);
  return {
    locale,
    messages: getMessages(locale),
  };
}
