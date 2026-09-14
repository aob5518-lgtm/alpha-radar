import { cookies } from "next/headers";

import {
  defaultLocale,
  localeCookieName,
  parseLocale,
  type Locale,
} from "./config";
import { getMessages, type Messages } from "./messages";

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  return parseLocale(cookieStore.get(localeCookieName)?.value);
}

export async function getTranslations(): Promise<{
  locale: Locale;
  messages: Messages;
}> {
  const locale = await getLocale();
  return {
    locale,
    messages: getMessages(locale),
  };
}

export { defaultLocale, localeCookieName };
