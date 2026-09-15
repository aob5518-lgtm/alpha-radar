import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cycleRegimes,
  opportunityStages,
  opportunityTypes,
  strategicActions,
  strategicKinds,
  themeStages,
  catalystTypes,
  exitTriggers,
} from "@alpha-radar/types/strategy";
import {
  allDemoAssets,
  demoRadarItems,
  localize,
} from "../src/lib/intelligence/demo-data.ts";
import {
  demoAirdrops,
  demoBullPhases,
  demoCatalysts,
  demoCycle,
  demoOpportunities,
  demoOutcomes,
  demoPlaybooks,
  demoProjects,
  demoRadarReferences,
  demoThemes,
} from "../src/lib/strategy/demo-data.ts";
import {
  catalystHref,
  filterOpportunities,
  filterThemes,
  opportunityHref,
  playbookHref,
  projectHref,
  strategyForAsset,
  strategyForEvent,
  themeHref,
} from "../src/lib/strategy/derive.ts";

const records = [
  ...demoThemes,
  ...demoOpportunities,
  ...demoProjects,
  ...demoAirdrops,
  ...demoCatalysts,
  ...demoPlaybooks,
  demoCycle,
  ...demoBullPhases,
  ...demoOutcomes,
];
const catalogs = await Promise.all(
  ["en", "zh-CN"].map(async (locale) =>
    JSON.parse(
      await readFile(
        new URL(`../messages/${locale}.json`, import.meta.url),
        "utf8",
      ),
    ),
  ),
);

test("ordinal, probability and confidence contracts remain semantically independent", async () => {
  const contract = await readFile(
    new URL("../../../packages/types/src/strategy.ts", import.meta.url),
    "utf8",
  );
  assert.match(contract, /type OrdinalBand = "low" \| "medium" \| "high";/);
  assert.match(contract, /type ProbabilityBand = "low" \| "medium" \| "high";/);
  assert.match(contract, /probabilityBand: ProbabilityBand;/);
  assert.match(contract, /confidenceBand: ConfidenceLevel;/);
  assert.match(contract, /rewardPotential: OrdinalBand;/);
  assert.match(contract, /estimatedGasCostBand: OrdinalBand;/);
  assert.doesNotMatch(
    contract,
    /DemoBand|type (OrdinalBand|ProbabilityBand) = ConfidenceLevel/,
  );
});

