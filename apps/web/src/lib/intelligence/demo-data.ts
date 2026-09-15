import type {
  LocalizedText,
  RadarAsset,
  RadarItem,
  SourceRecord,
} from "@alpha-radar/types/radar";

const text = (en: string, zhCN: string): LocalizedText => ({
  en,
  "zh-CN": zhCN,
});

export const DEMO_REFERENCE_TIME = "2026-01-15T14:00:00.000Z";

export const demoAssets = {
  bitcoin: {
    assetId: "823a85ed-d36d-58e1-a56d-2e2a3bf1a887",
    slug: "bitcoin",
    symbol: "BTC",
    name: text("Bitcoin", "比特币"),
    assetType: "crypto",
  },
  ethereum: {
    assetId: "16771f65-9bf5-5529-89ae-f467b84da93d",
    slug: "ethereum",
    symbol: "ETH",
    name: text("Ethereum", "以太坊"),
    assetType: "crypto",
  },
  solana: {
    assetId: "273227db-34dd-588c-a0c8-8b21a80c14e3",
    slug: "solana",
    symbol: "SOL",
    name: text("Solana", "Solana"),
    assetType: "crypto",
  },
  nvidia: {
    assetId: "1531bef4-b790-55c1-b283-12ac6e4c8fac",
    slug: "nvidia",
    symbol: "NVDA",
    name: text("NVIDIA", "英伟达"),
    assetType: "equity",
  },
  coinbase: {
    assetId: "ee819928-5b63-5318-876c-0c31abb98810",
    slug: "coinbase-global",
    symbol: "COIN",
    name: text("Coinbase", "Coinbase"),
    assetType: "equity",
  },
  ibit: {
    assetId: "d2d50253-70f3-52c8-ae06-fb49254d0015",
    slug: "ishares-bitcoin-trust-etf",
    symbol: "IBIT",
    name: text("iShares Bitcoin Trust ETF", "iShares 比特币信托 ETF"),
    assetType: "etf",
  },
  spy: {
    assetId: "f4381144-2e90-5a63-97c7-c361ece723e4",
    slug: "spdr-sp-500-etf-trust",
    symbol: "SPY",
    name: text("SPDR S&P 500 ETF Trust", "SPDR 标普 500 ETF"),
    assetType: "etf",
  },
  qqq: {
    assetId: "cc5ec3b7-dc27-51c5-b9d2-aec67b22cf4b",
    slug: "invesco-qqq-trust",
    symbol: "QQQ",
    name: text("Invesco QQQ Trust", "Invesco QQQ 信托"),
    assetType: "etf",
  },
  dxy: {
    assetId: "ce3d14ef-6069-5aa6-8387-175f12e6f099",
    slug: "us-dollar-index",
    symbol: "DXY",
    name: text("US Dollar Index", "美元指数"),
    assetType: "index",
  },
  us10y: {
    assetId: "e68cd69f-599f-540e-98ff-3e0d4f113f90",
    slug: "us-10-year-treasury-yield",
    symbol: "US10Y",
    name: text("US 10-Year Treasury Yield", "美国十年期国债收益率"),
    assetType: "macro",
  },
} satisfies Record<string, RadarAsset>;

const source = (
  id: string,
  name: string,
  tier: SourceRecord["tier"],
): SourceRecord => ({
  id,
  name,
  tier,
  isDemo: true,
});

