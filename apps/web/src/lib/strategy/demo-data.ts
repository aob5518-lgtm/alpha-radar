import type {
  AirdropOpportunity,
  BullMarketPhase,
  Catalyst,
  CycleReadiness,
  EarlyProject,
  Opportunity,
  Outcome,
  RadarStrategyReference,
  StrategicBlock,
  StrategyPlaybook,
  Theme,
} from "@alpha-radar/types/strategy";
import type { LocalizedText } from "@alpha-radar/types/radar";
import { DEMO_REFERENCE_TIME, demoAssets } from "../intelligence/demo-data.ts";

const text = (en: string, zh: string): LocalizedText => ({ en, "zh-CN": zh });
export const STRATEGY_SNAPSHOT = DEMO_REFERENCE_TIME;

/** Every FACT below is a fact about a fictional fixture, never a real-world observation. */
const blocks = (
  fact: LocalizedText,
  analysis: LocalizedText,
  counterpoint: LocalizedText,
  invalidation: LocalizedText,
): StrategicBlock[] => [
  { kind: "fact", content: fact },
  { kind: "analysis", content: analysis },
  {
    kind: "scenario",
    content: text(
      "If supporting evidence persists, prepare a research checklist; otherwise wait.",
      "若支持证据持续，可准备研究清单；否则等待。",
    ),
  },
  {
    kind: "model_output",
    content: text(
      "No model has run. All bands are fixed demo presentation values, not predictions.",
      "未运行模型。所有档位均为固定演示展示值，并非预测。",
    ),
  },
  { kind: "counterpoint", content: counterpoint },
  { kind: "invalidation", content: invalidation },
];
const commonCounter = text(
  "Attention can rise without durable demand. Growth says nothing about a fair valuation.",
  "关注度上升不代表持久需求。增长本身无法说明估值合理。",
);
const commonInvalidation = text(
  "Stop preparation if retention fails or the original evidence cannot be verified.",
  "若留存失效或原始证据无法核验，应停止准备。",
);

export const demoThemes: [Theme, Theme, Theme] = [
  {
    id: "demo-theme-stablecoins",
    slug: "stablecoins",
    name: text("Stablecoins", "稳定币"),
    description: text(
      "A fictional settlement-adoption theme, not a current market ranking.",
      "虚构的结算采用主题，不代表当前市场排名。",
    ),
    stage: "early",
    metrics: {
      attention: "low",
      acceleration: "high",
      capitalFlow: "medium",
      fundamentals: "high",
      userGrowth: "medium",
      developerActivity: "medium",
      institutionalInterest: "medium",
      regulatoryTailwind: "low",
      crowding: "low",
    },
    isDemo: true,
    blocks: blocks(
      text(
        "Demo fixture: a fictional settlement prototype is in testnet.",
        "演示记录：虚构结算原型处于测试网阶段。",
      ),
      text(
        "Fundamentals acceleration with attention lag is a research hypothesis, not an investment signal.",
        "基本面加速与关注度滞后只是研究假设，并非投资信号。",
      ),
      commonCounter,
      commonInvalidation,
    ),
  },
  {
    id: "demo-theme-rwa",
    slug: "rwa",
    name: text("RWA / Tokenized Assets", "RWA / 代币化资产"),
    description: text(
      "An illustrative custody and distribution theme.",
      "用于展示托管与分发的模拟主题。",
    ),
    stage: "accelerating",
    metrics: {
      attention: "medium",
      acceleration: "high",
      capitalFlow: "medium",
      fundamentals: "medium",
      userGrowth: "low",
      developerActivity: "medium",
      institutionalInterest: "high",
      regulatoryTailwind: "medium",
      crowding: "medium",
    },
    isDemo: true,
    blocks: blocks(
      text(
        "Demo fixture: custody review is linked to this theme.",
        "演示记录：托管审议与此主题关联。",
      ),
      text(
        "Access and compliance costs may move in opposite directions.",
        "准入与合规成本可能朝相反方向变化。",
      ),
      text(
        "Legal complexity can outweigh distribution gains.",
        "法律复杂性可能抵消分发收益。",
      ),
      text(
        "Invalidate if simulated custody assumptions fail.",
        "若模拟托管假设失效，则论点失效。",
      ),
    ),
  },
  {
    id: "demo-theme-perps",
    slug: "perpetual-dex",
    name: text("Perpetual DEX", "永续合约 DEX"),
    description: text(
      "A fictional execution-quality theme with crowding risk.",
      "存在拥挤风险的虚构执行质量主题。",
    ),
    stage: "crowded",
    metrics: {
      attention: "high",
      acceleration: "medium",
      capitalFlow: "low",
      fundamentals: "medium",
      userGrowth: "high",
      developerActivity: "high",
      institutionalInterest: "low",
      regulatoryTailwind: "low",
      crowding: "high",
    },
    isDemo: true,
    blocks: blocks(
      text(
        "Demo fixture: fictional venue metrics use ordinal bands.",
        "演示记录：虚构交易场所指标使用序数档位。",
      ),
      text(
        "Compare depth and retention after incentives rather than headline volume.",
        "应比较激励结束后的深度与留存，而非表面成交量。",
      ),
      text(
        "Incentives can inflate activity and concentration.",
        "激励可能夸大活跃度与集中度。",
      ),
      text(
        "Invalidate if activity disappears after incentives.",
        "若激励结束后活跃度消失，则论点失效。",
      ),
    ),
  },
];

