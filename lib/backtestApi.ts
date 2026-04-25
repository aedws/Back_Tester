// Shared types for /api/backtest (so client components can import them
// without violating Next.js' rule that route files only export HTTP
// handlers + runtime config).

import type { DcaResult } from "./backtest";
import type { CoveredCallDetection } from "./coveredCall";
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
}

export interface BacktestApiResponse {
  results: PerTickerOutcome[];
  benchmark: PerTickerOutcome | null;
  benchmarkSymbol: string | null;
}
