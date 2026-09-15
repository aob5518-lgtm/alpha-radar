import { Bot, LockKeyhole, Send } from "lucide-react";

import { getTranslations } from "@/lib/i18n/server";

export default async function AnalystPage() {
  const { messages } = await getTranslations();
  return (
    <main className="page-shell">
      <header className="border-b pb-7">
        <p className="section-label">{messages.analyst.eyebrow}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">
          {messages.analyst.title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
          {messages.analyst.description}
        </p>
      </header>
      <section className="mx-auto mt-12 max-w-3xl">
        <div className="panel p-6 sm:p-10">
          <Bot className="size-8 text-emerald-300" />
          <h2 className="mt-6 text-xl font-semibold">
            {messages.analyst.disabled}
          </h2>
          <div className="mt-6 flex rounded-xl border bg-black/20 p-2 opacity-60">
            <input
              disabled
              placeholder={messages.analyst.placeholder}
              aria-label={messages.analyst.placeholder}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm"
            />
            <button
              disabled
              aria-label={messages.analyst.disabled}
              className="icon-button"
            >
              <Send className="size-4" />
            </button>
          </div>
          <div className="mt-6 rounded-xl border p-4">
            <div className="flex items-center gap-2">
              <LockKeyhole className="size-4 text-amber-300" />
              <h3 className="text-sm font-semibold">
                {messages.analyst.guardrailTitle}
              </h3>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {messages.analyst.guardrailDescription}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