export const demoProjects: [EarlyProject, EarlyProject] = [
  {
    id: "demo-project-lantern",
    themeId: demoThemes[0].id,
    name: text(
      "Lantern Settlement · Fictional",
      "Lantern Settlement · 虚构项目",
    ),
    productStage: "testnet",
    tokenStatus: "tokenless",
    dimensions: {
      userGrowth: "high",
      revenueGrowth: "low",
      tvlGrowth: "medium",
      volumeGrowth: "medium",
      developerActivity: "high",
      socialAcceleration: "low",
      funding: "medium",
      competitiveMoat: "low",
      attention: "low",
    },
    isDemo: true,
    blocks: blocks(
      text(
        "Fictional testnet; no real users, revenue or funding is asserted.",
        "虚构测试网；不声称存在真实用户、收入或融资。",
      ),
      text(
        "Demo fundamentals acceleration exceeds attention; verify retention and unit economics first.",
        "演示基本面加速高于关注度；应先核验留存与单位经济。",
      ),
      commonCounter,
      commonInvalidation,
    ),
  },
  {
    id: "demo-project-orbit",
    themeId: demoThemes[2].id,
    name: text("Orbit Venue · Fictional", "Orbit Venue · 虚构项目"),
    productStage: "prototype",
    tokenStatus: "announced",
    dimensions: {
      userGrowth: "medium",
      revenueGrowth: "low",
      tvlGrowth: "low",
      volumeGrowth: "high",
      developerActivity: "medium",
      socialAcceleration: "high",
      funding: "low",
      competitiveMoat: "low",
      attention: "high",
    },
    isDemo: true,
    blocks: blocks(
      text(
        "Fictional prototype with an illustrative announced-token status.",
        "虚构原型，具有演示性的代币已公告状态。",
      ),
      text(
        "High attention and low moat justify waiting for evidence.",
        "高关注度与低壁垒意味着应等待证据。",
      ),
      text(
        "Synthetic volume may only reflect incentives.",
        "合成成交量可能仅反映激励。",
      ),
      text(
        "Invalidate if liquidity is not persistent.",
        "若流动性不持续，则论点失效。",
      ),
    ),
  },
];

