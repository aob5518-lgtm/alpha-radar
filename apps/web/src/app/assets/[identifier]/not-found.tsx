import Link from "next/link";

export default function AssetNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 text-center">
      <div className="w-full rounded-2xl border bg-[var(--card)] p-8">
        <p className="text-sm text-emerald-400">404</p>
        <h1 className="mt-3 text-3xl font-semibold">Asset not found</h1>
        <p className="mt-3 text-[var(--muted)]">
          No canonical asset matches this identifier.
        </p>
        <Link
          href="/assets"
          className="mt-6 inline-block rounded-md border px-5 py-2 text-sm hover:bg-white/5"
        >
          Back to assets
        </Link>
      </div>
    </main>
  );
}
