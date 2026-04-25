/**
 * Incremental price-time-series cache.
 *
 * Strategy
 * --------
 *   - Persist the *full inception-to-now* daily series for each ticker in
 *     a single KV key:  prices:v1:<TICKER>
 *   - On every request:
 *       1. read the cached blob (if any)
 *       2. fetch only the slice we don't already have (last cached date
 *          → today) from Yahoo, plus a 7-day overlap so we self-heal if a
 *          previous fetch ended on a non-trading day
 *       3. merge new candles / dividends / splits into the cached blob
 *       4. write back if anything changed
 *   - Slice the requested window (years / inception / custom) out of the
 *     cached series after merging.
 *
 * This means the second time anyone requests AAPL we only ask Yahoo for
 * the last few days, instead of re-fetching 40+ years of history. Same
 * downstream API behaviour, just with one or two cheap KV round-trips.
 *
 * If KV is not configured the wrapper transparently degrades to a direct
 * Yahoo fetch — same response shape as the original `fetchPrices`.
 */

import {
  fetchPrices,
  type DividendEvent,
  type FetchMode,
  type SplitEvent,
  type RawPricePoint,
  yf,
} from "./yahoo";
import type { PricePoint } from "./backtest";
import { isKvAvailable, kvGetJson, kvSetJson } from "./cache";

const CACHE_VERSION = 1;
const KEY_PREFIX = `prices:v${CACHE_VERSION}:`;
/**
 * Treat an entry as "fresh" if it was updated less than this long ago. We
 * still go to KV (cheap) but skip the Yahoo top-up call until this elapses.
 * Daily candles only update once per session anyway.
 */
const FRESH_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
const OVERLAP_DAYS = 7;
const MS_PER_DAY = 86_400_000;

interface CachedSeries {
  ticker: string;
  /** ISO timestamp of the last successful merge. */
  updatedAt: string;
  /** Inception-aligned adjusted-close series (sorted ascending). */
  prices: PricePoint[];
  /** Inception-aligned raw + adj close points. */
  rawPrices: RawPricePoint[];
  dividends: DividendEvent[];
  splits: SplitEvent[];
}

interface CachedFetchResult {
  ticker: string;
  prices: PricePoint[];
  rawPrices: RawPricePoint[];
  dividends: DividendEvent[];
  splits: SplitEvent[];
  /** Cache diagnostics — useful for debug headers / logs. */
  cacheStatus: "miss" | "hit-fresh" | "hit-topup" | "bypass";
}

function keyFor(ticker: string): string {
  return KEY_PREFIX + ticker.trim().toUpperCase();
}

function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIso(iso: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(iso + "T00:00:00Z")
    : new Date(iso);
}

interface FetchPricesArgs {
  ticker: string;
  mode: FetchMode;
  years?: number;
  start?: string;
  end?: string;
}

/**
 * Drop-in cached replacement for `fetchPrices` that maintains a single
 * inception-to-now series in KV per ticker and slices the user's window
 * out of it. Falls back to direct fetch if KV is unavailable.
 */
export async function fetchPricesCached(
  args: FetchPricesArgs,
): Promise<CachedFetchResult> {
  const ticker = args.ticker.trim().toUpperCase();
  if (!ticker) throw new Error("Ticker is empty");

  if (!isKvAvailable()) {
    const direct = await fetchPrices(args);
    return { ...direct, cacheStatus: "bypass" };
  }

  const cached = await kvGetJson<CachedSeries>(keyFor(ticker));
  let series: CachedSeries | null = sanitizeCached(cached, ticker);

  let cacheStatus: CachedFetchResult["cacheStatus"];

  if (series && isFresh(series)) {
    cacheStatus = "hit-fresh";
  } else if (series) {
    const merged = await topUp(series);
    if (merged) {
      series = merged;
      cacheStatus = "hit-topup";
    } else {
      // Top-up failed — keep using stale cache rather than throwing.
      cacheStatus = "hit-fresh";
    }
  } else {
    // Cold cache — fetch full history & seed.
    const seeded = await seedFromYahoo(ticker);
    if (!seeded) {
      // Yahoo failed and we have nothing cached — propagate by direct
      // fetch (which will throw with its own error message).
      const direct = await fetchPrices(args);
      return { ...direct, cacheStatus: "bypass" };
    }
    series = seeded;
    cacheStatus = "miss";
  }

  if (cacheStatus !== "hit-fresh") {
    // Best-effort persist; never let a KV error fail the request.
    void kvSetJson(keyFor(ticker), series).catch(() => undefined);
  }

  // Slice the user's requested window out of the cached inception series.
  const sliced = sliceWindow(series, args);
  if (sliced.prices.length === 0) {
    // Defensive fallback — empty slice shouldn't happen in practice but
    // we'd rather return live data than error out.
    const direct = await fetchPrices(args);
    return { ...direct, cacheStatus: "bypass" };
  }

  return {
    ticker: series.ticker,
    prices: sliced.prices,
    rawPrices: sliced.rawPrices,
    dividends: sliced.dividends,
    splits: sliced.splits,
    cacheStatus,
  };
}

