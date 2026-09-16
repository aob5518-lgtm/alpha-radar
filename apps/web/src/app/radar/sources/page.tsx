import { sourceTypes, type SourceType } from "@alpha-radar/types/sources";
import { Database, ExternalLink, FileText, History } from "lucide-react";
import Link from "next/link";

import { getDocument, getDocuments, getSources } from "@/lib/api/sources";
import { formatDateTime } from "@/lib/i18n/format";
import { getTranslations } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function href(page: number, values: Record<string, string>): string {
  const params = new URLSearchParams({ page: String(page) });
  for (const [key, value] of Object.entries(values))
    if (value) params.set(key, value);
  return `/radar/sources?${params.toString()}`;
}

export default async function SourcesPage({ searchParams }: Props) {
  const { locale, messages } = await getTranslations();
  const copy = messages.sources;
  const raw = await searchParams;
  const pageValue = Number(first(raw.page));
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const source = first(raw.source);
  const documentType = first(raw.document_type);
  const search = first(raw.search);
  const rawType = first(raw.source_type);
  const sourceType = sourceTypes.includes(rawType as SourceType)
    ? (rawType as SourceType)
    : undefined;
  const selectedId = first(raw.document);
  const [sources, documents, selected] = await Promise.all([
    getSources(),
    getDocuments({
      page,
      source: source || undefined,
      sourceType,
      documentType: documentType || undefined,
      search: search || undefined,
    }),
    selectedId ? getDocument(selectedId) : Promise.resolve(null),
  ]);
  const values = {
    source,
    source_type: sourceType ?? "",
    document_type: documentType,
    search,
  };

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-5 py-10 sm:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-400">{copy.eyebrow}</p>
          <h1 className="mt-2 text-4xl font-semibold">{copy.title}</h1>
          <p className="mt-3 max-w-3xl text-[var(--muted)]">
            {copy.description}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <Database className="size-4" /> {documents.pagination.total_items}{" "}
          {copy.documents}
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-amber-300/30 bg-amber-300/5 p-4 text-sm">
        <strong>{copy.boundary}</strong> — {copy.boundaryDescription}
      </div>

      <form className="mt-6 grid gap-3 rounded-2xl border bg-[var(--card)] p-4 md:grid-cols-4">
        <input
          name="search"
          defaultValue={search}
          placeholder={copy.search}
          className="h-10 rounded-md border bg-black/20 px-3 text-sm"
        />
        <select
          name="source"
          defaultValue={source}
          className="h-10 rounded-md border bg-black/20 px-3 text-sm"
        >
          <option value="">{copy.allSources}</option>
          {sources.items.map((item) => (
            <option key={item.id} value={item.slug}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          name="document_type"
          defaultValue={documentType}
          placeholder={copy.documentType}
          className="h-10 rounded-md border bg-black/20 px-3 text-sm"
        />
        <button className="rounded-md bg-emerald-400 px-4 text-sm font-medium text-zinc-950">
          {copy.apply}
        </button>
      </form>

      {selectedId && (
        <section className="mt-6 rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-6">
          {selected ? (
            <>
              <div className="flex items-center gap-2 text-xs tracking-widest text-emerald-300 uppercase">
                <FileText className="size-4" />
                {copy.sourceDocument}
              </div>
              <h2 className="mt-3 text-xl font-semibold">{selected.title}</h2>
              <p className="mt-2 text-sm text-[var(--muted)]">
                {selected.source.name} · {selected.document_type} ·{" "}
                {copy.version} {selected.current_version.version_number}
              </p>
              {selected.current_version.summary && (
                <p className="mt-4 max-w-3xl text-sm leading-6">
                  {selected.current_version.summary}
                </p>
              )}
              <a
                href={selected.canonical_url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 text-sm text-emerald-400"
              >
                {copy.officialDocument}
                <ExternalLink className="size-4" />
              </a>
            </>
          ) : (
            <p>{copy.notFound}</p>
          )}
        </section>
      )}

      <section className="mt-6 grid gap-4">
        {documents.items.length === 0 && (
          <div className="rounded-2xl border p-10 text-center text-[var(--muted)]">
            {copy.empty}
          </div>
        )}
        {documents.items.map((item) => (
          <article
            key={item.id}
            className="rounded-2xl border bg-[var(--card)] p-5"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <span className="rounded-full border px-2 py-1">
                {copy.sourceDocument}
              </span>
              <span>{item.source.name}</span>
              <span>·</span>
              <span>{copy.types[item.source.source_type]}</span>
              <span>·</span>
              <span>
                {messages.labels.sourceTiers[item.source.source_tier]}
              </span>
            </div>
            <h2 className="mt-3 text-lg font-semibold">
              <Link
                href={`${href(page, values)}&document=${encodeURIComponent(item.id)}`}
                className="hover:text-emerald-300"
              >
                {item.title}
              </Link>
            </h2>
            <div className="mt-3 grid gap-2 text-sm text-[var(--muted)] sm:grid-cols-4">
              <span>
                {copy.documentType}: {item.document_type}
              </span>
              <span>
                {copy.published}:{" "}
                {item.published_at
                  ? formatDateTime(item.published_at, locale)
                  : copy.unknown}
              </span>
              <span>
                {copy.observed}:{" "}
                {formatDateTime(item.first_observed_at, locale)}
              </span>
              <span>
                {copy.fetched}: {formatDateTime(item.last_fetched_at, locale)}
              </span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-amber-200">
              <History className="size-4" />
              {copy.version} {item.current_version.version_number} ·{" "}
              {copy.notAnalyzed}
            </div>
          </article>
        ))}
      </section>
      <nav className="mt-6 flex justify-between text-sm">
        {page > 1 ? (
          <Link href={href(page - 1, values)}>{copy.previous}</Link>
        ) : (
          <span />
        )}
        {page < documents.pagination.total_pages && (
          <Link href={href(page + 1, values)}>{copy.next}</Link>
        )}
      </nav>
    </main>
  );
}
