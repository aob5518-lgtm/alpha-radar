import type {
  CanonicalEvent,
  EventImportance,
  EventListResponse,
} from "@alpha-radar/types/events";

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export async function getEvents(query: {
  start?: string;
  end?: string;
  importance?: EventImportance[];
  assetId?: string;
  pageSize?: number;
}): Promise<EventListResponse> {
  const params = new URLSearchParams({
    page: "1",
    page_size: String(query.pageSize ?? 100),
  });
  if (query.start) params.set("start", query.start);
  if (query.end) params.set("end", query.end);
  if (query.assetId) params.set("asset_id", query.assetId);
  for (const importance of query.importance ?? ["critical", "high"]) {
    params.append("importance", importance);
  }
  const response = await fetch(`${apiUrl}/api/v1/events?${params}`, {
    next: { revalidate: 60 },
  });
  if (!response.ok) throw new Error(`Events API failed: ${response.status}`);
  return (await response.json()) as EventListResponse;
}

export async function getRecentEventsForAsset(
  assetId: string,
): Promise<CanonicalEvent[]> {
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const end = new Date(now.getTime() + 14 * 86_400_000).toISOString();
  return (
    await getEvents({ start, end, assetId, importance: ["critical", "high"] })
  ).items;
}