export const demoRadarItems: RadarItem[] = [
  {
    id: "demo-fed-path",
    title: text(
      "Policy-path scenario shifts the cross-asset map",
      "政策路径情景改变跨资产影响图",
    ),
    summary: text(
      "A simulated central-bank communication scenario tests how lower-rate expectations could propagate through duration, the dollar, and risk assets.",
      "模拟的央行沟通情景用于测试降息预期如何通过久期、美元与风险资产传导。",
    ),
    eventType: "macro",
    status: "breaking",
    eventTime: "2026-01-15T13:45:00.000Z",
    publishedAt: "2026-01-15T13:38:00.000Z",
    detectedAt: "2026-01-15T13:40:00.000Z",
    importance: "high",
    confidence: "medium",
    pricedIn: "partial",
    assets: [
      demoAssets.us10y,
      demoAssets.dxy,
      demoAssets.spy,
      demoAssets.bitcoin,
    ],
    impacts: [
      {
        assetId: demoAssets.us10y.assetId,
        symbol: "US10Y",
        direction: "bearish",
        impact: "high",
        horizon: "intraday",
        order: "first",
        confidence: "medium",
      },
      {
        assetId: demoAssets.dxy.assetId,
        symbol: "DXY",
        direction: "bearish",
        impact: "medium",
        horizon: "short",
        order: "first",
        confidence: "medium",
      },
      {
        assetId: demoAssets.spy.assetId,
        symbol: "SPY",
        direction: "bullish",
        impact: "medium",
        horizon: "short",
        order: "second",
        confidence: "medium",
      },
      {
        assetId: demoAssets.bitcoin.assetId,
        symbol: "BTC",
        direction: "bullish",
        impact: "medium",
        horizon: "short",
        order: "second",
        confidence: "low",
      },
    ],
    sourceCount: 2,
    sources: [
      source("fed-sample", "Federal Reserve", "primary"),
      source("reuters-sample", "Reuters", "major_media"),
    ],
    isBreaking: true,
    isDemo: true,
    updatedAt: "2026-01-15T13:52:00.000Z",
    whatChanged: text(
      "The sample path now implies an earlier first cut.",
      "演示路径现在假设首次降息时间提前。",
    ),
    watchNext: text(
      "Watch the simulated yield-curve response and confirmation breadth.",
      "观察模拟收益率曲线反应及确认广度。",
    ),
    risks: text(
      "Inflation persistence would challenge the illustrative easing path.",
      "通胀持续性可能推翻这一演示性宽松路径。",
    ),
    blocks: [
      {
        kind: "fact",
        content: text(
          "Demo input: a fictional policy statement is available for analysis.",
          "演示输入：一份虚构政策声明可供分析。",
        ),
      },
      {
        kind: "analysis",
        content: text(
          "Lower expected policy rates may reduce discount rates and pressure the dollar.",
          "较低的政策利率预期可能降低贴现率并对美元构成压力。",
        ),
      },
      {
        kind: "scenario",
        content: text(
          "If rates reprice lower, duration-sensitive assets could respond first.",
          "若利率重新向下定价，久期敏感资产可能率先反应。",
        ),
      },
    ],
    relatedEventIds: ["demo-etf-flow"],
    narrative: "liquidity",
  },
  {
    id: "demo-crypto-rule",
    title: text(
      "Digital-asset custody rule enters review scenario",
      "数字资产托管规则进入审议情景",
    ),
    summary: text(
      "A fictional regulatory review illustrates direct effects on crypto intermediaries and second-order effects on major tokens.",
      "虚构监管审议用于展示其对加密中介机构的直接影响，以及对主要代币的二阶影响。",
    ),
    eventType: "regulation",
    status: "developing",
    eventTime: "2026-01-15T12:20:00.000Z",
    detectedAt: "2026-01-15T12:28:00.000Z",
    importance: "high",
    confidence: "high",
    pricedIn: "not_priced",
    assets: [demoAssets.coinbase, demoAssets.bitcoin, demoAssets.ethereum],
    impacts: [
      {
        assetId: demoAssets.coinbase.assetId,
        symbol: "COIN",
        direction: "mixed",
        impact: "high",
        horizon: "medium",
        order: "first",
        confidence: "high",
      },
      {
        assetId: demoAssets.bitcoin.assetId,
        symbol: "BTC",
        direction: "mixed",
        impact: "medium",
        horizon: "medium",
        order: "second",
        confidence: "medium",
      },
      {
        assetId: demoAssets.ethereum.assetId,
        symbol: "ETH",
        direction: "mixed",
        impact: "medium",
        horizon: "medium",
        order: "second",
        confidence: "medium",
      },
    ],
    sourceCount: 2,
    sources: [
      source("sec-sample", "SEC", "primary"),
      source("specialist-sample", "Sample Regulatory Desk", "specialist"),
    ],
    isBreaking: false,
    isDemo: true,
    whatChanged: text(
      "The fictional review window was extended.",
      "虚构审议窗口已延长。",
    ),
    watchNext: text(
      "Watch for a sample implementation timetable.",
      "关注演示性实施时间表。",
    ),
    risks: text(
      "Final language could differ materially from the simulated draft.",
      "最终文本可能与模拟草案存在重大差异。",
    ),
    blocks: [
      {
        kind: "fact",
        content: text(
          "Demo input: a fictional consultation document is under review.",
          "演示输入：一份虚构咨询文件正在审议。",
        ),
      },
      {
        kind: "analysis",
        content: text(
          "Compliance costs and institutional access could move in opposite directions.",
          "合规成本与机构准入可能朝相反方向变化。",
        ),
      },
      {
        kind: "scenario",
        content: text(
          "Clearer rules could favor scaled intermediaries over smaller operators.",
          "更清晰的规则可能利好大型中介机构而不利于小型运营商。",
        ),
      },
    ],
    relatedEventIds: ["demo-etf-flow"],
    narrative: "regulatory_clarity",
  },
  {
    id: "demo-etf-flow",
    title: text(
      "ETF allocation rotation tests crypto beta",
      "ETF 配置轮动测试加密资产贝塔",
    ),
    summary: text(
      "A synthetic flow pattern illustrates how ETF demand may transmit to the underlying asset and listed intermediaries.",
      "合成资金流模式用于展示 ETF 需求如何传导至底层资产与上市中介机构。",
    ),
    eventType: "etf",
    status: "confirmed",
    eventTime: "2026-01-15T10:30:00.000Z",
    detectedAt: "2026-01-15T10:35:00.000Z",
    importance: "medium",
    confidence: "high",
    pricedIn: "mostly_priced",
    assets: [demoAssets.ibit, demoAssets.bitcoin, demoAssets.coinbase],
    impacts: [
      {
        assetId: demoAssets.ibit.assetId,
        symbol: "IBIT",
        direction: "bullish",
        impact: "medium",
        horizon: "short",
        order: "first",
        confidence: "high",
      },
      {
        assetId: demoAssets.bitcoin.assetId,
        symbol: "BTC",
        direction: "bullish",
        impact: "medium",
        horizon: "short",
        order: "first",
        confidence: "high",
      },
      {
        assetId: demoAssets.coinbase.assetId,
        symbol: "COIN",
        direction: "bullish",
        impact: "low",
        horizon: "medium",
        order: "second",
        confidence: "medium",
      },
    ],
    sourceCount: 2,
    sources: [
      source("issuer-sample", "Sample ETF Issuer", "primary"),
      source("terminal-sample", "Sample Flow Monitor", "specialist"),
    ],
    isBreaking: false,
    isDemo: true,
    whatChanged: text(
      "The synthetic flow series broadened across two sessions.",
      "合成资金流序列已扩展至两个交易时段。",
    ),
    watchNext: text(
      "Watch persistence rather than a single sample observation.",
      "关注持续性，而非单一演示观测。",
    ),
    risks: text(
      "Synthetic flows do not establish future demand.",
      "合成资金流不能证明未来需求。",
    ),
    blocks: [
      {
        kind: "fact",
        content: text(
          "Demo input: a synthetic allocation series is positive.",
          "演示输入：合成配置序列为正。",
        ),
      },
      {
        kind: "analysis",
        content: text(
          "Persistent creations could tighten available spot liquidity.",
          "持续申购可能收紧现货流动性。",
        ),
      },
      {
        kind: "model_output",
        content: text(
          "Illustrative confidence rises when breadth and persistence agree.",
          "当广度与持续性一致时，演示置信度上升。",
        ),
      },
    ],
    relatedEventIds: ["demo-fed-path", "demo-crypto-rule"],
    narrative: "institutional_adoption",
  },
  {
    id: "demo-ai-capex",
    title: text(
      "AI infrastructure spending scenario broadens",
      "AI 基础设施支出情景扩大",
    ),
    summary: text(
      "A sample earnings scenario maps first-order semiconductor demand to second-order index exposure.",
      "演示财报情景把半导体需求的一阶影响映射至指数敞口的二阶影响。",
    ),
    eventType: "earnings",
    status: "confirmed",
    eventTime: "2026-01-14T19:00:00.000Z",
    detectedAt: "2026-01-14T19:05:00.000Z",
    importance: "high",
    confidence: "medium",
    pricedIn: "partial",
    assets: [demoAssets.nvidia, demoAssets.qqq, demoAssets.spy],
    impacts: [
      {
        assetId: demoAssets.nvidia.assetId,
        symbol: "NVDA",
        direction: "bullish",
        impact: "high",
        horizon: "medium",
        order: "first",
        confidence: "medium",
      },
      {
        assetId: demoAssets.qqq.assetId,
        symbol: "QQQ",
        direction: "bullish",
        impact: "medium",
        horizon: "medium",
        order: "second",
        confidence: "medium",
      },
      {
        assetId: demoAssets.spy.assetId,
        symbol: "SPY",
        direction: "bullish",
        impact: "low",
        horizon: "medium",
        order: "second",
        confidence: "low",
      },
    ],
    sourceCount: 2,
    sources: [
      source("filing-sample", "Sample Company Filing", "primary"),
      source("media-sample", "Sample Major Media", "major_media"),
    ],
    isBreaking: false,
    isDemo: true,
    watchNext: text(
      "Watch sample order conversion and margin sensitivity.",
      "关注演示订单转化与利润率敏感性。",
    ),
    risks: text(
      "Capacity constraints or slower deployment could weaken the scenario.",
      "产能限制或部署放缓可能削弱该情景。",
    ),
    blocks: [
      {
        kind: "fact",
        content: text(
          "Demo input: fictional guidance increases infrastructure allocation.",
          "演示输入：虚构指引提高了基础设施配置。",
        ),
      },
      {
        kind: "analysis",
        content: text(
          "Direct suppliers may have greater sensitivity than broad indices.",
          "直接供应商的敏感度可能高于宽基指数。",
        ),
      },
      {
        kind: "scenario",
        content: text(
          "A slower deployment cadence would reduce second-order effects.",
          "部署节奏放缓将减弱二阶影响。",
        ),
      },
    ],
    relatedEventIds: [],
    narrative: "ai_infrastructure",
  },
  {
    id: "demo-exchange-liquidity",
    title: text(
      "Crypto liquidity fragments across venues",
      "加密流动性在交易场所间分化",
    ),
    summary: text(
      "A simulated market-structure signal highlights execution risk without presenting live order-book data.",
      "模拟市场结构信号突出执行风险，但不展示实时订单簿数据。",
    ),
    eventType: "market_structure",
    status: "developing",
    detectedAt: "2026-01-13T09:00:00.000Z",
    importance: "medium",
    confidence: "medium",
    pricedIn: "unknown",
    assets: [demoAssets.bitcoin, demoAssets.ethereum, demoAssets.solana],
    impacts: [
      {
        assetId: demoAssets.bitcoin.assetId,
        symbol: "BTC",
        direction: "neutral",
        impact: "medium",
        horizon: "intraday",
        order: "first",
        confidence: "medium",
      },
      {
        assetId: demoAssets.ethereum.assetId,
        symbol: "ETH",
        direction: "neutral",
        impact: "medium",
        horizon: "intraday",
        order: "first",
        confidence: "medium",
      },
      {
        assetId: demoAssets.solana.assetId,
        symbol: "SOL",
        direction: "bearish",
        impact: "low",
        horizon: "intraday",
        order: "second",
        confidence: "low",
      },
    ],
    sourceCount: 1,
    sources: [
      source(
        "structure-sample",
        "Sample Market Structure Monitor",
        "specialist",
      ),
    ],
    isBreaking: false,
    isDemo: true,
    whatChanged: text(
      "The demo spread dispersion moved above its fixed threshold.",
      "演示价差离散度超过固定阈值。",
    ),
    watchNext: text(
      "Watch whether synthetic depth normalizes across venues.",
      "关注合成深度是否在各交易场所恢复正常。",
    ),
    risks: text(
      "The signal is synthetic and must not be used for execution.",
      "该信号为合成数据，不得用于交易执行。",
    ),
    blocks: [
      {
        kind: "fact",
        content: text(
          "Demo input: synthetic spreads diverge across venues.",
          "演示输入：各交易场所的合成价差出现分化。",
        ),
      },
      {
        kind: "analysis",
        content: text(
          "Fragmentation can increase slippage and weaken price discovery.",
          "流动性分化可能增加滑点并削弱价格发现。",
        ),
      },
    ],
    relatedEventIds: [],
    narrative: "liquidity",
  },
  {
    id: "demo-dollar-reversal",
    title: text(
      "Dollar reversal scenario reaches resolution",
      "美元反转情景进入已解决状态",
    ),
    summary: text(
      "A completed sample scenario records a neutral outcome so the shell demonstrates resolved-event history.",
      "已完成的演示情景记录中性结果，用于展示已解决事件历史。",
    ),
    eventType: "macro",
    status: "resolved",
    eventTime: "2026-01-09T16:00:00.000Z",
    detectedAt: "2026-01-09T15:45:00.000Z",
    importance: "low",
    confidence: "high",
    pricedIn: "mostly_priced",
    assets: [demoAssets.dxy, demoAssets.us10y, demoAssets.spy],
    impacts: [
      {
        assetId: demoAssets.dxy.assetId,
        symbol: "DXY",
        direction: "neutral",
        impact: "low",
        horizon: "short",
        order: "first",
        confidence: "high",
      },
      {
        assetId: demoAssets.us10y.assetId,
        symbol: "US10Y",
        direction: "neutral",
        impact: "low",
        horizon: "short",
        order: "second",
        confidence: "medium",
      },
      {
        assetId: demoAssets.spy.assetId,
        symbol: "SPY",
        direction: "neutral",
        impact: "low",
        horizon: "short",
        order: "second",
        confidence: "medium",
      },
    ],
    sourceCount: 1,
    sources: [source("macro-sample", "Sample Macro Monitor", "specialist")],
    isBreaking: false,
    isDemo: true,
    updatedAt: "2026-01-10T16:00:00.000Z",
    whatChanged: text(
      "The simulated follow-through failed to persist.",
      "模拟后续走势未能持续。",
    ),
    watchNext: text(
      "No active watch item remains for this resolved demo.",
      "此已解决演示事件不再有活跃观察项。",
    ),
    risks: text(
      "Resolved demo outcomes do not predict future market behavior.",
      "已解决的演示结果不预测未来市场行为。",
    ),
    blocks: [
      {
        kind: "fact",
        content: text(
          "Demo outcome: the synthetic threshold was not sustained.",
          "演示结果：合成阈值未能维持。",
        ),
      },
      {
        kind: "analysis",
        content: text(
          "The original sample thesis is treated as invalidated.",
          "原始演示论点被视为已失效。",
        ),
      },
    ],
    relatedEventIds: ["demo-fed-path"],
    narrative: "liquidity",
  },
];

export const allDemoAssets = Object.values(demoAssets);

export function localize(value: LocalizedText, locale: "en" | "zh-CN"): string {
  return value[locale];
}
