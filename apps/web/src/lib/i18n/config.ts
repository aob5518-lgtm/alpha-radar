export const supportedLocales = ["en", "zh-CN"] as const;
export type Locale = (typeof supportedLocales)[number];

export const defaultLocale: Locale = "en";
export const localeCookieName = "alpha_radar_locale";

export function isLocale(value: string | undefined): value is Locale {
  return supportedLocales.some((locale) => locale === value);
}

export function parseLocale(value: string | undefined): Locale {
  return isLocale(value) ? value : defaultLocale;
}

export function localeDisplayName(locale: Locale): string {
  switch (locale) {
    case "en":
      return "English";
    case "zh-CN":
      return "简体中文";
  }
}
