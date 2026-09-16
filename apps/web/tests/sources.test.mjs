import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sourceTypes } from "@alpha-radar/types/sources";

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

test("source intelligence distinguishes documents from Events in both locales", () => {
  assert.equal(catalogs[0].sources.sourceDocument, "Source Document");
  assert.match(catalogs[0].sources.notAnalyzed, /not yet analyzed into Event/i);
  assert.equal(catalogs[1].sources.sourceDocument, "来源文档");
  assert.match(catalogs[1].sources.notAnalyzed, /尚未分析为事件/);
  for (const catalog of catalogs) {
    for (const sourceType of sourceTypes)
      assert.ok(catalog.sources.types[sourceType]);
  }
});

test("source page reads real APIs and never imports Radar demo fixtures", async () => {
  const page = await readFile(
    new URL("../src/app/radar/sources/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /getDocuments/);
  assert.match(page, /getSources/);
  assert.doesNotMatch(page, /demo-data|demoRadarItems|isDemo/);
});
