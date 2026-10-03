import type { AnalystResponse } from "@alpha-radar/types/core-3";

export interface AnalystGrounding {
  question: string;
  context: unknown;
}

export interface AnalystProvider {
  readonly name: string;
  readonly model: string;
  analyze(input: AnalystGrounding): Promise<AnalystResponse>;
}

export class AnalystUnavailableError extends Error {}
