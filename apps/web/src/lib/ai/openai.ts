import type {
  AnalystResponse,
  AnalystStatement,
} from "@alpha-radar/types/core-3";

import {
  AnalystUnavailableError,
  type AnalystGrounding,
  type AnalystProvider,
} from "./provider";
import { analystResponseSchema } from "./schema";

type Content = { type?: string; text?: string };
type Output = { content?: Content[] };

export class OpenAIAnalystProvider implements AnalystProvider {
  readonly name = "openai";

  constructor(
    readonly model: string,
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  async analyze(input: AnalystGrounding): Promise<AnalystResponse> {
    const contextTimestamp = new Date().toISOString();
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/responses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: "You are Alpha Radar's concise market research analyst. Use only supplied context. Never invent prices, levels, events, times, actual releases, or sources. FACT statements require one or more exact IDs from evidence_reference_ids. ANALYSIS and SCENARIO must be labeled with their matching kind. Say unavailable when evidence is absent. Return empty key_resistance and key_support arrays; the application injects validated Structural Levels V1.1.",
                },
              ],
            },
            {
              role: "user",
              content: [{ type: "input_text", text: JSON.stringify(input) }],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "alpha_radar_analysis",
              strict: true,
              schema: analystResponseSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new AnalystUnavailableError(
        `AI provider returned ${response.status}`,
      );
    const payload = (await response.json()) as { output?: Output[] };
    const text = payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text;
    if (!text)
      throw new AnalystUnavailableError(
        "AI provider returned no structured output",
      );
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const section = (key: string) => validateStatements(parsed[key]);
    return {
      market_state: section("market_state"),
      trend: section("trend"),
      key_resistance: [],
      key_support: [],
      important_recent_events: section("important_recent_events"),
      bull_case: section("bull_case"),
      bear_case: section("bear_case"),
      trigger_conditions: section("trigger_conditions"),
      invalidation_and_risk: section("invalidation_and_risk"),
      watch_next: section("watch_next"),
      model_provider: this.name,
      model_version: this.model,
      generated_at: new Date().toISOString(),
      technical_model_version: "structural-levels-v1.1",
      context_timestamp: contextTimestamp,
    };
  }
}

function validateStatements(value: unknown): AnalystStatement[] {
  if (!Array.isArray(value))
    throw new AnalystUnavailableError("Invalid structured AI output");
  return value.map((item) => {
    if (!item || typeof item !== "object")
      throw new AnalystUnavailableError("Invalid statement");
    const row = item as Record<string, unknown>;
    if (
      !["fact", "analysis", "scenario"].includes(String(row.kind)) ||
      typeof row.text !== "string" ||
      !Array.isArray(row.source_reference_ids)
    ) {
      throw new AnalystUnavailableError("Invalid statement fields");
    }
    return {
      kind: row.kind as AnalystStatement["kind"],
      text: row.text,
      source_reference_ids: row.source_reference_ids.filter(
        (id): id is string => typeof id === "string",
      ),
    };
  });
}
