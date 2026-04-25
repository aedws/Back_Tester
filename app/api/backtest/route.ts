import { NextResponse } from "next/server";

import { runDca, type Frequency } from "@/lib/backtest";
import type { PerTickerOutcome } from "@/lib/backtestApi";
import { detectCoveredCall } from "@/lib/coveredCall";
import {
  analyseDividends,
  compareReinvestment,
  type DividendAnalysis,
  type ReinvestComparison,
} from "@/lib/dividends";
import {
  fetchPrices,
  fetchQuoteSummary,
  type FetchMode,
} from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface BacktestRequest {
  tickers: string[];
  mode: FetchMode;
  years?: number;
  start?: string;
  end?: string;
  amount: number;
  frequency: Frequency;
  fractional?: boolean;
  /** Optional benchmark symbol; defaults to VOO when omitted/null. Send empty string to skip. */
  benchmark?: string | null;
  /**
   * Per-ticker user override of the auto-detected covered-call flag.
   *  - true  → force "treat as covered-call ETF" (run dividend analytics)
   *  - false → force "do not treat as covered-call"
   *  - undefined / missing key → use auto-detection
   */
  coveredCallOverrides?: Record<string, boolean>;
}

const DEFAULT_BENCHMARK = "VOO";

export async function POST(req: Request) {
  let body: BacktestRequest;
  try {
    body = (await req.json()) as BacktestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tickers = (body.tickers ?? [])
    .map((t) => (t ?? "").toString().trim().toUpperCase())
    .filter(Boolean);

  if (tickers.length === 0) {
    return NextResponse.json(
      { error: "At least one ticker is required" },
      { status: 400 },
    );
  }
  if (tickers.length > 10) {
    return NextResponse.json(
      { error: "Maximum 10 tickers per request" },
      { status: 400 },
    );
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 },
    );
  }

  const allowedFreq: Frequency[] = [
    "daily",
    "weekly",
    "biweekly",
    "monthly",
    "yearly",
  ];
  if (!allowedFreq.includes(body.frequency)) {
    return NextResponse.json(
      { error: `frequency must be one of ${allowedFreq.join(", ")}` },
      { status: 400 },
    );
  }

  const allowedMode: FetchMode[] = ["years", "inception", "custom"];
  if (!allowedMode.includes(body.mode)) {
    return NextResponse.json(
      { error: `mode must be one of ${allowedMode.join(", ")}` },
      { status: 400 },
    );
  }

  if (body.mode === "custom" && (!body.start || !body.end)) {
    return NextResponse.json(
      { error: "start and end are required for custom mode" },
      { status: 400 },
    );
  }

  const overrides: Record<string, boolean> = {};
  if (body.coveredCallOverrides) {
    for (const [k, v] of Object.entries(body.coveredCallOverrides)) {
      overrides[k.trim().toUpperCase()] = !!v;
    }
  }

  // Resolve benchmark. The user can opt out by passing an empty string.
  const benchSymbol =
    body.benchmark === undefined || body.benchmark === null
      ? DEFAULT_BENCHMARK
      : String(body.benchmark).trim().toUpperCase();
  const includeBenchmark =
    benchSymbol.length > 0 && !tickers.includes(benchSymbol);

  // Run user tickers and benchmark concurrently; benchmark uses the same
  // period & schedule so the comparison is apples-to-apples.
  const settledPromise = Promise.all(
    tickers.map<Promise<PerTickerOutcome>>(async (ticker) => {
      try {
        const fetched = await fetchPrices({
          ticker,
          mode: body.mode,
          years: body.years,
          start: body.start,
          end: body.end,
        });
        const result = runDca(ticker, fetched.prices, {
          amount,
          frequency: body.frequency,
          fractional: body.fractional ?? true,
        });

        // Auto-detect covered-call. quoteSummary is best-effort; failures
        // shouldn't stop the backtest from succeeding.
        const summary = await fetchQuoteSummary(ticker).catch(() => null);
        const detection = detectCoveredCall({
          ticker,
          summary,
          dividends: fetched.dividends,
          lastPrice: result.summary.lastPrice,
        });

        const userOverride = overrides[ticker];
        const coveredCallApplied =
          userOverride !== undefined ? userOverride : detection.detected;

        let dividendAnalysis: DividendAnalysis | undefined;
        let reinvestComparison: ReinvestComparison | undefined;
        if (coveredCallApplied && fetched.dividends.length > 0) {
          dividendAnalysis = analyseDividends({
            dcaResult: result,
            rawPrices: fetched.rawPrices,
            dividends: fetched.dividends,
            cadence: detection.cadence,
          });
          try {
            reinvestComparison = compareReinvestment({
              ticker,
              rawPrices: fetched.rawPrices,
              dividends: fetched.dividends,
              amount,
              frequency: body.frequency,
              fractional: body.fractional ?? true,
            });
          } catch {
            // Reinvest sim is non-critical — drop silently if it fails.
            reinvestComparison = undefined;
          }
        }

        return {
          ticker,
          ok: true,
          result,
          detection,
          coveredCallApplied,
          dividendAnalysis,
          reinvestComparison,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ticker, ok: false, error: message };
      }
    }),
  );

  const benchPromise: Promise<PerTickerOutcome | null> = includeBenchmark
    ? (async () => {
        try {
          const { prices } = await fetchPrices({
            ticker: benchSymbol,
            mode: body.mode,
            years: body.years,
            start: body.start,
            end: body.end,
          });
          const result = runDca(benchSymbol, prices, {
            amount,
            frequency: body.frequency,
            fractional: body.fractional ?? true,
          });
          return { ticker: benchSymbol, ok: true, result };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { ticker: benchSymbol, ok: false, error: message };
        }
      })()
    : Promise.resolve(null);

  const [settled, benchmark] = await Promise.all([settledPromise, benchPromise]);

  return NextResponse.json({
    results: settled,
    benchmark,
    benchmarkSymbol: includeBenchmark ? benchSymbol : null,
  });
}
