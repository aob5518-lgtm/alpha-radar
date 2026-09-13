import type {
  AssetDetail,
  AssetListResponse,
  AssetType,
} from "@alpha-radar/types/assets";

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export interface AssetListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  assetType?: AssetType;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw new ApiError(
      `API request failed with status ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

export function getAssets(
  query: AssetListQuery = {},
): Promise<AssetListResponse> {
  const params = new URLSearchParams();
  params.set("page", String(query.page ?? 1));
  params.set("page_size", String(query.pageSize ?? 20));
  params.set("sort_by", "symbol");
  if (query.search) params.set("search", query.search);
  if (query.assetType) params.set("asset_type", query.assetType);
  return request<AssetListResponse>(`/api/v1/assets?${params.toString()}`);
}

export async function getAsset(
  identifier: string,
): Promise<AssetDetail | null> {
  try {
    return await request<AssetDetail>(
      `/api/v1/assets/${encodeURIComponent(identifier)}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
