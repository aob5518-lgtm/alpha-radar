import type {
  CanonicalEvent,
  EventImportance,
  EventStatus,
} from "@alpha-radar/types/events";

import type { Locale } from "@/lib/i18n/config";

export interface EventPresentation {
  title: string;
  eventType: string;
  status: string;
  importance: string;
  summary: string;
  whyItMatters: string;
  bullCase: string | null;
  bearCase: string | null;
  watchNext: string[];
  sourceNames: Record<string, string>;
}

export function resolveSelectedEvent(
  filtered: CanonicalEvent[],
  selectedId: string | null,
): CanonicalEvent | null {
  return (
    filtered.find((event) => event.id === selectedId) ?? filtered[0] ?? null
  );
}

const importanceZh: Record<EventImportance, string> = {
  critical: "极高",
  high: "高",
  medium: "中",
  low: "低",
};

const statusZh: Record<EventStatus, string> = {
  rumored: "传闻",
  scheduled: "待公布",
  confirmed: "已确认",
  ongoing: "进行中",
  completed: "已公布",
  cancelled: "已取消",
  superseded: "已被替代",
};

const eventTypeZh: Record<string, string> = {
  nfp: "非农就业",
  cpi: "消费者价格指数",
  ppi: "生产者价格指数",
  gdp: "国内生产总值",
  fomc: "美联储议息会议",
};

const titleZh: Record<string, string> = {
  nfp: "美国非农就业报告",
  cpi: "美国消费者价格指数（CPI）",
  ppi: "美国生产者价格指数（PPI）",
  gdp: "美国国内生产总值（GDP）",
  fomc: "美联储 FOMC 利率会议",
};

const monthsZh: Record<string, string> = {
  January: "1 月",
  February: "2 月",
  March: "3 月",
  April: "4 月",
  May: "5 月",
  June: "6 月",
  July: "7 月",
  August: "8 月",
  September: "9 月",
  October: "10 月",
  November: "11 月",
  December: "12 月",
};

export function presentEvent(
  event: CanonicalEvent,
  locale: Locale,
): EventPresentation {
  if (locale === "en") {
    return {
      title: event.title,
      eventType: event.event_type,
      status: event.status,
      importance: event.importance,
      summary: event.summary,
      whyItMatters: event.why_it_matters,
      bullCase: event.bull_case,
      bearCase: event.bear_case,
      watchNext: event.watch_next,
      sourceNames: Object.fromEntries(
        event.sources.map((source) => [
          source.source_document_id,
          source.source_name,
        ]),
      ),
    };
  }

  const sourceNames = Object.fromEntries(
    event.sources.map((source) => [
      source.source_document_id,
      localizeSourceName(source.source_name),
    ]),
  );
  const primarySource = Object.values(sourceNames)[0] ?? "官方来源";
  return {
    title: localizeTitle(event),
    eventType: eventTypeZh[event.event_type] ?? "金融事件",
    status: statusZh[event.status],
    importance: importanceZh[event.importance],
    summary: `事实：${primarySource}已列出该项发布或会议安排。`,
    whyItMatters: "分析：该宏观或政策事件可能显著改变利率预期与风险资产定价。",
    bullCase: event.bull_case
      ? "情景：若结果偏温和，风险偏好可能获得支持；此处不预设结果。"
      : null,
    bearCase: event.bear_case
      ? "情景：若结果偏不利，风险资产可能承压；此处不预设结果。"
      : null,
    watchNext: event.watch_next.map((_, index) =>
      index === 0 ? "官方数据或政策声明" : "公布后的市场反应",
    ),
    sourceNames,
  };
}

function localizeTitle(event: CanonicalEvent): string {
  const base = titleZh[event.event_type] ?? event.title;
  const month = Object.entries(monthsZh).find(([name]) =>
    event.title.includes(name),
  );
  const year = event.title.match(/\b(20\d{2})\b/)?.[1];
  const quarter = event.title.match(/\bQ([1-4])\b/)?.[1];
  const estimate = event.title.includes("Advance Estimate")
    ? "初值"
    : event.title.includes("Second Estimate")
      ? "第二次估值"
      : event.title.includes("Third Estimate")
        ? "终值"
        : null;
  const period = quarter
    ? `${year ?? ""} 年第 ${quarter} 季度${estimate ? ` ${estimate}` : ""}`
    : month
      ? `${year ?? ""} 年${month[1]}`
      : "";
  return period ? `${base} — ${period}` : base;
}

function localizeSourceName(value: string): string {
  if (value.startsWith("U.S. Bureau of Labor Statistics"))
    return "美国劳工统计局（BLS）";
  if (value.startsWith("U.S. Bureau of Economic Analysis"))
    return "美国经济分析局（BEA）";
  if (value.startsWith("Federal Reserve")) return "美联储";
  return value;
}