export const demoCatalysts: [Catalyst, Catalyst] = [
  {
    id: "demo-catalyst-review",
    title: text("Fictional custody review window", "虚构托管审议窗口"),
    catalystType: "regulatory_vote",
    scheduledAt: "2026-02-10T14:00:00.000Z",
    dateCertainty: "tentative",
    impact: "medium",
    probabilityBand: "medium",
    pricedIn: "unknown",
    affectedAssetIds: [demoAssets.bitcoin.assetId, demoAssets.coinbase.assetId],
    preparationWindow: text(
      "Before the fictional review: compare draft assumptions and counter-evidence.",
      "虚构审议前：比较草案假设与反证。",
    ),
    status: "watching",
    isDemo: true,
    blocks: blocks(
      text(
        "The displayed date is a fixed fictional calendar fixture, not an official schedule.",
        "显示日期为固定虚构日历记录，并非官方日程。",
      ),
      text(
        "Review could affect institutional access; implementation remains uncertain.",
        "审议可能影响机构准入；实施仍不确定。",
      ),
      text(
        "Delay or a narrower scope may reduce relevance.",
        "延迟或缩小范围可能降低相关性。",
      ),
      text(
        "Invalidate if the fictional draft no longer supports the thesis.",
        "若虚构草案不再支持论点，则失效。",
      ),
    ),
  },
  {
    id: "demo-catalyst-testnet",
    title: text(
      "Lantern testnet milestone · Fictional",
      "Lantern 测试网里程碑 · 虚构",
    ),
    catalystType: "mainnet",
    scheduledAt: null,
    dateCertainty: "unknown",
    impact: "low",
    probabilityBand: "low",
    pricedIn: "unknown",
    affectedAssetIds: [demoAssets.ethereum.assetId],
    preparationWindow: text(
      "Wait for a verifiable milestone and security review; no date is assumed.",
      "等待可核验里程碑与安全审查；不假设日期。",
    ),
    status: "watching",
    isDemo: true,
    blocks: blocks(
      text(
        "Fictional project has no announced launch date.",
        "虚构项目未公告上线日期。",
      ),
      text(
        "A security-reviewed launch would be a research checkpoint, not a reward guarantee.",
        "经安全审查的上线可成为研究检查点，但不保证奖励。",
      ),
      text(
        "A testnet does not prove product-market fit.",
        "测试网不能证明产品市场契合度。",
      ),
      text(
        "Stop preparation if security assumptions fail.",
        "若安全假设失效，应停止准备。",
      ),
    ),
  },
];