/* ───────────────────── helpers ───────────────────── */

function sanitizeCached(
  raw: CachedSeries | null,
  ticker: string,
): CachedSeries | null {
  if (!raw || typeof raw !== "object") return null;
  if (!Array.isArray(raw.prices) || raw.prices.length === 0) return null;
  if (raw.ticker?.toUpperCase() !== ticker) return null;
  // Ensure required fields default to safe values.
  return {
    ticker: raw.ticker.toUpperCase(),
    updatedAt: raw.updatedAt || new Date(0).toISOString(),
    prices: raw.prices,
    rawPrices: Array.isArray(raw.rawPrices) ? raw.rawPrices : [],
    dividends: Array.isArray(raw.dividends) ? raw.dividends : [],
    splits: Array.isArray(raw.splits) ? raw.splits : [],
  };
}

function isFresh(series: CachedSeries): boolean {
  const ts = Date.parse(series.updatedAt);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < FRESH_WINDOW_MS;
}

async function seedFromYahoo(ticker: string): Promise<CachedSeries | null> {
  try {
    const fetched = await fetchPrices({ ticker, mode: "inception" });
    return {
      ticker,
      updatedAt: new Date().toISOString(),
      prices: fetched.prices,
      rawPrices: fetched.rawPrices,
      dividends: fetched.dividends,
      splits: fetched.splits,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch only the trailing slice (last cached date − overlap → today) from
 * Yahoo and merge into the cached series. Returns the updated series, or
 * null if the top-up fetch failed entirely.
 */
async function topUp(series: CachedSeries): Promise<CachedSeries | null> {
  const lastDate = series.prices[series.prices.length - 1]?.date;
  if (!lastDate) return null;

  const fromDate = new Date(parseIso(lastDate).getTime() - OVERLAP_DAYS * MS_PER_DAY);
  const toDate = new Date();
  if (toDate.getTime() <= parseIso(lastDate).getTime()) {
    // We're already past today's last bar, nothing to do.
    return { ...series, updatedAt: new Date().toISOString() };
  }

  let chart;
  try {
    chart = await yf.chart(series.ticker, {
      period1: fromDate,
      period2: toDate,
      interval: "1d",
      events: "div|split",
    });
  } catch {
    return null;
  }

  const quotes = chart?.quotes ?? [];
  if (quotes.length === 0) {
    // No new bars — just bump updatedAt so we mark this series as fresh.
    return { ...series, updatedAt: new Date().toISOString() };
  }

  const newPrices: PricePoint[] = [];
  const newRaw: RawPricePoint[] = [];
  for (const q of quotes) {
    const d = q.date instanceof Date ? q.date : new Date(q.date as unknown as string);
    if (isNaN(d.getTime())) continue;
    const close = q.close as number | null | undefined;
    const adj = (q.adjclose ?? q.close) as number | null | undefined;
    if (adj === null || adj === undefined || !Number.isFinite(adj)) continue;
    const iso = toIso(d);
    newPrices.push({ date: iso, close: adj });
    if (typeof close === "number" && Number.isFinite(close) && close > 0) {
      newRaw.push({ date: iso, close: adj, rawClose: close });
    }
  }

  const events = chart?.events as
    | { dividends?: unknown; splits?: unknown }
    | undefined;
  const newDividends = extractDividendsFromEvents(events?.dividends);
  const newSplits = extractSplitsFromEvents(events?.splits);

  const cutoffIso = lastDate; // overlap from cutoff inclusive
  const cleanCachePrices = series.prices.filter((p) => p.date < cutoffIso);
  const cleanCacheRaw = series.rawPrices.filter((p) => p.date < cutoffIso);
  const cleanCacheDivs = series.dividends.filter((p) => p.date < cutoffIso);
  const cleanCacheSplits = series.splits.filter((p) => p.date < cutoffIso);

  const mergedPrices = mergeByDate(cleanCachePrices, newPrices);
  const mergedRaw = mergeByDate(cleanCacheRaw, newRaw);
  const mergedDivs = mergeByDateSum(cleanCacheDivs, newDividends);
  const mergedSplits = mergeByDate(cleanCacheSplits, newSplits);

  return {
    ticker: series.ticker,
    updatedAt: new Date().toISOString(),
    prices: mergedPrices,
    rawPrices: mergedRaw,
    dividends: mergedDivs,
    splits: mergedSplits,
  };
}

function mergeByDate<T extends { date: string }>(a: T[], b: T[]): T[] {
  const map = new Map<string, T>();
  for (const it of a) map.set(it.date, it);
  for (const it of b) map.set(it.date, it); // newer wins on overlap
  return Array.from(map.values()).sort((x, y) =>
    x.date < y.date ? -1 : x.date > y.date ? 1 : 0,
  );
}

function mergeByDateSum(a: DividendEvent[], b: DividendEvent[]): DividendEvent[] {
  // Dividends: prefer the freshly fetched amount when the same date appears
  // in both lists (Yahoo can revise amounts).
  const map = new Map<string, DividendEvent>();
  for (const it of a) map.set(it.date, it);
  for (const it of b) map.set(it.date, it);
  return Array.from(map.values()).sort((x, y) =>
    x.date < y.date ? -1 : x.date > y.date ? 1 : 0,
  );
}

function sliceWindow(
  series: CachedSeries,
  args: FetchPricesArgs,
): {
  prices: PricePoint[];
  rawPrices: RawPricePoint[];
  dividends: DividendEvent[];
  splits: SplitEvent[];
} {
  let startIso: string;
  let endIso: string;
  const today = toIso(new Date());

  if (args.mode === "inception") {
    startIso = "0000-00-00";
    endIso = today;
  } else if (args.mode === "years") {
    const y = args.years && args.years > 0 ? args.years : 10;
    const startMs = Date.now() - Math.round(y * 365.25) * MS_PER_DAY;
    startIso = toIso(new Date(startMs));
    endIso = today;
  } else {
    if (!args.start || !args.end) {
      throw new Error("start and end are required for custom mode");
    }
    startIso = args.start;
    endIso = args.end;
  }

  return {
    prices: series.prices.filter((p) => p.date >= startIso && p.date <= endIso),
    rawPrices: series.rawPrices.filter(
      (p) => p.date >= startIso && p.date <= endIso,
    ),
    dividends: series.dividends.filter(
      (d) => d.date >= startIso && d.date <= endIso,
    ),
    splits: series.splits.filter((s) => s.date >= startIso && s.date <= endIso),
  };
}

/* These mirror the private helpers in lib/yahoo.ts but operate on the
 * already-extracted events object so we don't have to duplicate the
 * fetchPrices call inside the top-up path. */
function extractDividendsFromEvents(raw: unknown): DividendEvent[] {
  if (!raw) return [];
  const list: Array<{ date?: unknown; amount?: unknown }> = Array.isArray(raw)
    ? (raw as Array<{ date?: unknown; amount?: unknown }>)
    : Object.values(raw as Record<string, { date?: unknown; amount?: unknown }>);
  const out: DividendEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const amt = (item as { amount?: unknown }).amount;
    if (typeof amt !== "number" || !Number.isFinite(amt) || amt <= 0) continue;
    const dRaw = (item as { date?: unknown }).date;
    let d: Date | null = null;
    if (dRaw instanceof Date) d = dRaw;
    else if (typeof dRaw === "number") d = new Date(dRaw * (dRaw < 1e12 ? 1000 : 1));
    else if (typeof dRaw === "string") {
      const parsed = new Date(dRaw);
      d = isNaN(parsed.getTime()) ? null : parsed;
    }
    if (!d || isNaN(d.getTime())) continue;
    out.push({ date: toIso(d), amount: amt });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function extractSplitsFromEvents(raw: unknown): SplitEvent[] {
  if (!raw) return [];
  const list: Array<Record<string, unknown>> = Array.isArray(raw)
    ? (raw as Array<Record<string, unknown>>)
    : Object.values(raw as Record<string, Record<string, unknown>>);
  const out: SplitEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const numerator = typeof item.numerator === "number" ? item.numerator : null;
    const denominator =
      typeof item.denominator === "number" ? item.denominator : null;
    let ratio = 0;
    if (numerator !== null && denominator !== null && denominator !== 0) {
      ratio = numerator / denominator;
    } else if (typeof item.splitRatio === "string") {
      const m = item.splitRatio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
      if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (Number.isFinite(a) && Number.isFinite(b) && b > 0) ratio = a / b;
      }
    }
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio === 1) continue;

    const dRaw = item.date;
    let d: Date | null = null;
    if (dRaw instanceof Date) d = dRaw;
    else if (typeof dRaw === "number") d = new Date(dRaw * (dRaw < 1e12 ? 1000 : 1));
    else if (typeof dRaw === "string") {
      const parsed = new Date(dRaw);
      d = isNaN(parsed.getTime()) ? null : parsed;
    }
    if (!d || isNaN(d.getTime())) continue;
    out.push({
      date: toIso(d),
      ratio,
      label:
        typeof item.splitRatio === "string"
          ? (item.splitRatio as string)
          : numerator !== null && denominator !== null
            ? `${numerator}:${denominator}`
            : undefined,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
