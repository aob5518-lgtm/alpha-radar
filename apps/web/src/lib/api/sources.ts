import type {
  SourceDocument,
  SourceDocumentListResponse,
  SourceListResponse,
  SourceType,
} from "@alpha-radar/types/sources";

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Source API returned ${response.status}`);
  return (await response.json()) as T;
}

export interface DocumentQuery {
  page?: number;
  source?: string;
  sourceType?: SourceType;
  documentType?: string;
  search?: string;
}

export async function getSources(): Promise<SourceListResponse> {
  return request<SourceListResponse>("/api/v1/sources?page_size=100");
}

export async function getDocuments(
  query: DocumentQuery,
): Promise<SourceDocumentListResponse> {
  const params = new URLSearchParams({
    page: String(query.page ?? 1),
    page_size: "20",
  });
  if (query.source) params.set("source", query.source);
  if (query.sourceType) params.set("source_type", query.sourceType);
  if (query.documentType) params.set("document_type", query.documentType);
  if (query.search) params.set("search", query.search);
  return request<SourceDocumentListResponse>(
    `/api/v1/documents?${params.toString()}`,
  );
}

export async function getDocument(id: string): Promise<SourceDocument | null> {
  const response = await fetch(
    `${apiUrl}/api/v1/documents/${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Source API returned ${response.status}`);
  return (await response.json()) as SourceDocument;
}
