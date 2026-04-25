// Shared types for /api/backtest (so client components can import them
// without violating Next.js' rule that route files only export HTTP
// handlers + runtime config).

import type { DcaResult } from "./backtest";
import type { CoveredCallDetection } from "./coveredCall";
import type { WindowDistribution } from "./distribution";
import type { DividendAnalysis, ReinvestComparison } from "./dividends";

export interface PerTickerOutcome {
  ticker: string;
  ok: boolean;
  result?: DcaResult;
  error?: string;
  detection?: CoveredCallDetection;
  coveredCallApplied?: boolean;
  dividendAnalysis?: DividendAnalysis;
  reinvestComparison?: ReinvestComparison;
  /**
   * Sliding-window historical distribution (PR2 #10): "if I had started this
   * DCA at any month in the past, what would my N-year IRR have looked like?"
   * Null when the price history is too short for the requested window.
   */
  windowDistribution?: WindowDistribution | null;
}

export interface BacktestApiResponse {
  results: PerTickerOutcome[];
  benchmark: PerTickerOutcome | null;
  benchmarkSymbol: string | null;
}
