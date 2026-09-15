import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEMO_REFERENCE_TIME,
  demoAssets,
  demoRadarItems,
  localize,
} from "../src/lib/intelligence/demo-data.ts";
import {
  buildHeatmap,
  buildImpactMap,
  filterDiscoverAssets,
  filterRadarItems,
  orderRadarItems,
  relatedItemsForAsset,
} from "../src/lib/intelligence/derive.ts";

const messageFiles = {
  en: new URL("../messages/en.json", import.meta.url),
  "zh-CN": new URL("../messages/zh-CN.json", import.meta.url),
};

test("demo intelligence contracts preserve canonical identities and explicit demo markers", () => {
  assert.ok(demoRadarItems.length >= 6);
  for (const item of demoRadarItems) {
    assert.equal(item.isDemo, true);
    assert.equal(item.sourceCount, item.sources.length);
    assert.ok(item.sources.every((source) => source.isDemo));
    assert.ok(
      item.assets.every((asset) => /^[0-9a-f-]{36}$/.test(asset.assetId)),
    );
    assert.ok(
      item.blocks.every((block) =>
        ["fact", "analysis", "scenario", "model_output"].includes(block.kind),
      ),
    );
  }
});

test("time ranges and compound filters use the deterministic snapshot", () => {
  assert.equal(
    filterRadarItems(demoRadarItems, { timeRange: "1h" }, DEMO_REFERENCE_TIME)
      .length,
    1,
  );
  assert.equal(
    filterRadarItems(demoRadarItems, { timeRange: "4h" }, DEMO_REFERENCE_TIME)
      .length,
    3,
  );
  const bitcoinHighImpact = filterRadarItems(
    demoRadarItems,
    { timeRange: "7d", assetId: demoAssets.bitcoin.assetId, impact: "high" },
    DEMO_REFERENCE_TIME,
  );
  assert.deepEqual(
    bitcoinHighImpact.map((item) => item.id),
    ["demo-fed-path", "demo-crypto-rule"],
  );
  const primaryBullish = filterRadarItems(
    demoRadarItems,
    { timeRange: "7d", sourceTier: "primary", direction: "bullish" },
    DEMO_REFERENCE_TIME,
  );
  assert.ok(
    primaryBullish.every((item) =>
      item.sources.some((source) => source.tier === "primary"),
    ),
  );
});

test("timeline ordering is reverse chronological by event time with detected fallback", () => {
  const ordered = orderRadarItems([...demoRadarItems].reverse());
  assert.equal(ordered[0]?.id, "demo-fed-path");
  assert.equal(ordered.at(-1)?.id, "demo-dollar-reversal");
});

test("impact map and heatmap contain one cell per event-asset impact", () => {
  const expected = demoRadarItems.reduce(
    (total, item) => total + item.impacts.length,
    0,
  );
  const edges = buildImpactMap(demoRadarItems);
  const cells = buildHeatmap(demoRadarItems);
  assert.equal(edges.length, expected);
  assert.equal(cells.length, expected);
  assert.ok(
    edges.some((edge) => edge.order === "second" && edge.symbol === "BTC"),
  );
  assert.ok(
    cells.some(
      (cell) => cell.direction === "bearish" && cell.impact === "high",
    ),
  );
});

test("asset mapping uses canonical UUID and localized fixture copy", () => {
  const bitcoinEvents = relatedItemsForAsset(
    demoRadarItems,
    demoAssets.bitcoin.assetId,
  );
  assert.equal(bitcoinEvents.length, 4);
  assert.notEqual(
    localize(bitcoinEvents[0].title, "en"),
    localize(bitcoinEvents[0].title, "zh-CN"),
  );
});

test("discover filters combine asset class, narrative, flow, and risk", () => {
  const results = filterDiscoverAssets(
    Object.values(demoAssets),
    demoRadarItems,
    {
      assetClass: "crypto",
      narrative: "liquidity",
      capitalFlow: "positive",
      risk: "high",
    },
  );
  assert.deepEqual(
    results.map((asset) => asset.symbol),
    ["BTC"],
  );
});

test("intelligence labels and demo disclosures exist in both languages", async () => {
  for (const locale of ["en", "zh-CN"]) {
    const messages = JSON.parse(await readFile(messageFiles[locale], "utf8"));
    assert.ok(messages.common.demoData);
    assert.ok(messages.common.demoDisclaimer);
    assert.ok(messages.labels.statuses.breaking);
    assert.ok(messages.labels.eventTypes.market_structure);
    assert.ok(messages.labels.pricedIn.not_priced);
    assert.ok(messages.labels.intelligenceKinds.model_output);
    assert.ok(messages.radar.heatmapDescription);
  }

  const english = JSON.parse(await readFile(messageFiles.en, "utf8"));
  const chinese = JSON.parse(await readFile(messageFiles["zh-CN"], "utf8"));
  assert.equal(english.labels.directions.bullish, "Bullish");
  assert.equal(chinese.labels.directions.bullish, "看涨");
  assert.equal(english.labels.statuses.resolved, "Resolved");
  assert.equal(chinese.labels.statuses.resolved, "已解决");
  assert.equal(english.labels.pricedIn.partial, "Partially priced");
  assert.equal(chinese.labels.pricedIn.partial, "部分计价");
});

test("radar surfaces render explicit demo markers", async () => {
  const files = [
    new URL("../src/app/radar/page.tsx", import.meta.url),
    new URL("../src/components/radar/event-card.tsx", import.meta.url),
    new URL("../src/components/radar/event-drawer.tsx", import.meta.url),
  ];
  const sources = await Promise.all(
    files.map((file) => readFile(file, "utf8")),
  );
  assert.ok(sources.every((source) => source.includes("DemoBadge")));
});
