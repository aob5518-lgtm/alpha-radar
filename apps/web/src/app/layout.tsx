import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { getTranslations } from "@/lib/i18n/server";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { messages } = await getTranslations();
  return {
    title: messages.common.appName,
    description: messages.home.description,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { locale, messages } = await getTranslations();

  return (
    <html lang={locale}>
      <body>
        <AppShell locale={locale} messages={messages}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
