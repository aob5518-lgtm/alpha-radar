import { ArrowLeft, DatabaseZap } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getAsset } from "@/lib/api/assets";

export const dynamic = "force-dynamic";

const sections = [
  "Market",
  "Events",
  "Catalysts",
  "Fundamentals",
  "Capital Flow",
  "Narratives",
  "Risk",
] as const;

interface AssetPageProps {
  params: Promise<{ identifier: string }>;
}

export default async function AssetPage({ params }: AssetPageProps) {
  const { identifier } = await params;
  const asset = await getAsset(identifier);
  if (!asset) notFound();

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-10 sm:px-8">
      <Link
        href="/assets"
        className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Asset directory
      </Link>

      <section className="mt-8 rounded-3xl border bg-[var(--card)] p-7 sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-emerald-400 px-2.5 py-1 text-sm font-bold text-zinc-950">
                {asset.symbol}
              </span>
              <span className="text-sm text-[var(--muted)]">
                {asset.asset_type}
              </span>
            </div>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">
              {asset.name}
            </h1>
            <p className="mt-4 max-w-2xl text-[var(--muted)]">
              {asset.chain ??
                asset.sector ??
                "Classification not yet available"}
              {asset.country ? ` · ${asset.country}` : ""}
            </p>
          </div>
          <div className="text-xs text-[var(--muted)]">
            <p>Canonical UUID</p>
            <p className="mt-1 font-mono text-zinc-300">{asset.id}</p>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border bg-[var(--card)] p-6">
        <h2 className="text-lg font-medium">Overview</h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[var(--muted)] uppercase">Slug</dt>
            <dd className="mt-1">{asset.slug}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)] uppercase">Status</dt>
            <dd className="mt-1">{asset.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)] uppercase">
              Provider mappings
            </dt>
            <dd className="mt-1">{asset.provider_mappings.length}</dd>
          </div>
        </dl>
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <section
            key={section}
            className="min-h-40 rounded-2xl border bg-[var(--card)] p-6"
          >
            <DatabaseZap
              className="size-5 text-[var(--muted)]"
              aria-hidden="true"
            />
            <h2 className="mt-6 text-lg font-medium">{section}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Not yet integrated. This section will only display sourced
              platform data when available.
            </p>
          </section>
        ))}
      </div>
    </main>
  );
}
