export const assetTypes = [
  "crypto",
  "equity",
  "etf",
  "commodity",
  "currency",
  "bond",
  "index",
  "macro",
] as const;

export type AssetType = (typeof assetTypes)[number];
export type AssetStatus = "active" | "inactive" | "delisted";

export interface AssetSummary {
  id: string;
  symbol: string;
  slug: string;
  name: string;
  asset_type: AssetType;
  sector: string | null;
  industry: string | null;
  chain: string | null;
  country: string | null;
  market_cap: string | null;
  status: AssetStatus;
}

export interface AssetProviderMapping {
  id: string;
  provider: string;
  provider_asset_id: string;
  provider_symbol: string | null;
  metadata: Record<string, unknown>;
}

export interface AssetAlias {
  id: string;
  alias: string;
  alias_type: string | null;
  normalized_alias: string;
}

export interface AssetDetail extends AssetSummary {
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  provider_mappings: AssetProviderMapping[];
  aliases: AssetAlias[];
}

export interface PaginationMetadata {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface AssetListResponse {
  items: AssetSummary[];
  pagination: PaginationMetadata;
}
