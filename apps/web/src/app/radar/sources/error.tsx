"use client";

import { getClientTranslations } from "@/lib/i18n/client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const { messages } = getClientTranslations();
  return (
    <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
      <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-8">
        <h1 className="text-2xl font-semibold">
          {messages.sources.errorTitle}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {messages.sources.errorDescription}
        </p>
        <button
          className="mt-5 rounded-md border px-4 py-2 text-sm"
          onClick={reset}
        >
          {messages.common.tryAgain}
        </button>
      </div>
    </main>
  );
}
