import enMessages from "../../../messages/en.json";
import zhCnMessages from "../../../messages/zh-CN.json";

import type { Locale } from "./config";

export interface Messages {
  common: {
    appName: string;
    notAvailable: string;
    tryAgain: string;
  };
  home: {
    status: string;
    title: string;
    description: string;
    currentPhase: string;
    phaseName: string;
    exploreAssets: string;
  };
  assets: {
    title: string;
    description: string;
    countLabel: string;
    searchLabel: string;
    searchPlaceholder: string;
    filterByType: string;
    allTypes: string;
    apply: string;
    emptyTitle: string;
    emptyDescription: string;
    notClassified: string;
    classificationUnavailable: string;
    canonicalUuid: string;
    backToDirectory: string;
    backToAssets: string;
    notFoundTitle: string;
    notFoundDescription: string;
    errorTitle: string;
    errorDescription: string;
    loading: string;
    paginationLabel: string;
    pageStatus: string;
    previousPage: string;
    nextPage: string;
    columns: {
      symbol: string;
      name: string;
      type: string;
      sectorChain: string;
    };
    overview: {
      title: string;
      slug: string;
      status: string;
      providerMappings: string;
    };
    sections: {
      market: string;
      events: string;
      catalysts: string;
      fundamentals: string;
      capitalFlow: string;
      narratives: string;
      risk: string;
      notIntegratedDescription: string;
    };
  };
  market: {
    sourcedData: string;
    latestPrice: string;
    quoteCurrency: string;
    provider: string;
    lastUpdated: string;
    quoteUnavailable: string;
    historyUnavailable: string;
    performanceUnavailable: string;
    chartLabel: string;
    freshness: {
      fresh: string;
      stale: string;
    };
  };
  labels: {
    assetTypes: Record<
      | "crypto"
      | "equity"
      | "etf"
      | "commodity"
      | "currency"
      | "bond"
      | "index"
      | "macro",
      string
    >;
    assetStatuses: Record<"active" | "inactive" | "delisted", string>;
  };
  language: {
    label: string;
    english: string;
    simplifiedChinese: string;
  };
}

const catalogs: Record<Locale, Messages> = {
  en: enMessages as Messages,
  "zh-CN": zhCnMessages as Messages,
};

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}

export function formatMessage(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