export const demoOpportunities: [
  Opportunity,
  Opportunity,
  Opportunity,
  Opportunity,
] = [
  {
    id: "demo-opportunity-settlement",
    themeId: demoThemes[0].id,
    title: text("Settlement adoption research", "结算采用研究"),
    summary: text(
      "Research a fictional tokenless project with fundamentals/attention divergence.",
      "研究基本面与关注度分化的虚构无代币项目。",
    ),
    stage: "researching",
    opportunityType: "early_project",
    affectedAssetIds: [demoAssets.ethereum.assetId],
    relatedProjectIds: [demoProjects[0].id],
    catalystIds: [demoCatalysts[1].id],
    timeHorizon: "medium",
    rewardPotential: "medium",
    riskLevel: "high",
    capitalRequirement: "low",
    timeRequirement: "high",
    crowding: "low",
    confidenceBand: "low",
    thesis: text(
      "Persistent settlement use may justify deeper research after security review.",
      "安全审查后，持续结算使用可能值得深入研究。",
    ),
    counterThesis: commonCounter,
    invalidation: commonInvalidation,
    watchNext: text(
      "Monitor post-incentive retention, costs and audit evidence.",
      "观察激励后留存、成本与审计证据。",
    ),
    isDemo: true,
    blocks: blocks(
      text(
        "Fictional Lantern is tokenless; no token or airdrop is promised.",
        "虚构 Lantern 尚无代币；不承诺代币或空投。",
      ),
      text("Research utility before incentives.", "先研究效用，再研究激励。"),
      commonCounter,
      commonInvalidation,
    ),
  },
  {
    id: "demo-opportunity-custody",
    themeId: demoThemes[1].id,
    title: text("Custody second-order watch", "托管二阶影响观察"),
    summary: text(
      "Prepare a conditional institutional-access checklist, not a trade.",
      "准备有条件的机构准入清单，而非交易。",
    ),
    stage: "preparing",
    opportunityType: "second_order",
    affectedAssetIds: [demoAssets.bitcoin.assetId, demoAssets.coinbase.assetId],
    relatedProjectIds: [],
    catalystIds: [demoCatalysts[0].id],
    timeHorizon: "medium",
    rewardPotential: "medium",
    riskLevel: "high",
    capitalRequirement: "medium",
    timeRequirement: "medium",
    crowding: "medium",
    confidenceBand: "medium",
    thesis: text(
      "Clearer custody rules could reduce access friction under the demo scenario.",
      "演示情景下，更清晰的托管规则可能降低准入摩擦。",
    ),
    counterThesis: text(
      "Compliance costs may outweigh access benefits.",
      "合规成本可能超过准入收益。",
    ),
    invalidation: text(
      "Invalidate if final assumptions worsen custody economics.",
      "若最终假设恶化托管经济性，则论点失效。",
    ),
    watchNext: text(
      "Monitor scope, implementation burden and actual adoption evidence.",
      "观察范围、实施负担与实际采用证据。",
    ),
    isDemo: true,
    blocks: blocks(
      text(
        "Only a fictional review is linked; no real regulatory claim is made.",
        "仅关联虚构审议；不作真实监管事实主张。",
      ),
      text(
        "Evaluate direct and second-order effects separately.",
        "分别评估直接与二阶影响。",
      ),
      text("Compliance costs may offset benefits.", "合规成本可能抵消收益。"),
      text("Stop if access assumptions fail.", "若准入假设失效，应停止准备。"),
    ),
  },
  {
    id: "demo-opportunity-incentives",
    themeId: demoThemes[0].id,
    title: text(
      "Testnet incentive research · Speculative",
      "测试网激励研究 · 推测性",
    ),
    summary: text(
      "No announcement means no entitlement; research only.",
      "未公告意味着不存在奖励权利；仅供研究。",
    ),
    stage: "watching",
    opportunityType: "airdrop",
    affectedAssetIds: [demoAssets.ethereum.assetId],
    relatedProjectIds: [demoProjects[0].id],
    catalystIds: [demoCatalysts[1].id],
    timeHorizon: "long",
    rewardPotential: "low",
    riskLevel: "high",
    capitalRequirement: "low",
    timeRequirement: "high",
    crowding: "high",
    confidenceBand: "low",
    thesis: text(
      "A testnet may support product learning even without rewards.",
      "即使没有奖励，测试网也可能支持产品学习。",
    ),
    counterThesis: text(
      "Tokenless does not mean a future airdrop; costs may exceed any reward.",
      "无代币不代表未来空投；成本可能超过任何奖励。",
    ),
    invalidation: text(
      "Avoid if participation requires unsafe approvals or reward promises are unverifiable.",
      "若参与要求不安全授权或奖励承诺无法核验，应避免。",
    ),
    watchNext: text(
      "Wait for official terms and security evidence; do not connect a wallet here.",
      "等待官方条款与安全证据；不要在此连接钱包。",
    ),
    isDemo: true,
    blocks: blocks(
      text(
        "Fictional fixture has no announced airdrop.",
        "虚构记录未公告空投。",
      ),
      text(
        "Any reward hypothesis is speculative opportunity analysis.",
        "任何奖励假设均属推测性机会分析。",
      ),
      text(
        "Time, gas and dilution can erase hypothetical value.",
        "时间、Gas 与稀释可能抵消假设价值。",
      ),
      text(
        "Avoid unverifiable or unsafe participation.",
        "避免无法核验或不安全的参与。",
      ),
    ),
  },
  {
    id: "demo-opportunity-orbit",
    themeId: demoThemes[2].id,
    title: text("Crowded venue incentive caution", "拥挤交易场所激励警示"),
    summary: text(
      "Fictional Orbit has no distribution basis; avoid reward assumptions.",
      "虚构 Orbit 没有分发依据；避免奖励假设。",
    ),
    stage: "crowded",
    opportunityType: "airdrop",
    affectedAssetIds: [demoAssets.solana.assetId],
    relatedProjectIds: [demoProjects[1].id],
    catalystIds: [],
    timeHorizon: "short",
    rewardPotential: "low",
    riskLevel: "high",
    capitalRequirement: "medium",
    timeRequirement: "high",
    crowding: "high",
    confidenceBand: "low",
    thesis: text(
      "Research venue quality without assuming incentives.",
      "不假设激励，研究交易场所质量。",
    ),
    counterThesis: text(
      "High volume may be subsidized rather than durable.",
      "高成交量可能依赖补贴，而非持久需求。",
    ),
    invalidation: text(
      "Avoid if terms are absent or participation is unsafe.",
      "若无条款或参与不安全，应避免。",
    ),
    watchNext: text(
      "Wait for retention evidence; no distribution is assumed.",
      "等待留存证据；不假设存在分发。",
    ),
    isDemo: true,
    blocks: blocks(
      text("Fictional distribution status is none.", "虚构分发状态为无。"),
      text(
        "Crowding may make research costly without reward basis.",
        "没有奖励依据时，拥挤可能提高研究成本。",
      ),
      commonCounter,
      commonInvalidation,
    ),
  },
];

