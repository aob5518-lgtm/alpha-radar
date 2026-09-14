import type { AssetStatus, AssetType } from "@alpha-radar/types/assets";

import type { Messages } from "./messages";

export function assetTypeLabel(
  assetType: AssetType,
  messages: Messages,
): string {
  return messages.labels.assetTypes[assetType];
}

export function assetStatusLabel(
  assetStatus: AssetStatus,
  messages: Messages,
): string {
  return messages.labels.assetStatuses[assetStatus];
}