test("strategic objects are deterministic demos with all six analysis distinctions", () => {
  assert.equal(new Set(records.map((item) => item.id)).size, records.length);
  for (const item of records) {
    assert.equal(item.isDemo, true);
    assert.deepEqual(
      item.blocks.map((block) => block.kind),
      strategicKinds,
    );
    for (const block of item.blocks) {
      assert.ok(block.content.en.trim());
      assert.ok(block.content["zh-CN"].trim());
      assert.notEqual(
        localize(block.content, "en"),
        localize(block.content, "zh-CN"),
      );
    }
    assert.match(
      item.blocks.find((block) => block.kind === "model_output").content.en,
      /No model has run/,
    );
  }
});
test("theme stages and opportunity lifecycle are explicit and filters preserve semantics", () => {
  assert.deepEqual(themeStages, [
    "emerging",
    "early",
    "accelerating",
    "crowded",
    "mature",
    "declining",
  ]);
  assert.deepEqual(opportunityStages, [
    "discovered",
    "researching",
    "watching",
    "preparing",
    "active",
    "maturing",
    "crowded",
    "exit_watch",
    "closed",
    "invalidated",
  ]);
  for (const stage of themeStages)
    assert.ok(
      filterThemes(demoThemes, stage).every((item) => item.stage === stage),
    );
  assert.equal(filterThemes(demoThemes, "unknown").length, 0);
  for (const stage of opportunityStages)
    assert.ok(
      filterOpportunities(demoOpportunities, { stage }).every(
        (item) => item.stage === stage,
      ),
    );
  const first = demoOpportunities[0];
  assert.deepEqual(
    filterOpportunities(demoOpportunities, {
      themeId: first.themeId,
      stage: first.stage,
      type: first.opportunityType,
      assetId: first.affectedAssetIds[0],
    }),
    [first],
  );
  assert.deepEqual(
    filterOpportunities(demoOpportunities, { assetId: "BTC" }),
    [],
  );
});
test("strategy references resolve canonical Assets, projects, catalysts and themes", () => {
  const assetIds = new Set(allDemoAssets.map((item) => item.assetId));
  for (const item of demoOpportunities) {
    assert.ok(opportunityTypes.includes(item.opportunityType));
    assert.ok(demoThemes.some((theme) => theme.id === item.themeId));
    assert.ok(item.affectedAssetIds.every((id) => assetIds.has(id)));
    assert.ok(
      item.relatedProjectIds.every((id) =>
        demoProjects.some((project) => project.id === id),
      ),
    );
    assert.ok(
      item.catalystIds.every((id) =>
        demoCatalysts.some((catalyst) => catalyst.id === id),
      ),
    );
    for (const key of ["thesis", "counterThesis", "invalidation", "watchNext"])
      assert.ok(item[key].en);
    assert.equal("buy" in item || "sell" in item || "price" in item, false);
  }
});
test("airdrop status is independent of tokenlessness and points; no reward entitlement is inferred", () => {
  const tokenless = demoAirdrops.find(
    (item) => item.tokenStatus === "tokenless",
  );
  assert.equal(tokenless.officialAirdropStatus, "not_announced");
  assert.equal(tokenless.pointsProgram, "unknown");
  assert.equal(tokenless.action, "wait");
  const none = demoAirdrops.find(
    (item) => item.officialAirdropStatus === "none",
  );
  assert.equal(none.action, "avoid");
  for (const item of demoAirdrops) {
    const project = demoProjects.find(
      (project) => project.id === item.projectId,
    );
    const opportunity = demoOpportunities.find(
      (opportunity) => opportunity.id === item.opportunityId,
    );
    assert.equal(item.tokenStatus, project.tokenStatus);
    assert.ok(opportunity.relatedProjectIds.includes(project.id));
    assert.ok(
      ["confirmed", "not_announced", "none"].includes(
        item.officialAirdropStatus,
      ),
    );
    assert.ok(strategicActions.includes(item.action));
    assert.ok(item.opportunityBasis.en);
    assert.equal("probability" in item, false);
  }
  assert.match(catalogs[0].strategy.enums.not_announced, /no entitlement/);
});
test("catalysts use nullable dates and demo probability bands, never precise calibrated probability", () => {
  assert.ok(demoCatalysts.some((item) => item.scheduledAt === null));
  for (const item of demoCatalysts) {
    assert.ok(catalystTypes.includes(item.catalystType));
    assert.ok(["low", "medium", "high"].includes(item.probabilityBand));
    assert.equal("probability" in item, false);
    if (item.scheduledAt) assert.match(item.scheduledAt, /Z$/);
    else assert.equal(item.dateCertainty, "unknown");
  }
});
test("playbooks preserve scenarios, research conditions, counterpoints and exit reviews", () => {
  for (const item of demoPlaybooks) {
    assert.deepEqual(Object.keys(item.scenarios), ["bull", "base", "bear"]);
    assert.equal(
      new Set(Object.values(item.scenarios).map((value) => value.en)).size,
      3,
    );
    assert.match(item.entryConditions.en, /Research-entry/);
    assert.ok(item.evidence.length);
    assert.ok(item.invalidation.en && item.risks.en && item.watchNext.en);
    assert.ok(
      item.exit.triggers.every((trigger) => exitTriggers.includes(trigger)),
    );
    for (const key of [
      "profitTakingFramework",
      "riskReductionConditions",
      "invalidationConditions",
      "timeStop",
    ])
      assert.ok(item.exit[key].en);
    assert.ok(strategicActions.includes(item.action));
  }
});
test("cycle framework is multi-dimensional and phases do not forecast dates or mandatory sequence", () => {
  assert.equal(cycleRegimes.length, 6);
  assert.ok(cycleRegimes.includes(demoCycle.regime));
  assert.equal(Object.keys(demoCycle.dimensions).length, 8);
  assert.ok(demoCycle.evidence.length && demoCycle.counterEvidence.length);
  assert.match(demoCycle.scenarioWindow.en, /no start date/);
  assert.equal(demoBullPhases.length, 7);
  assert.ok(
    demoBullPhases.every((item) => /skipped, reversed/.test(item.risks.en)),
  );
  assert.match(
    catalogs[0].strategy.cycleWarning,
    /not deterministic four-year laws/,
  );
});
test("Outcome has no invented performance and links to its strategy", () => {
  for (const item of demoOutcomes) {
    assert.ok(
      demoPlaybooks.some((playbook) => playbook.id === item.strategyId),
    );
    assert.equal(item.result, "not_observed");
    for (const key of [
      "observationStart",
      "observationEnd",
      "returnPct",
      "maxDrawdownPct",
      "thesisCorrect",
      "modelVersion",
    ])
      assert.equal(item[key], null);
  }
});
test("Radar adapter and Asset relations resolve without modifying persisted Market data", () => {
  for (const reference of demoRadarReferences) {
    assert.equal(reference.isDemo, true);
    assert.ok(demoRadarItems.some((event) => event.id === reference.eventId));
    const related = strategyForEvent(reference.eventId);
    assert.deepEqual(
      related.themes.map((item) => item.id),
      reference.themeIds,
    );
    assert.deepEqual(
      related.opportunities.map((item) => item.id),
      reference.opportunityIds,
    );
    assert.deepEqual(
      related.catalysts.map((item) => item.id),
      reference.catalystIds,
    );
  }
  const related = strategyForAsset(allDemoAssets[0].assetId);
  assert.ok(
    related.opportunities.length &&
      related.themes.length &&
      related.catalysts.length &&
      related.playbooks.length,
  );
  assert.equal(strategyForAsset("unknown").opportunities.length, 0);
  assert.equal(strategyForEvent("unknown").themes.length, 0);
});
test("deep links encode references and resolve to the intended routes", () => {
  for (const [fn, id, path, parameter] of [
    [themeHref, demoThemes[0].id, "/discover/themes", "theme"],
    [
      opportunityHref,
      demoOpportunities[0].id,
      "/discover/opportunities",
      "opportunity",
    ],
    [projectHref, demoProjects[0].id, "/discover", "project"],
    [playbookHref, demoPlaybooks[0].id, "/strategy", "playbook"],
    [catalystHref, demoCatalysts[0].id, "/strategy", "catalyst"],
  ]) {
    const url = new URL(fn(id), "http://example.test");
    assert.equal(url.pathname, path);
    assert.equal(url.searchParams.get(parameter), id);
  }
  assert.equal(
    new URL(themeHref("a&b"), "http://example.test").searchParams.get("theme"),
    "a&b",
  );
});
test("English/Chinese labels cover contract enums and all strategy risk disclosures", () => {
  assert.deepEqual(
    Object.keys(catalogs[0].strategy),
    Object.keys(catalogs[1].strategy),
  );
  for (const catalog of catalogs) {
    for (const key of [
      ...themeStages,
      ...opportunityStages,
      ...opportunityTypes,
      ...cycleRegimes,
      ...strategicActions,
      ...catalystTypes,
      ...exitTriggers,
    ])
      assert.ok(catalog.strategy.enums[key], key);
    for (const key of [
      ...strategicKinds,
      "disclaimer",
      "discipline",
      "cycleWarning",
      "attentionLag",
    ])
      assert.ok(catalog.strategy[key]);
  }
  assert.match(catalogs[0].strategy.disclaimer, /fictional Demo\/Sample/);
  assert.match(catalogs[1].strategy.disclaimer, /虚构演示/);
});
