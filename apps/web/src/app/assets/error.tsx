"use client";

import { AlertTriangle } from "lucide-react";

export default function AssetsError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6">
      <div className="w-full rounded-2xl border bg-[var(--card)] p-8 text-center">
        <AlertTriangle
          className="mx-auto size-8 text-amber-400"
          aria-hidden="true"
        />
        <h1 className="mt-4 text-2xl font-semibold">
          Asset data is unavailable
        </h1>
        <p className="mt-2 text-[var(--muted)]">
          The API could not be reached. No placeholder data is shown.
        </p>
        <button
          onClick={reset}
          className="mt-6 rounded-md bg-emerald-400 px-5 py-2 text-sm font-medium text-zinc-950"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
