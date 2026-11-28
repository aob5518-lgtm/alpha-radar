import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { EventAlertProvider } from "@/components/event-alert-provider";
import { getTranslations } from "@/lib/i18n/server";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { messages } = await getTranslations();
  return {
    title: messages.common.appName,
    description: messages.home.description,
    manifest: "/manifest.webmanifest",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { locale, messages } = await getTranslations();

  return (
    <html lang={locale}>
      <body>
        <EventAlertProvider
          enabled={
            process.env.EVENT_ALERTS_ENABLED === "true" &&
            process.env.EVENT_SEMI_AUTO_AVAILABLE === "true"
          }
          locale={locale}
        >
          <AppShell
            locale={locale}
            messages={messages}
            simulatorEnabled={process.env.EVENT_SIMULATOR_ENABLED === "true"}
          >
            {children}
          </AppShell>
        </EventAlertProvider>
      </body>
    </html>
  );
}
