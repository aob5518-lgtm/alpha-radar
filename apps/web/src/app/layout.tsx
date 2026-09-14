import type { Metadata } from "next";
import Link from "next/link";

import { LanguageSwitcher } from "@/components/language-switcher";
import { getTranslations } from "@/lib/i18n/server";

import "./globals.css";

export const metadata: Metadata = {
  title: "Alpha Radar",
  description: "Financial intelligence and asset discovery platform",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { locale, messages } = await getTranslations();

  return (
    <html lang={locale}>
      <body>
        <header className="border-b border-[var(--border)] bg-[var(--background)]/95">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
            <Link href="/" className="text-sm font-semibold text-zinc-100">
              {messages.common.appName}
            </Link>
            <LanguageSwitcher locale={locale} label={messages.language.label} />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
