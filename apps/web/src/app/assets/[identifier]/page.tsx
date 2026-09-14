import { ArrowLeft, DatabaseZap } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getAsset } from "@/lib/api/assets";
import { assetStatusLabel, assetTypeLabel } from "@/lib/i18n/labels";
import { getTranslations } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

const sections = [
  "market",
  "events",
  "catalysts",
  "fundamentals",
  "capitalFlow",
  "narratives",
  "risk",
] as const;

interface AssetPageProps {
  params: Promise<{ identifier: string }>;
}

export default async function AssetPage({ params }: AssetPageProps) {
  const { messages } = await getTranslations();
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
        {messages.assets.backToDirectory}
      </Link>

      <section className="mt-8 rounded-3xl border bg-[var(--card)] p-7 sm:p-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-emerald-400 px-2.5 py-1 text-sm font-bold text-zinc-950">
                {asset.symbol}
              </span>
              <span className="text-sm text-[var(--muted)]">
                {assetTypeLabel(asset.asset_type, messages)}
              </span>
            </div>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">
              {asset.name}
            </h1>
            <p className="mt-4 max-w-2xl text-[var(--muted)]">
              {asset.chain ??
                asset.sector ??
                messages.assets.classificationUnavailable}
              {asset.country ? ` · ${asset.country}` : ""}
            </p>
          </div>
          <div className="text-xs text-[var(--muted)]">
            <p>{messages.assets.canonicalUuid}</p>
            <p className="mt-1 font-mono text-zinc-300">{asset.id}</p>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border bg-[var(--card)] p-6">
        <h2 className="text-lg font-medium">
          {messages.assets.overview.title}
        </h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[var(--muted)] uppercase">
              {messages.assets.overview.slug}
            </dt>
            <dd className="mt-1">{asset.slug}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)] uppercase">
              {messages.assets.overview.status}
            </dt>
            <dd className="mt-1">{assetStatusLabel(asset.status, messages)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)] uppercase">
              {messages.assets.overview.providerMappings}
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
            <h2 className="mt-6 text-lg font-medium">
              {messages.assets.sections[section]}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              {messages.assets.sections.notIntegratedDescription}
            </p>
          </section>
        ))}
      </div>
    </main>
  );
}
