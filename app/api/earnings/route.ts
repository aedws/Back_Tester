import { NextResponse } from "next/server";

import { getEarningsCalendar } from "@/lib/earnings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDayCount(raw: string | null, fallback: number, hardCap: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(hardCap, n));
}

/**
 * GET /api/earnings
 *   ?days=7                  // window length, default 7, capped at 30
 *   ?back=0                  // days of history to include (default 0 → today onward)
 *   ?force=1                 // bypass KV cache and fetch fresh
 *
 * Returns events whose start time falls in
 *   [startOfTodayUTC - back*86400_000, startOfTodayUTC + days*86400_000)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = parseDayCount(url.searchParams.get("days"), 7, 30);
  const back = parseDayCount(url.searchParams.get("back"), 0, 14);
  const force = url.searchParams.get("force") === "1";

  // Anchor on UTC midnight so cache buckets align across requests in a day.
  const today = new Date();
  const utcMidnightToday = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const fromUtcMs = utcMidnightToday - back * DAY_MS;
  const toUtcMs = utcMidnightToday + days * DAY_MS;

  try {
    const data = await getEarningsCalendar({
      fromUtcMs,
      toUtcMs,
      maxRows: 600,
      noCache: force,
    });
    return NextResponse.json({
      ...data,
      windowDays: days,
      backDays: back,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: message, events: [], fromUtcMs, toUtcMs },
      { status: 502 },
    );
  }
}
