import { Activity, Radar } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-16">
      <section className="w-full rounded-3xl border bg-[var(--card)] p-8 shadow-2xl sm:p-12">
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm text-[var(--accent)]">
          <Activity className="size-4" aria-hidden="true" />
          Engineering foundation online
        </div>
        <div className="grid gap-10 lg:grid-cols-[1fr_20rem] lg:items-end">
          <div>
            <p className="mb-3 text-sm font-semibold tracking-[0.25em] text-[var(--muted)] uppercase">
              Alpha Radar
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
              Financial intelligence, built from evidence.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)]">
              The Sprint 0 platform foundation is ready for canonical assets,
              market data, and event intelligence in the sprints ahead.
            </p>
          </div>
          <div className="rounded-2xl border bg-black/20 p-5">
            <Radar
              className="mb-8 size-8 text-[var(--accent)]"
              aria-hidden="true"
            />
            <p className="text-sm text-[var(--muted)]">Current phase</p>
            <p className="mt-1 text-xl font-medium">Engineering Foundation</p>
            <Button className="mt-6 w-full" disabled>
              Sprint 0
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
