import { NextResponse } from "next/server";

import { kvGetJson, kvSetJson } from "@/lib/cache";
import { MARKET_TICKERS } from "@/lib/marketTickers";
import { fetchQuotes, type MarketQuote } from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CacheEntry {
  ts: number;
  data: MarketQuote[];
}

const KV_KEY = "market:quotes:v1";
const TTL_MS = 30_000;
const TTL_S = Math.ceil(TTL_MS / 1000);

// In-memory layer is still useful as an L1 cache (KV is an L2 with much
// higher hit-rate across cold-start instances).
let MEM_CACHE: CacheEntry | null = null;

async function readCache(): Promise<CacheEntry | null> {
  const now = Date.now();
  if (MEM_CACHE && now - MEM_CACHE.ts < TTL_MS) return MEM_CACHE;
  const persisted = await kvGetJson<CacheEntry>(KV_KEY);
  if (persisted && now - persisted.ts < TTL_MS) {
    MEM_CACHE = persisted;
    return persisted;
  }
  return null;
}

async function writeCache(entry: CacheEntry): Promise<void> {
  MEM_CACHE = entry;
  void kvSetJson(KV_KEY, entry, TTL_S).catch(() => undefined);
}

export async function GET() {
  const now = Date.now();
  const cached = await readCache();
  if (cached) {
    return NextResponse.json({
      quotes: cached.data,
      tickers: MARKET_TICKERS,
      cached: true,
      ageMs: now - cached.ts,
      ttlMs: TTL_MS,
    });
  }

  try {
    const symbols = MARKET_TICKERS.map((t) => t.symbol);
    const quotes = await fetchQuotes(symbols);
    const entry: CacheEntry = { ts: now, data: quotes };
    await writeCache(entry);
    return NextResponse.json({
      quotes,
      tickers: MARKET_TICKERS,
      cached: false,
      ageMs: 0,
      ttlMs: TTL_MS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (MEM_CACHE) {
      return NextResponse.json({
        quotes: MEM_CACHE.data,
        tickers: MARKET_TICKERS,
        cached: true,
        ageMs: now - MEM_CACHE.ts,
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
