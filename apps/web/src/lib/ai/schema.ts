const statementProperties = Object.fromEntries(
  [
    "market_state",
    "trend",
    "important_recent_events",
    "bull_case",
    "bear_case",
    "trigger_conditions",
    "invalidation_and_risk",
    "watch_next",
  ].map((key) => [key, statementList()]),
);

export const analystResponseSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "market_state",
    "trend",
    "key_resistance",
    "key_support",
    "important_recent_events",
    "bull_case",
    "bear_case",
    "trigger_conditions",
    "invalidation_and_risk",
    "watch_next",
  ],
  properties: {
    ...statementProperties,
    // Levels come verbatim from Alpha Radar; the model cannot create them.
    key_resistance: { type: "array", maxItems: 0 },
    key_support: { type: "array", maxItems: 0 },
  },
};

function statementList() {
  return {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "text", "source_reference_ids"],
      properties: {
        kind: { type: "string", enum: ["fact", "analysis", "scenario"] },
        text: { type: "string" },
        source_reference_ids: { type: "array", items: { type: "string" } },
      },
    },
  } as const;
}
