import YahooFinance from "yahoo-finance2";

import type { PricePoint } from "./backtest";

export type FetchMode = "years" | "inception" | "custom";

export interface FetchPricesArgs {
  ticker: string;
  mode: FetchMode;
  years?: number;
  start?: string; // YYYY-MM-DD
  end?: string;   // YYYY-MM-DD
}

const MS_PER_DAY = 86_400_000;

// Yahoo's chart endpoint aggressively rate-limits requests with a default
// Node `undici` user agent. A real browser UA + Accept header makes the
// requests look ordinary and is the documented workaround.
const yf = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
  fetchOptions: {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
  },
});

function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function fetchPrices(args: FetchPricesArgs): Promise<{
  ticker: string;
  prices: PricePoint[];
}> {
  const ticker = args.ticker.trim().toUpperCase();
  if (!ticker) throw new Error("Ticker is empty");

  let period1: Date;
  let period2: Date;

  if (args.mode === "inception") {
    // Yahoo treats very-old period1 as "from inception".
    period1 = new Date("1970-01-01T00:00:00Z");
    period2 = new Date();
  } else if (args.mode === "years") {
    const y = args.years && args.years > 0 ? args.years : 10;
    period2 = new Date();
    period1 = new Date(period2.getTime() - Math.round(y * 365.25) * MS_PER_DAY);
  } else {
    if (!args.start || !args.end) {
      throw new Error("start and end are required for custom mode");
    }
    period1 = new Date(args.start + "T00:00:00Z");
    period2 = new Date(args.end + "T00:00:00Z");
    period2 = new Date(period2.getTime() + MS_PER_DAY);
  }

  const chart = await yf.chart(ticker, {
    period1,
    period2,
    interval: "1d",
    events: "div|split",
  });

  const quotes = chart?.quotes ?? [];
  if (quotes.length === 0) {
    throw new Error(`No price data returned for '${ticker}'`);
  }

  // Use adjclose when available (dividend & split adjusted), fall back to close.
  const prices: PricePoint[] = [];
  for (const q of quotes) {
    const d = q.date instanceof Date ? q.date : new Date(q.date as unknown as string);
    if (isNaN(d.getTime())) continue;
    const adj = (q.adjclose ?? q.close) as number | null | undefined;
    if (adj === null || adj === undefined || !Number.isFinite(adj)) continue;
    prices.push({ date: toIso(d), close: adj });
  }

  if (prices.length === 0) {
    throw new Error(`No usable adjusted prices for '${ticker}'`);
  }

  return { ticker, prices };
}