export const demoAirdrops: AirdropOpportunity[] = [
  {
    id: "demo-airdrop-lantern",
    opportunityId: demoOpportunities[2].id,
    projectId: demoProjects[0].id,
    tokenStatus: "tokenless",
    officialAirdropStatus: "not_announced",
    pointsProgram: "unknown",
    opportunityBasis: text(
      "Speculative product research only; no official reward announcement in the fictional fixture.",
      "仅为推测性产品研究；虚构记录中没有官方奖励公告。",
    ),
    capitalRequirement: "low",
    estimatedGasCostBand: "low",
    timeRequirement: "high",
    sybilRisk: "high",
    dilutionRisk: "high",
    lockupRisk: "medium",
    opportunityCost: "high",
    rewardPotential: "low",
    confidenceBand: "low",
    action: "wait",
    isDemo: true,
    blocks: demoOpportunities[2].blocks,
  },
  {
    id: "demo-airdrop-orbit",
    opportunityId: demoOpportunities[3].id,
    projectId: demoProjects[1].id,
    tokenStatus: "announced",
    officialAirdropStatus: "none",
    pointsProgram: "no",
    opportunityBasis: text(
      "Fictional project states no distribution; do not infer an airdrop from token status.",
      "虚构项目状态为无分发；不要由代币状态推断空投。",
    ),
    capitalRequirement: "medium",
    estimatedGasCostBand: "medium",
    timeRequirement: "high",
    sybilRisk: "high",
    dilutionRisk: "high",
    lockupRisk: "high",
    opportunityCost: "high",
    rewardPotential: "low",
    confidenceBand: "low",
    action: "avoid",
    isDemo: true,
    blocks: blocks(
      text(
        "Fictional distribution status: none; points program: no.",
        "虚构分发状态：无；积分计划：无。",
      ),
      text(
        "There is no reward basis in this fixture.",
        "此记录不存在奖励依据。",
      ),
      text(
        "Token announcements do not establish eligibility.",
        "代币公告不能证明资格。",
      ),
      text(
        "Do not prepare reward-seeking interactions without official terms.",
        "没有官方条款，不应准备以奖励为目的的交互。",
      ),
    ),
  },
];

