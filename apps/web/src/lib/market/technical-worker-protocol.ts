import type {
  MarketCandle,
  MarketInterval,
} from "@alpha-radar/types/market-data";
import type { TradeSetupCandidateV1 } from "@alpha-radar/types/core-3";
import type { TechnicalContextSnapshot } from "./technical-context.ts";
import type { TechnicalTimings } from "./technical-diagnostics.ts";

export interface TechnicalRequest {
  market_instrument_id: string;
  timeframe: MarketInterval;
  generation: number;
  revision: string;
  candles: MarketCandle[];
  higherCandles?: MarketCandle[];
  confirmedClose: number;
}
export type TechnicalResult = Pick<
  TechnicalRequest,
  "market_instrument_id" | "timeframe" | "generation" | "revision"
> &
  (
    | {
        ok: true;
        snapshot: TechnicalContextSnapshot;
        setup: TradeSetupCandidateV1;
        timings: TechnicalTimings & {
          worker_compute_ms: number;
          incremental_update_ms: number;
        };
        incremental: boolean;
      }
    | { ok: false; error_type: string }
  );
export interface TechnicalComputer {
  request(
    input: Omit<TechnicalRequest, "generation">,
    complete: (result: TechnicalResult) => void,
  ): void;
  select(instrumentId: string, interval: MarketInterval): void;
  retry(): void;
  dispose(): void;
}
