import type { Opportunity, Theme } from "@alpha-radar/types/strategy";
import {
  demoCatalysts,
  demoOpportunities,
  demoPlaybooks,
  demoProjects,
  demoRadarReferences,
  demoThemes,
} from "./demo-data.ts";

export const themeHref = (id: string) =>
  `/discover/themes?theme=${encodeURIComponent(id)}`;
export const opportunityHref = (id: string) =>
  `/discover/opportunities?opportunity=${encodeURIComponent(id)}`;
export const projectHref = (id: string) =>
  `/discover?project=${encodeURIComponent(id)}#projects`;
export const playbookHref = (id: string) =>
  `/strategy?playbook=${encodeURIComponent(id)}#playbooks`;
export const catalystHref = (id: string) =>
  `/strategy?catalyst=${encodeURIComponent(id)}#catalysts`;
export function filterThemes(themes: readonly Theme[], stage?: string) {
  return themes.filter((theme) => !stage || theme.stage === stage);
}
export function filterOpportunities(
  items: readonly Opportunity[],
  filters: {
    themeId?: string;
    stage?: string;
    type?: string;
    assetId?: string;
  },
) {
  return items.filter(
    (item) =>
      (!filters.themeId || item.themeId === filters.themeId) &&
      (!filters.stage || item.stage === filters.stage) &&
      (!filters.type || item.opportunityType === filters.type) &&
      (!filters.assetId || item.affectedAssetIds.includes(filters.assetId)),
  );
}
export function strategyForAsset(assetId: string) {
  const opportunities = filterOpportunities(demoOpportunities, { assetId });
  const themeIds = new Set(opportunities.map((item) => item.themeId));
  return {
    opportunities,
    themes: demoThemes.filter((theme) => themeIds.has(theme.id)),
    catalysts: demoCatalysts.filter((item) =>
      item.affectedAssetIds.includes(assetId),
    ),
    playbooks: demoPlaybooks.filter((item) =>
      opportunities.some(
        (opportunity) => opportunity.id === item.opportunityId,
      ),
    ),
  };
}
export function strategyForEvent(eventId: string) {
  const reference = demoRadarReferences.find(
    (item) => item.eventId === eventId,
  );
  return {
    themes: demoThemes.filter((item) => reference?.themeIds.includes(item.id)),
    opportunities: demoOpportunities.filter((item) =>
      reference?.opportunityIds.includes(item.id),
    ),
    catalysts: demoCatalysts.filter((item) =>
      reference?.catalystIds.includes(item.id),
    ),
  };
}
export function projectForId(id: string) {
  return demoProjects.find((item) => item.id === id);
}