export const demoPlaybooks: StrategyPlaybook[] = demoOpportunities
  .slice(0, 2)
  .map((opportunity) => ({
    id: `demo-playbook-${opportunity.id}`,
    opportunityId: opportunity.id,
    title: opportunity.title,
    thesis: opportunity.thesis,
    evidence: [
      text(
        "Evidence is a fictional fixture, not a fetched source.",
        "证据为虚构演示记录，并非已抓取来源。",
      ),
    ],
    catalystIds: opportunity.catalystIds,
    scenarios: {
      bull: text(
        "Persistent adoption and manageable costs justify further research, not a promised return.",
        "持续采用与可控成本可能值得进一步研究，但不承诺回报。",
      ),
      base: text(
        "Evidence remains mixed; maintain a watch checklist and wait.",
        "证据仍混合；保留观察清单并等待。",
      ),
      bear: text(
        "Retention or access deteriorates; stop preparation and reassess.",
        "留存或准入恶化；停止准备并重新评估。",
      ),
    },
    entryConditions: text(
      "Research-entry conditions only: verifiable evidence, security review and acceptable opportunity cost.",
      "仅为进入研究的条件：可核验证据、安全审查与可接受的机会成本。",
    ),
    invalidation: opportunity.invalidation,
    risks: opportunity.counterThesis,
    watchNext: opportunity.watchNext,
    timeHorizon: opportunity.timeHorizon,
    capitalRequirement: opportunity.capitalRequirement,
    action: "research",
    isDemo: true,
    blocks: opportunity.blocks,
    exit: {
      triggers: [
        "thesis_invalidation",
        "crowding_extreme",
        "unlock_risk",
        "momentum_deterioration",
      ],
      profitTakingFramework: text(
        "Preparation template only: review exposure against evidence; no target price or execution instruction.",
        "仅为准备模板：根据证据审视敞口；不提供目标价格或执行指令。",
      ),
      riskReductionConditions: text(
        "Reassess if leverage, valuation or narrative crowding becomes extreme.",
        "若杠杆、估值或叙事拥挤达到极端，应重新评估。",
      ),
      invalidationConditions: opportunity.invalidation,
      timeStop: text(
        "Review at the next evidence checkpoint; close the research plan if support remains absent.",
        "在下一证据检查点评估；若仍无支持，则关闭研究计划。",
      ),
    },
  }));

export const demoCycle: CycleReadiness = {
  id: "demo-cycle",
  regime: "early_expansion",
  readiness: "medium",
  dimensions: {
    liquidity: "medium",
    institutionalFlow: "medium",
    stablecoinLiquidity: "high",
    marketBreadth: "low",
    leverage: "high",
    retailAttention: "low",
    narrativeBreadth: "medium",
    macroSupport: "low",
  },
  evidence: [
    text(
      "Synthetic liquidity breadth is constructive in this fixture.",
      "此记录中的合成流动性广度具有支持性。",
    ),
  ],
  counterEvidence: [
    text(
      "Synthetic leverage is elevated and market breadth remains narrow.",
      "合成杠杆偏高，市场广度仍狭窄。",
    ),
  ],
  confidenceBand: "low",
  scenarioWindow: text(
    "Conditional research window; no start date or duration is forecast.",
    "有条件的研究窗口；不预测开始日期或持续时间。",
  ),
  isDemo: true,
  blocks: blocks(
    text(
      "The selected regime and dimensions are fixed demo values.",
      "选定状态及维度均为固定演示值。",
    ),
    text(
      "Readiness is a multi-dimensional research framework, not a bull-market timer.",
      "准备度是多维研究框架，并非牛市计时器。",
    ),
    text(
      "Historical crypto cycles are patterns, not deterministic four-year laws.",
      "加密市场历史周期是模式，并非确定性的四年规律。",
    ),
    text(
      "Reassess when liquidity deteriorates or leverage overwhelms breadth.",
      "若流动性恶化或杠杆超过广度支持，应重新评估。",
    ),
  ),
};

