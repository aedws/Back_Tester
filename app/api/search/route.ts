import { NextRequest, NextResponse } from "next/server";

import type { SearchHit } from "@/lib/searchApi";
import { yf } from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CacheEntry {
  ts: number;
  hits: SearchHit[];
}

// Tiny in-memory LRU. Yahoo's search() is rate-limited and the *exact same*
// query gets fired repeatedly while users type, so we keep results around
// for a few minutes.
const TTL_MS = 5 * 60_000;
const MAX_KEYS = 256;
const CACHE = new Map<string, CacheEntry>();

function cacheGet(key: string): SearchHit[] | null {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  // Touch for LRU.
  CACHE.delete(key);
  CACHE.set(key, entry);
  return entry.hits;
}

function cacheSet(key: string, hits: SearchHit[]): void {
  if (CACHE.size >= MAX_KEYS) {
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) CACHE.delete(oldest);
  }
  CACHE.set(key, { ts: Date.now(), hits });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.max(
    1,
    Math.min(15, parseInt(url.searchParams.get("limit") ?? "10", 10) || 10),
  );
  const region = url.searchParams.get("region") ?? undefined;
  const lang = url.searchParams.get("lang") ?? undefined;

  if (q.length < 1) {
    return NextResponse.json({ hits: [], cached: false });
  }

  // Normalise so different casings/whitespace share a cache slot.
  const cacheKey = `${q.toLowerCase()}|${limit}|${region ?? ""}|${lang ?? ""}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return NextResponse.json({ hits: cached, cached: true });
  }

  try {
    const result = await yf.search(
      q,
      {
        quotesCount: limit,
        newsCount: 0,
        enableFuzzyQuery: q.length > 2,
        ...(region ? { region } : {}),
        ...(lang ? { lang } : {}),
      },
      // Skip schema validation: Yahoo regularly adds undocumented fields
      // (e.g. `screenerFieldResults`, `culturalAssets`) that fail strict
      // checks even though the data we care about is intact.
      { validateResult: false },
    );

    const raw = (result as { quotes?: Array<Record<string, unknown>> } | undefined)?.quotes ?? [];

    const hits: SearchHit[] = raw
      .filter((q) => q?.["isYahooFinance"] === true && typeof q?.["symbol"] === "string")
      // Hide options to avoid huge expiry-symbol noise in the dropdown.
      .filter((q) => q?.["quoteType"] !== "OPTION")
      .slice(0, limit)
      .map((q) => ({
        symbol: String(q["symbol"]),
        shortname: q["shortname"] ? String(q["shortname"]) : undefined,
        longname: q["longname"] ? String(q["longname"]) : undefined,
        exchange: q["exchange"] ? String(q["exchange"]) : undefined,
        exchDisp: q["exchDisp"] ? String(q["exchDisp"]) : undefined,
        quoteType: q["quoteType"] ? String(q["quoteType"]) : undefined,
        typeDisp: q["typeDisp"] ? String(q["typeDisp"]) : undefined,
        score: typeof q["score"] === "number" ? (q["score"] as number) : undefined,
      }));

    cacheSet(cacheKey, hits);
    return NextResponse.json({ hits, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ hits: [], error: message }, { status: 502 });
  }
}
