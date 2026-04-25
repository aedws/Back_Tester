import { NextResponse } from "next/server";

import {
  aggregate,
  junkComponent,
  momentumComponent,
  REQUIRED_TICKERS,
  safeHavenComponent,
  strengthComponent,
  volComponent,
  type SentimentResult,
} from "@/lib/sentiment";
import { yf } from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CacheEntry {
  ts: number;
  data: SentimentResult;
}

// 5-minute server cache. Sentiment changes slowly; this also keeps us well
// inside Yahoo's rate budgets.
let CACHE: CacheEntry | null = null;
const TTL_MS = 5 * 60_000;
const MS_PER_DAY = 86_400_000;

export async function GET() {
  const now = Date.now();
  if (CACHE && now - CACHE.ts < TTL_MS) {
    return NextResponse.json({
      ...CACHE.data,
      cached: true,
      ageMs: now - CACHE.ts,
      ttlMs: TTL_MS,
    });
  }

  try {
    // Pull ~14 months of daily bars so we have enough room for a 252-day
    // window even after weekends/holidays trim the count.
    const period2 = new Date();
    const period1 = new Date(period2.getTime() - 430 * MS_PER_DAY);

    const settled = await Promise.all(
      REQUIRED_TICKERS.map(async (sym) => {
        try {
          const c = await yf.chart(sym, {
            period1,
            period2,
            interval: "1d",
          });
          const closes: number[] = [];
          for (const q of c?.quotes ?? []) {
            const v = q.close as number | null | undefined;
            if (typeof v === "number" && Number.isFinite(v) && v > 0) {
              closes.push(v);
            }
          }
          return { sym, closes };
        } catch {
          return { sym, closes: [] as number[] };
        }
      }),
    );

    const closesBySym: Record<string, number[]> = {};
    for (const s of settled) closesBySym[s.sym] = s.closes;

    const components = [
      volComponent(closesBySym["^VIX"]),
      momentumComponent(closesBySym["^GSPC"]),
      strengthComponent(closesBySym["^GSPC"]),
      junkComponent(closesBySym["HYG"], closesBySym["LQD"]),
      safeHavenComponent(closesBySym["SPY"], closesBySym["TLT"]),
    ];

    const result = aggregate(components);
    CACHE = { ts: now, data: result };
    return NextResponse.json({ ...result, cached: false, ageMs: 0, ttlMs: TTL_MS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (CACHE) {
      return NextResponse.json({
        ...CACHE.data,
        cached: true,
        ageMs: now - CACHE.ts,
        ttlMs: TTL_MS,
        warning: message,
      });
    }
    return NextResponse.json(
      { error: message },
      { status: 502 },
    );
  }
}
