import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  defaultLocale,
  isLocale,
  localeCookieName,
  parseLocale,
  supportedLocales,
} from "../src/lib/i18n/config.ts";
import { formatMarketPrice } from "../src/lib/i18n/format.ts";

const messageFiles = {
  en: new URL("../messages/en.json", import.meta.url),
  "zh-CN": new URL("../messages/zh-CN.json", import.meta.url),
};

async function loadMessages(locale) {
  const contents = await readFile(messageFiles[locale], "utf8");
  return JSON.parse(contents);
}

function flattenKeys(value, prefix = "") {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) =>
    flattenKeys(nestedValue, prefix ? `${prefix}.${key}` : key),
  );
}

test("uses English as the default locale", () => {
  assert.equal(defaultLocale, "en");
  assert.deepEqual(supportedLocales, ["en", "zh-CN"]);
});

test("validates supported locales and falls back for invalid values", () => {
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("zh-CN"), true);
  assert.equal(isLocale("fr"), false);
  assert.equal(isLocale(undefined), false);
  assert.equal(parseLocale("zh-CN"), "zh-CN");
  assert.equal(parseLocale("invalid-locale"), defaultLocale);
  assert.equal(parseLocale(undefined), defaultLocale);
});

test("loads matching English and Simplified Chinese translation catalogs", async () => {
  const english = await loadMessages("en");
  const simplifiedChinese = await loadMessages("zh-CN");

  assert.equal(english.assets.title, "Asset directory");
  assert.equal(simplifiedChinese.assets.title, "资产目录");
  assert.equal(english.market.freshness.stale, "Stale");
  assert.equal(simplifiedChinese.market.freshness.stale, "陈旧");
  assert.deepEqual(flattenKeys(simplifiedChinese), flattenKeys(english));
});

test("keeps API enum values language-neutral while providing localized labels", async () => {
  const english = await loadMessages("en");
  const simplifiedChinese = await loadMessages("zh-CN");

  assert.equal(english.labels.assetTypes.crypto, "Crypto");
  assert.equal(simplifiedChinese.labels.assetTypes.crypto, "加密资产");
  assert.equal(simplifiedChinese.labels.assetTypes.etf, "ETF");
  assert.equal(simplifiedChinese.labels.assetStatuses.active, "活跃");
});

test("uses a stable cookie for unauthenticated locale persistence", () => {
  assert.equal(localeCookieName, "alpha_radar_locale");
});

test("formats ISO and crypto quote currencies without conflating them", () => {
  assert.match(formatMarketPrice(1234.5, "en", "USD"), /\$1,234\.50/);
  assert.equal(formatMarketPrice(1234.5, "en", "USDT"), "1,234.50 USDT");
  assert.equal(formatMarketPrice(1234.5, "zh-CN", "USDT"), "1,234.50 USDT");
});

test("language switcher persists locale and refreshes without changing route", async () => {
  const source = await readFile(
    new URL("../src/components/language-switcher.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /localeCookieName/);
  assert.match(source, /\$\{nextLocale\}/);
  assert.match(source, /path=\/; max-age=\$\{maxAge\}; samesite=lax/);
  assert.match(source, /router\.refresh\(\)/);
  assert.doesNotMatch(source, /router\.push\(/);
  assert.doesNotMatch(source, /router\.replace\(/);
});
