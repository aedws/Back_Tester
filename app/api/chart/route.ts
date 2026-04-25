import { NextResponse } from "next/server";

import { logLinearChannel, type LogChannelResult } from "@/lib/regression";
import {
  INTERVAL_PLAN,
  UI_INTERVALS,
  resampleByCount,
  resampleByKey,
  type Candle,
  type UiInterval,
} from "@/lib/resample";
import { yf } from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MS_PER_DAY = 86_400_000;

// Yahoo's documented period1 limits per interval. Pulled in slightly so the
// request never falls *on* the documented boundary (Yahoo rejects strict
// equality for some intervals).
const RANGE_DAYS: Record<string, number> = {
  "1m": 7,
  "5m": 55,
  "15m": 55,
  "30m": 55,
  "60m": 720,
  "1d": 50 * 365,
  "1wk": 50 * 365,
  "1mo": 50 * 365,
};

interface ChartCandleDto {
  t: number; // epoch ms (UTC)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
  const intervalParam = (url.searchParams.get("interval") ?? "1d") as UiInterval;
  const rangeDaysParam = url.searchParams.get("days");
  const regressionParam = (url.searchParams.get("regression") ?? "").toLowerCase();

  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }
  if (!UI_INTERVALS.includes(intervalParam)) {
    return NextResponse.json(
      { error: `interval must be one of ${UI_INTERVALS.join(", ")}` },
      { status: 400 },
    );
  }

  const plan = INTERVAL_PLAN[intervalParam];
  const yahooInterval = plan.yahoo;

  const defaultDays = RANGE_DAYS[yahooInterval] ?? 365;
  const userDays = rangeDaysParam ? Number(rangeDaysParam) : defaultDays;
  const rangeDays = Math.min(
    Math.max(Number.isFinite(userDays) ? userDays : defaultDays, 1),
    defaultDays,
  );

  const period2 = new Date();
  const period1 = new Date(period2.getTime() - rangeDays * MS_PER_DAY);

  try {
    const chart = await yf.chart(ticker, {
      period1,
      period2,
      interval: yahooInterval,
    });
    const quotes = chart?.quotes ?? [];

    const native: Candle[] = [];
    for (const q of quotes) {
      const t = q.date instanceof Date ? q.date.getTime() : new Date(q.date as unknown as string).getTime();
      if (!Number.isFinite(t)) continue;
      const o = numOrNull(q.open);
      const h = numOrNull(q.high);
      const l = numOrNull(q.low);
      const c = numOrNull(q.close);
      const v = numOrNull(q.volume);
      if (o === null || h === null || l === null || c === null) continue;
      native.push({
        date: t,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v ?? 0,
      });
    }

    let bucketed: Candle[];
    if (plan.calendar === "year") {
      bucketed = resampleByKey(native, (d) => String(d.getUTCFullYear()));
    } else if (plan.multiplier > 1) {
      bucketed = resampleByCount(native, plan.multiplier);
    } else {
      bucketed = native;
    }

    const candles: ChartCandleDto[] = bucketed.map((c) => ({
      t: c.date,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    }));

    let regressionChannel: LogChannelResult | null = null;
    if (regressionParam === "log") {
      regressionChannel = logLinearChannel(
        bucketed.map((c) => ({ t: c.date, close: c.close })),
      );
    }

    return NextResponse.json({
      ticker,
      interval: intervalParam,
      yahooInterval,
      rangeDays,
      candles,
      currency: chartMeta(chart, "currency"),
      shortName: chartMeta(chart, "shortName") ?? chartMeta(chart, "longName"),
      regularMarketPrice: chartMeta(chart, "regularMarketPrice"),
      regressionChannel,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function chartMeta(
  chart: { meta?: Record<string, unknown> } | null | undefined,
  key: string,
): string | number | null {
  const v = chart?.meta?.[key];
  if (typeof v === "string" || typeof v === "number") return v;
  return null;
}
