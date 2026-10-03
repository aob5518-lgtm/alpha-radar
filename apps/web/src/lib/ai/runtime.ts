import type { AnalystProvider } from "./provider";
import { OpenAIAnalystProvider } from "./openai";

export function createAnalystProvider(): AnalystProvider | null {
  if (
    process.env.AI_PROVIDER !== "openai" ||
    !process.env.OPENAI_API_KEY ||
    !process.env.AI_MODEL
  )
    return null;
  return new OpenAIAnalystProvider(
    process.env.AI_MODEL,
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  );
}

export function isAnalystConfigured(): boolean {
  return createAnalystProvider() !== null;
}
