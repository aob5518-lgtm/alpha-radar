import type { AnalystResponse } from "@alpha-radar/types/core-3";
import type { MarketInterval } from "@alpha-radar/types/market-data";
import { NextResponse } from "next/server";

import { createAnalystProvider } from "@/lib/ai/runtime";
import { getAsset } from "@/lib/api/assets";
import { getRecentEventsForAsset } from "@/lib/api/events";
import { getTechnicalMarketContext } from "@/lib/market/context";
import { marketIntervals } from "@/lib/market/intervals";
import { TECHNICAL_LEVELS_VERSION } from "@/lib/market/technical-levels";

export async function POST(request: Request) {
  const provider = createAnalystProvider();
  if (!provider)
    return NextResponse.json({ error: "analyst_unavailable" }, { status: 503 });
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const question =
    typeof body?.question === "string" ? body.question.trim() : "";
  const assetId = typeof body?.asset_id === "string" ? body.asset_id : "";
  const interval = body?.timeframe;
  if (
    !question ||
    question.length > 2000 ||
    !assetId ||
    !marketIntervals.includes(interval as MarketInterval)
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 422 });
  }
  const asset = await getAsset(assetId);
  if (!asset)
    return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
  const [market, events] = await Promise.all([
    getTechnicalMarketContext(asset.id, interval as MarketInterval),
    getRecentEventsForAsset(asset.id).catch(() => []),
  ]);
  const sourceIds = [
    ...new Set(
      events.flatMap((event) =>
        event.sources.map((source) => source.source_document_id),
      ),
    ),
  ];
  const evidenceIds = [
    ...sourceIds,
    ...(market.quote
      ? [`market_quote:${market.quote.provider}:${market.quote.observed_at}`]
      : []),
    ...(market.history
      ? [
          `market_history:${market.history.provider}:${interval}:${market.history.items.at(-1)?.close_time ?? "empty"}`,
        ]
      : []),
    `technical:${TECHNICAL_LEVELS_VERSION}`,
  ];
  const grounding = {
    asset: { id: asset.id, symbol: asset.symbol, name: asset.name },
    timeframe: interval,
    quote: market.quote,
    closed_candles:
      market.history?.items.filter((item) => item.is_closed).slice(-120) ?? [],
    structural_levels: market.snapshot
      ? [...market.snapshot.resistances, ...market.snapshot.supports]
      : [],
    trend: market.snapshot?.trend ?? null,
    higher_timeframe: market.higherInterval,
    events,
    source_document_ids: sourceIds,
    evidence_reference_ids: evidenceIds,
    technical_model_version: TECHNICAL_LEVELS_VERSION,
    context_timestamp: new Date().toISOString(),
  };
  try {
    const result = await provider.analyze({ question, context: grounding });
    validateEvidenceReferences(result, new Set(evidenceIds));
    result.key_resistance = market.snapshot?.resistances ?? [];
    result.key_support = market.snapshot?.supports ?? [];
    result.context_timestamp = grounding.context_timestamp;
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "analyst_provider_failed" },
      { status: 502 },
    );
  }
}

function validateEvidenceReferences(
  response: AnalystResponse,
  allowed: Set<string>,
) {
  const sections = [
    response.market_state,
    response.trend,
    response.important_recent_events,
    response.bull_case,
    response.bear_case,
    response.trigger_conditions,
    response.invalidation_and_risk,
    response.watch_next,
  ];
  for (const statement of sections.flat()) {
    if (statement.source_reference_ids.some((id) => !allowed.has(id))) {
      throw new Error("AI response contains an unknown evidence reference");
    }
    if (
      statement.kind === "fact" &&
      statement.source_reference_ids.length === 0
    ) {
      throw new Error("AI fact is missing an evidence reference");
    }
  }
}
