"use client";

import { Bot, CalendarDays, LineChart, Radar } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { LanguageSwitcher } from "@/components/language-switcher";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

const routes = [
  { href: "/events", key: "events", icon: CalendarDays },
  { href: "/chart", key: "chart", icon: LineChart },
  { href: "/analyst", key: "analyst", icon: Bot },
] as const;

interface AppShellProps {
  children: React.ReactNode;
  locale: Locale;
  messages: Messages;
}

export function AppShell({ children, locale, messages }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-[var(--background)]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[100rem] items-center gap-3 px-4 sm:px-7">
          <Link
            href="/events"
            aria-label={messages.common.appName}
            className="mr-auto flex shrink-0 items-center gap-2 font-semibold tracking-[0.14em] uppercase"
          >
            <span className="grid size-8 place-items-center rounded-md bg-emerald-400 text-zinc-950">
              <Radar className="size-4" aria-hidden="true" />
            </span>
            <span className="hidden sm:inline">{messages.common.appName}</span>
          </Link>

          <nav
            aria-label={messages.nav.primaryLabel}
            className="flex min-w-0 items-center gap-1"
          >
            {routes.map(({ href, key, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "core-nav-link",
                    active && "core-nav-link-active",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span>{messages.nav[key]}</span>
                </Link>
              );
            })}
          </nav>

          <div className="ml-1 shrink-0 border-l pl-3">
            <LanguageSwitcher locale={locale} label={messages.language.label} />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
