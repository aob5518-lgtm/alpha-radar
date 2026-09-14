"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  localeCookieName,
  localeDisplayName,
  supportedLocales,
  type Locale,
} from "@/lib/i18n/config";

interface LanguageSwitcherProps {
  locale: Locale;
  label: string;
}

export function LanguageSwitcher({ locale, label }: LanguageSwitcherProps) {
  const router = useRouter();

  function switchLocale(nextLocale: Locale) {
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${localeCookieName}=${nextLocale}; path=/; max-age=${maxAge}; samesite=lax`;
    router.refresh();
  }

  return (
    <label className="inline-flex items-center gap-2 rounded-md border bg-[var(--card)] px-3 py-2 text-sm text-[var(--muted)]">
      <Languages className="size-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={locale}
        onChange={(event) => switchLocale(event.target.value as Locale)}
        className="bg-transparent text-zinc-100 outline-none"
      >
        {supportedLocales.map((supportedLocale) => (
          <option key={supportedLocale} value={supportedLocale}>
            {localeDisplayName(supportedLocale)}
          </option>
        ))}
      </select>
    </label>
  );
}
