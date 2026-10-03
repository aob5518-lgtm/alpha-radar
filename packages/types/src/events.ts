export type EventImportance = "critical" | "high" | "medium" | "low";
export type EventStatus =
  | "rumored"
  | "scheduled"
  | "confirmed"
  | "ongoing"
  | "completed"
  | "cancelled"
  | "superseded";

export interface EventAsset {
  id: string;
  symbol: string;
  slug: string;
  name: string;
}

export interface EventSource {
  source_id: string;
  source_document_id: string;
  source_name: string;
  title: string;
  canonical_url: string;
  published_at: string | null;
}

export interface CanonicalEvent {
  id: string;
  title: string;
  event_type: string;
  status: EventStatus;
  scheduled_date: string | null;
  scheduled_at: string | null;
  scheduled_timezone: string | null;
  actual_release_at: string | null;
  detected_at: string;
  updated_at: string;
  importance: EventImportance;
  summary: string;
  why_it_matters: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  affected_assets: EventAsset[];
  impact_analysis: Record<string, unknown>;
  bull_case: string | null;
  bear_case: string | null;
  watch_next: string[];
  sources: EventSource[];
}

export interface EventListResponse {
  items: CanonicalEvent[];
  pagination: {
    page: number;
    page_size: number;
    total_items: number;
    total_pages: number;
  };
}
