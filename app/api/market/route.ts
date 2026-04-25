import { NextResponse } from "next/server";

import { MARKET_TICKERS } from "@/lib/marketTickers";
import { fetchQuotes, type MarketQuote } from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CacheEntry {
  ts: number;
  data: MarketQuote[];
}

let CACHE: CacheEntry | null = null;
const TTL_MS = 30_000;

export async function GET() {
  const now = Date.now();
  if (CACHE && now - CACHE.ts < TTL_MS) {
    return NextResponse.json({
      quotes: CACHE.data,
      tickers: MARKET_TICKERS,
      cached: true,
      ageMs: now - CACHE.ts,
      ttlMs: TTL_MS,
    });
  }

  try {
    const symbols = MARKET_TICKERS.map((t) => t.symbol);
    const quotes = await fetchQuotes(symbols);
    CACHE = { ts: now, data: quotes };
    return NextResponse.json({
      quotes,
      tickers: MARKET_TICKERS,
      cached: false,
      ageMs: 0,
      ttlMs: TTL_MS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (CACHE) {
      return NextResponse.json({
        quotes: CACHE.data,
        tickers: MARKET_TICKERS,
        cached: true,
        ageMs: now - CACHE.ts,
        ttlMs: TTL_MS,
        warning: message,
      });
    }
    return NextResponse.json(
      { error: message, tickers: MARKET_TICKERS },
      { status: 502 },
    );
  }
}
