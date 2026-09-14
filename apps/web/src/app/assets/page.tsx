import { assetTypes, type AssetType } from "@alpha-radar/types/assets";
import { ChevronLeft, ChevronRight, Database, Search } from "lucide-react";
import Link from "next/link";

import { getAssets } from "@/lib/api/assets";

export const dynamic = "force-dynamic";

interface AssetsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function isAssetType(value: string | undefined): value is AssetType {
  return assetTypes.some((assetType) => assetType === value);
}

function pageHref(page: number, search: string, assetType: string): string {
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("search", search);
  if (assetType) params.set("asset_type", assetType);
  return `/assets?${params.toString()}`;
}

export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const params = await searchParams;
  const page = parsePage(first(params.page));
  const search = first(params.search)?.trim() ?? "";
  const rawAssetType = first(params.asset_type);
  const assetType = isAssetType(rawAssetType) ? rawAssetType : undefined;
  const response = await getAssets({
    page,
    search: search || undefined,
    assetType,
  });

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-10 sm:px-8">
      <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/"
            className="text-sm text-emerald-400 hover:text-emerald-300"
          >
            Alpha Radar
          </Link>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            Asset directory
          </h1>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">
            Canonical financial entities. Symbols are labels; UUIDs are the
            durable identity.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Database className="size-4" aria-hidden="true" />
          {response.pagination.total_items} assets
        </div>
      </div>

      <form className="mb-6 grid gap-3 rounded-2xl border bg-[var(--card)] p-4 sm:grid-cols-[1fr_13rem_auto]">
        <label className="relative">
          <span className="sr-only">Search assets</span>
          <Search
            className="absolute top-3 left-3 size-4 text-[var(--muted)]"
            aria-hidden="true"
          />
          <input
            name="search"
            defaultValue={search}
            placeholder="Search symbol, name, or slug"
            className="h-10 w-full rounded-md border bg-black/20 pr-3 pl-10 text-sm outline-none focus:ring-2 focus:ring-emerald-400"
          />
        </label>
        <label>
          <span className="sr-only">Filter by asset type</span>
          <select
            name="asset_type"
            defaultValue={assetType ?? ""}
            className="h-10 w-full rounded-md border bg-black/20 px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-400"
          >
            <option value="">All asset types</option>
            {assetTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <button className="h-10 rounded-md bg-emerald-400 px-5 text-sm font-medium text-zinc-950 hover:bg-emerald-300">
          Apply
        </button>
      </form>

      {response.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-20 text-center">
          <p className="text-lg font-medium">No assets found</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Try a different search or asset type.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-[var(--card)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs tracking-wider text-[var(--muted)] uppercase">
                <tr>
                  <th className="px-5 py-4">Symbol</th>
                  <th className="px-5 py-4">Name</th>
                  <th className="px-5 py-4">Type</th>
                  <th className="px-5 py-4">Sector / chain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {response.items.map((asset) => (
                  <tr
                    key={asset.id}
                    className="transition-colors hover:bg-white/[0.03]"
                  >
                    <td className="px-5 py-4 font-semibold text-emerald-400">
                      <Link href={`/assets/${asset.slug}`}>{asset.symbol}</Link>
                    </td>
                    <td className="px-5 py-4">{asset.name}</td>
                    <td className="px-5 py-4 text-[var(--muted)]">
                      {asset.asset_type}
                    </td>
                    <td className="px-5 py-4 text-[var(--muted)]">
                      {asset.chain ?? asset.sector ?? "Not classified"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <nav
        className="mt-6 flex items-center justify-between text-sm"
        aria-label="Pagination"
      >
        <span className="text-[var(--muted)]">
          Page {response.pagination.page} of{" "}
          {Math.max(response.pagination.total_pages, 1)}
        </span>
        <div className="flex gap-2">
          {page > 1 && (
            <Link
              className="rounded-md border p-2 hover:bg-white/5"
              href={pageHref(page - 1, search, assetType ?? "")}
            >
              <ChevronLeft className="size-4" aria-label="Previous page" />
            </Link>
          )}
          {page < response.pagination.total_pages && (
            <Link
              className="rounded-md border p-2 hover:bg-white/5"
              href={pageHref(page + 1, search, assetType ?? "")}
            >
              <ChevronRight className="size-4" aria-label="Next page" />
            </Link>
          )}
        </div>
      </nav>
    </main>
  );
}
