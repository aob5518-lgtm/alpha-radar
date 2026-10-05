import type {
  CanonicalEvent,
  EventImportance,
  EventAction,
  EventConfidence,
  EventStatus,
  OpportunitySignal,
} from "@alpha-radar/types/events";

import type { Locale } from "@/lib/i18n/config";

export interface EventPresentation {
  title: string;
  eventType: string;
  status: string;
  importance: string;
  summary: string;
  signal: string | null;
  whyItMatters: string;
  risk: string | null;
  action: string | null;
  confidence: string | null;
  opportunitySignal: string | null;
  contractAddress: string | null;
  bullCase: string | null;
  bearCase: string | null;
  watchNext: string[];
  sourceNames: Record<string, string>;
}

export function resolveSelectedEvent(
  filtered: CanonicalEvent[],
  selectedId: string | null,
): CanonicalEvent | null {
  if (selectedId === null) return null;
  return filtered.find((event) => event.id === selectedId) ?? null;
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
      signal: event.signal,
      whyItMatters: event.why_it_matters,
      risk: event.risk,
      action: event.recommended_action
        ? actionEn[event.recommended_action]
        : null,
      confidence: event.confidence,
      opportunitySignal: event.opportunity_signal
        ? opportunityEn[event.opportunity_signal]
        : null,
      contractAddress: event.contract_address,
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
  if (event.category === "crypto") {
    const isSocial = event.sources.some(
      (source) =>
        source.source_type === "social" || source.evidence_role === "signal",
    );
    return {
      title: `${cryptoEventTypeZh[event.event_type] ?? "加密事件"} · ${event.title}`,
      eventType: cryptoEventTypeZh[event.event_type] ?? "加密事件",
      status: statusZh[event.status],
      importance: importanceZh[event.importance],
      summary: isSocial
        ? `事实：已配置并验证的监控账号发布了“${event.title}”。该事实仅描述帖子本身。`
        : `事实：${primarySource}发布了“${event.title}”。`,
      signal: isSocial
        ? "信号：短期关注度可能提升；该社交帖子仍属于注意力信号。"
        : `信号：该官方公告被归类为${cryptoEventTypeZh[event.event_type] ?? "加密市场"}信号。`,
      whyItMatters: isSocial
        ? "分析：关注度可能带来波动，但单条社交帖子本身不会改变项目基本面。"
        : "分析：事件可能改变市场关注或预期，但必须由价格、成交量与市场结构确认实际影响。",
      risk: isSocial
        ? "风险：不得把单条社交帖子当作充分确认，也不得据此推断代币发行或价格上涨。"
        : "风险：官方公告不保证采用率、流动性或价格上涨；应核对公告原文与后续执行。",
      action: event.recommended_action
        ? actionZh[event.recommended_action]
        : null,
      confidence: event.confidence ? confidenceZh[event.confidence] : null,
      opportunitySignal: event.opportunity_signal
        ? opportunityZh[event.opportunity_signal]
        : null,
      contractAddress: event.contract_address,
      bullCase: null,
      bearCase: null,
      watchNext: ["核对官方公告细节", "观察价格、成交量与既有技术位是否确认"],
      sourceNames,
    };
  }
  return {
    title: localizeTitle(event),
    eventType: eventTypeZh[event.event_type] ?? "金融事件",
    status: statusZh[event.status],
    importance: importanceZh[event.importance],
    summary: `事实：${primarySource}已列出该项发布或会议安排。`,
    signal: null,
    whyItMatters: "分析：该宏观或政策事件可能显著改变利率预期与风险资产定价。",
    risk: null,
    action: null,
    confidence: null,
    opportunitySignal: null,
    contractAddress: null,
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

const actionEn: Record<EventAction, string> = {
  watch: "Watch",
  research: "Research",
  prepare: "Prepare",
  wait_for_confirmation: "Wait for confirmation",
  caution: "Use caution",
  avoid: "Avoid",
};

const actionZh: Record<EventAction, string> = {
  watch: "关注",
  research: "研究",
  prepare: "准备",
  wait_for_confirmation: "等待确认",
  caution: "谨慎",
  avoid: "回避",
};

const confidenceZh: Record<EventConfidence, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const opportunityEn: Record<OpportunitySignal, string> = {
  none: "None",
  watch: "Watch",
  research: "Research",
  prepare: "Prepare",
  wait: "Wait",
  avoid: "Avoid",
};

const opportunityZh: Record<OpportunitySignal, string> = {
  none: "无",
  watch: "关注",
  research: "研究",
  prepare: "准备",
  wait: "等待",
  avoid: "回避",
};

const cryptoEventTypeZh: Record<string, string> = {
  project_update: "项目更新",
  protocol_upgrade: "协议升级",
  mainnet_launch: "主网上线",
  token_launch: "代币上线",
  token_unlock: "代币解锁",
  exchange_listing: "交易所上线",
  exchange_delisting: "交易所下线",
  security_incident: "安全事件",
  governance: "治理",
  regulation_crypto: "加密监管",
  etf_crypto: "加密 ETF",
  influential_social: "影响力社交信号",
  meme_launch: "Meme 项目上线",
  narrative_signal: "叙事信号",
};

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
