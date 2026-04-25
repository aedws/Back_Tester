import { NextResponse } from "next/server";

import { runDca, type DcaResult, type Frequency } from "@/lib/backtest";
import { fetchPrices, type FetchMode } from "@/lib/yahoo";

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
}

interface PerTickerOutcome {
  ticker: string;
  ok: boolean;
  result?: DcaResult;
  error?: string;
}

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

  const settled = await Promise.all(
    tickers.map<Promise<PerTickerOutcome>>(async (ticker) => {
      try {
        const { prices } = await fetchPrices({
          ticker,
          mode: body.mode,
          years: body.years,
          start: body.start,
          end: body.end,
        });
        const result = runDca(ticker, prices, {
          amount,
          frequency: body.frequency,
          fractional: body.fractional ?? true,
        });
        return { ticker, ok: true, result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ticker, ok: false, error: message };
      }
    }),
  );

  return NextResponse.json({ results: settled });
}
