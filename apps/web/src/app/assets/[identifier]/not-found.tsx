import Link from "next/link";

import { getTranslations } from "@/lib/i18n/server";

export default async function AssetNotFound() {
  const { messages } = await getTranslations();

  return (
    <main className="mx-auto flex min-h-[calc(100vh-73px)] max-w-xl items-center px-6 text-center">
      <div className="w-full rounded-2xl border bg-[var(--card)] p-8">
        <p className="text-sm text-emerald-400">404</p>
        <h1 className="mt-3 text-3xl font-semibold">
          {messages.assets.notFoundTitle}
        </h1>
        <p className="mt-3 text-[var(--muted)]">
          {messages.assets.notFoundDescription}
        </p>
        <Link
          href="/assets"
          className="mt-6 inline-block rounded-md border px-5 py-2 text-sm hover:bg-white/5"
        >
          {messages.assets.backToAssets}
        </Link>
      </div>
    </main>
  );
}
