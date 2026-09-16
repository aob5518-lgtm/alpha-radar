export const sourceTypes = [
  "government",
  "regulator",
  "central_bank",
  "company",
  "exchange",
  "media",
  "specialist_media",
  "protocol",
  "social",
] as const;
export type SourceType = (typeof sourceTypes)[number];

export type SourceTier = "primary" | "major_media" | "specialist" | "social";
export type LicenseClass =
  | "public_official"
  | "metadata_only"
  | "excerpt_allowed"
  | "licensed"
  | "unknown"
  | "restricted";

export interface Source {
  id: string;
  slug: string;
  name: string;
  source_type: SourceType;
  source_tier: SourceTier;
  provider: string;
  base_url: string;
  language: string | null;
  status: string;
  latency_class: string;
  license_class: LicenseClass;
  terms_url: string | null;
}

export interface SourceDocumentVersion {
  id: string;
  version_number: number;
  content_hash: string;
  title: string;
  summary: string | null;
  excerpt: string | null;
  published_at: string | null;
  publisher_updated_at: string | null;
  observed_at: string;
  fetched_at: string;
  ingested_at: string;
}

export interface SourceDocument {
  id: string;
  source_id: string;
  external_id: string | null;
  canonical_url: string;
  document_type: string;
  title: string;
  author: string | null;
  language: string | null;
  published_at: string | null;
  publisher_updated_at: string | null;
  first_observed_at: string;
  last_observed_at: string;
  first_fetched_at: string;
  last_fetched_at: string;
  ingested_at: string;
  status: string;
  source: Source;
  current_version: SourceDocumentVersion;
}

export interface Pagination {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface SourceListResponse {
  items: Source[];
  pagination: Pagination;
}

export interface SourceDocumentListResponse {
  items: SourceDocument[];
  pagination: Pagination;
}