const phases: [string, string, string, string, string, string][] = [
  [
    "Preparation",
    "准备期",
    "Security, liquidity and evidence quality",
    "安全、流动性与证据质量",
    "Quiet research; adoption may lag",
    "安静研究；采用可能滞后",
  ],
  [
    "BTC Leadership",
    "BTC 引领",
    "Relative breadth and institutional concentration",
    "相对广度与机构集中度",
    "Leadership may remain concentrated",
    "引领可能仍然集中",
  ],
  [
    "Large-cap Expansion",
    "大市值扩张",
    "Participation beyond a single asset",
    "单一资产以外的参与度",
    "Breadth may expand unevenly",
    "广度可能不均衡扩张",
  ],
  [
    "Sector Rotation",
    "板块轮动",
    "Theme dispersion and durable fundamentals",
    "主题分化与持久基本面",
    "Capital may rotate rather than grow",
    "资金可能仅轮动而非增长",
  ],
  [
    "Broad Risk Expansion",
    "广泛风险扩张",
    "Leverage, liquidity and valuation discipline",
    "杠杆、流动性与估值纪律",
    "Risk appetite can outrun evidence",
    "风险偏好可能超过证据支持",
  ],
  [
    "Retail Euphoria",
    "散户狂热",
    "Crowding and narrative saturation",
    "拥挤与叙事饱和",
    "Attention can detach from utility",
    "关注度可能脱离效用",
  ],
  [
    "Distribution",
    "派发期",
    "Unlocks, insider distribution and momentum",
    "解锁、内部人派发与动量",
    "Liquidity can weaken before attention fades",
    "流动性可能在关注度消退前减弱",
  ],
];
export const demoBullPhases: BullMarketPhase[] = phases.map(
  ([en, zh, signals, signalsZh, behavior, behaviorZh], index) => ({
    id: `demo-phase-${index}`,
    name: text(en, zh),
    signals: text(signals, signalsZh),
    typicalBehavior: text(behavior, behaviorZh),
    research: text(
      "Research evidence quality and opportunity cost; no automatic action follows a phase.",
      "研究证据质量与机会成本；阶段不触发自动行动。",
    ),
    risks: text(
      "The phase may be skipped, reversed or overlap another phase.",
      "阶段可能被跳过、逆转或与其他阶段重叠。",
    ),
    exitConsiderations: text(
      "Review thesis invalidation, crowding and exposure; no automated execution.",
      "审视论点失效、拥挤与敞口；不自动执行。",
    ),
    isDemo: true,
    blocks: blocks(
      text(
        "Illustrative preparation phase, not an observed current regime.",
        "示例准备阶段，并非观测到的当前状态。",
      ),
      text(behavior, behaviorZh),
      commonCounter,
      commonInvalidation,
    ),
  }),
);
export const demoOutcomes: Outcome[] = demoPlaybooks.map((playbook) => ({
  id: `demo-outcome-${playbook.id}`,
  strategyId: playbook.id,
  prediction: playbook.thesis,
  observationStart: null,
  observationEnd: null,
  result: "not_observed",
  returnPct: null,
  maxDrawdownPct: null,
  thesisCorrect: null,
  lessons: text(
    "No outcome observed. Future sourced observations will support model calibration.",
    "尚未观测结果。未来有来源的观测将支持模型校准。",
  ),
  modelVersion: null,
  isDemo: true,
  blocks: blocks(
    text(
      "No observation or performance has been recorded in this fixture.",
      "此记录尚未记录观测或表现。",
    ),
    text(
      "Only sourced future outcomes may support calibration.",
      "仅有来源的未来结果可以支持校准。",
    ),
    text(
      "Unobserved hypotheses do not establish performance.",
      "未观测的假设无法证明表现。",
    ),
    text(
      "Reject evaluation if provenance or comparable observations are missing.",
      "若缺少溯源或可比观测，应拒绝评估。",
    ),
  ),
}));
export const demoRadarReferences: RadarStrategyReference[] = [
  {
    eventId: "demo-crypto-rule",
    themeIds: [demoThemes[1].id],
    opportunityIds: [demoOpportunities[1].id],
    catalystIds: [demoCatalysts[0].id],
    isDemo: true,
  },
  {
    eventId: "demo-exchange-liquidity",
    themeIds: [demoThemes[2].id],
    opportunityIds: [],
    catalystIds: [],
    isDemo: true,
  },
  {
    eventId: "demo-etf-flow",
    themeIds: [demoThemes[1].id],
    opportunityIds: [demoOpportunities[1].id],
    catalystIds: [demoCatalysts[0].id],
    isDemo: true,
  },
];
