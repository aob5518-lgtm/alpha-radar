import type {
  AssetDetail,
  AssetListResponse,
  AssetType,
} from "@alpha-radar/types/assets";
import type {
  MarketHistory,
  MarketInterval,
  MarketQuote,
} from "@alpha-radar/types/market-data";

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

export async function getMarketQuote(
  identifier: string,
): Promise<MarketQuote | null> {
  try {
    return await request<MarketQuote>(
      `/api/v1/assets/${encodeURIComponent(identifier)}/quote`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getMarketHistory(
  identifier: string,
  interval: MarketInterval = "1h",
  limit = 48,
): Promise<MarketHistory | null> {
  try {
    const params = new URLSearchParams({
      interval,
      limit: String(limit),
    });
    return await request<MarketHistory>(
      `/api/v1/assets/${encodeURIComponent(identifier)}/history?${params.toString()}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
