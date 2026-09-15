"use client";

import {
  Bell,
  Binoculars,
  Bot,
  Gauge,
  Menu,
  Radar,
  Search,
  Star,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

const routes = [
  { href: "/", key: "commandCenter", icon: Gauge },
  { href: "/radar", key: "radar", icon: Radar },
  { href: "/discover", key: "discover", icon: Binoculars },
  { href: "/assets", key: "assets", icon: Search },
  { href: "/watchlist", key: "watchlist", icon: Star },
  { href: "/alerts", key: "alerts", icon: Bell },
  { href: "/analyst", key: "analyst", icon: Bot },
] as const;

interface AppShellProps {
  children: React.ReactNode;
  locale: Locale;
  messages: Messages;
}

export function AppShell({ children, locale, messages }: AppShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const navigation = (
    <nav aria-label={messages.nav.primaryLabel} className="space-y-1">
      {routes.map(({ href, key, icon: Icon }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            onClick={() => setOpen(false)}
            className={cn("nav-link", active && "nav-link-active")}
          >
            <Icon className="size-4" aria-hidden="true" />
            {messages.nav[key]}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r bg-[var(--panel)] p-5 lg:flex lg:flex-col">
        <Link
          href="/"
          className="flex items-center gap-3 px-2 text-sm font-bold tracking-[0.18em] uppercase"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-emerald-400 text-zinc-950">
            <Radar className="size-4" aria-hidden="true" />
          </span>
          {messages.common.appName}
        </Link>
        <div className="mt-9 flex-1">{navigation}</div>
        <p className="border-t pt-4 text-[11px] leading-5 text-[var(--muted)]">
          {messages.common.noAdvice}
        </p>
      </aside>

      <div className="lg:col-start-2">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-[var(--background)]/95 px-4 backdrop-blur sm:px-7">
          <button
            type="button"
            className="icon-button lg:!hidden"
            onClick={() => setOpen(true)}
            aria-label={messages.nav.openMenu}
          >
            <Menu className="size-5" />
          </button>
          <div className="hidden text-xs text-[var(--muted)] sm:block">
            {messages.common.simulatedSnapshot}
          </div>
          <LanguageSwitcher locale={locale} label={messages.language.label} />
        </header>
        {children}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={messages.nav.primaryLabel}
        >
          <aside className="h-full w-72 border-r bg-[var(--panel)] p-5">
            <div className="mb-8 flex items-center justify-between">
              <span className="font-semibold">{messages.common.appName}</span>
              <button
                type="button"
                className="icon-button"
                onClick={() => setOpen(false)}
                aria-label={messages.nav.closeMenu}
              >
                <X className="size-5" />
              </button>
            </div>
            {navigation}
          </aside>
        </div>
      )}
    </div>
  );
}
