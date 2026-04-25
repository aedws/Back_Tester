/**
 * Earnings calendar fetcher (US + KR + global).
 *
 * The previous implementation pulled from Yahoo's unofficial visualization
 * endpoint, which started returning empty payloads from Vercel servers
 * (likely IP-based bot mitigation). We now go to two stable, free sources:
 *
 *   1. **Nasdaq Calendar API** for US earnings (one HTTP request per day in
 *      the requested window). Stable, no auth, returns marketCap + EPS
 *      forecast + announce-time bucket per row.
 *
 *   2. **Yahoo Finance quoteSummary** (`calendarEvents`) for a curated
 *      KOSPI / KOSDAQ watchlist (see `lib/krWatchlist.ts`). Per-symbol
 *      lookups so we are not at the mercy of any aggregate endpoint.
 *
 * Results are merged, de-duplicated, and persisted to KV with a long TTL
 * (default 7 days). Earnings dates rarely move so a stale-but-correct cached
 * answer is far better than a fresh-but-empty one when an upstream is
 * temporarily unavailable.
 */

import { kvGetJson, kvSetJson } from "./cache";
import { KR_EARNINGS_WATCHLIST } from "./krWatchlist";
import { yf } from "./yahoo";

export type EarningsTiming = "BMO" | "AMC" | "TAS" | "TNS" | null;
export type EarningsRegion = "US" | "KR" | "OTHER";

export interface EarningsEvent {
  symbol: string;
  name: string | null;
  date: string; // YYYY-MM-DD (UTC)
  startUtcMs: number;
  timing: EarningsTiming;
  /** Free-text from upstream. We do not normalize the meaning. */
  eventType: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
  surprisePct: number | null;
  marketCap: number | null;
  timeZone: string | null;
  region: EarningsRegion;
}

export interface EarningsSourceStat {
  source: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface EarningsResponse {
  events: EarningsEvent[];
  fromUtcMs: number;
  toUtcMs: number;
  fetchedAt: number;
  cached: boolean;
  sources: EarningsSourceStat[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** 7 days — earnings dates rarely move, and aggressive caching keeps us
 *  well below upstream rate limits. */
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function classifyRegion(symbol: string): EarningsRegion {
  if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) return "KR";
  if (!symbol.includes(".")) return "US";
  return "OTHER";
}

/** Parse strings like "$3.01T", "$1,234.5B", "$1,234,567,890", "1.5M". */
function parseMoney(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[$,\s]/g, "").trim();
  if (!s || s === "N/A" || s === "--") return null;
  const last = s.slice(-1).toUpperCase();
  let multiplier = 1;
  let body = s;
  if ("BMTK".includes(last)) {
    body = s.slice(0, -1);
    if (last === "T") multiplier = 1e12;
    else if (last === "B") multiplier = 1e9;
    else if (last === "M") multiplier = 1e6;
    else if (last === "K") multiplier = 1e3;
  }
  const n = Number(body);
  if (!Number.isFinite(n)) return null;
  return n * multiplier;
}

function parseEps(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[$,\s]/g, "").replace(/[()]/g, "").trim();
  if (!s || s === "N/A" || s === "--") return null;
  // "$(0.12)" → -0.12 was already stripped of parens; older Nasdaq rows
  // may also use literal "-" sign so a plain Number() cast works.
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function nasdaqTimingToTiming(t: string | null | undefined): EarningsTiming {
  if (!t) return null;
  if (t.includes("pre-market")) return "BMO";
  if (t.includes("after-hours")) return "AMC";
  if (t.includes("not-supplied")) return "TNS";
  return "TAS";
}

function ymdUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ────────────────────────────────────────────────────────────────────────
// Source 1: Nasdaq calendar (US)
// ────────────────────────────────────────────────────────────────────────

interface NasdaqRow {
  symbol?: string;
  name?: string;
  marketCap?: string;
  fiscalQuarterEnding?: string;
  epsForecast?: string;
  noOfEsts?: string;
  lastYearRptDt?: string;
  lastYearEPS?: string;
  /** "time-pre-market" | "time-after-hours" | "time-not-supplied". */
  time?: string;
}

interface NasdaqResponse {
  data?: { rows?: NasdaqRow[] | null } | null;
  status?: { rCode?: number; bCodeMessage?: unknown } | null;
}

async function fetchNasdaqEarningsForDay(
  dateUtcMs: number,
): Promise<EarningsEvent[]> {
  const dateIso = ymdUtc(dateUtcMs);
  const url = `https://api.nasdaq.com/api/calendar/earnings?date=${dateIso}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      // Nasdaq rejects requests with no/unknown User-Agent. Pretend to be a
      // recent Chrome, otherwise the API returns 403/empty.
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      origin: "https://www.nasdaq.com",
      referer: "https://www.nasdaq.com/",
    },
    cache: "no-store",
    // Nasdaq sometimes hangs > 8s; bound the request for serverless safety.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`nasdaq http ${res.status}`);
  }
  const json = (await res.json()) as NasdaqResponse;
  const rows = json?.data?.rows ?? [];
  const out: EarningsEvent[] = [];
  for (const row of rows) {
    const symbol = (row?.symbol ?? "").trim();
    if (!symbol) continue;
    const timing = nasdaqTimingToTiming(row.time);
    // We only know the calendar day, not the actual hour. Anchor to UTC
    // noon so day grouping still works no matter the viewer's timezone.
    const startUtcMs = dateUtcMs + 12 * 60 * 60 * 1000;
    out.push({
      symbol,
      name: (row.name ?? "").trim() || null,
      date: dateIso,
      startUtcMs,
      timing,
      eventType: row.fiscalQuarterEnding ?? null,
      epsEstimate: parseEps(row.epsForecast),
      epsActual: null,
      surprisePct: null,
      marketCap: parseMoney(row.marketCap),
      timeZone: "America/New_York",
      region: classifyRegion(symbol),
    });
  }
  return out;
}

async function fetchUSEarnings(
  fromUtcMs: number,
  toUtcMs: number,
  stats: EarningsSourceStat[],
): Promise<EarningsEvent[]> {
  const collected: EarningsEvent[] = [];
  let okDays = 0;
  let firstError: string | undefined;
  for (let day = fromUtcMs; day < toUtcMs; day += DAY_MS) {
    try {
      const events = await fetchNasdaqEarningsForDay(day);
      collected.push(...events);
      okDays++;
    } catch (err) {
      if (!firstError) {
        firstError = err instanceof Error ? err.message : String(err);
      }
    }
  }
  stats.push({
    source: "nasdaq-calendar",
    ok: okDays > 0,
    count: collected.length,
    error: okDays === 0 ? firstError : undefined,
  });
  return collected;
}

// ────────────────────────────────────────────────────────────────────────
// Source 2: Yahoo quoteSummary per KR ticker
// ────────────────────────────────────────────────────────────────────────

async function fetchKREarnings(
  fromUtcMs: number,
  toUtcMs: number,
  stats: EarningsSourceStat[],
): Promise<EarningsEvent[]> {
  const collected: EarningsEvent[] = [];
  let firstError: string | undefined;
  let okCount = 0;

  // Process in small parallel batches to keep the burst rate reasonable.
  const batchSize = 8;
  for (let i = 0; i < KR_EARNINGS_WATCHLIST.length; i += batchSize) {
    const slice = KR_EARNINGS_WATCHLIST.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      slice.map(async (entry) => {
        // The library's overloaded type narrows the return when only one
        // module is requested; cast to any so we can ask for both at once.
        const res = (await (
          yf.quoteSummary as unknown as (
            symbol: string,
            opts: { modules: string[] },
          ) => Promise<any>
        )(entry.symbol, {
          modules: ["calendarEvents", "price"],
        })) as {
          calendarEvents?: {
            earnings?: {
              earningsDate?: unknown[];
              earningsAverage?: number;
            };
          };
          price?: { shortName?: string; marketCap?: number };
        };
        return { entry, res };
      }),
    );
    for (const r of results) {
      if (r.status !== "fulfilled") {
        if (!firstError) {
          firstError =
            r.reason instanceof Error
              ? r.reason.message
              : String(r.reason);
        }
        continue;
      }
      okCount++;
      const { entry, res } = r.value;
      const ed = res?.calendarEvents?.earnings?.earningsDate;
      const dates = Array.isArray(ed) ? ed : [];
      for (const d of dates) {
        const ms = d instanceof Date ? d.getTime() : Date.parse(String(d));
        if (!Number.isFinite(ms)) continue;
        if (ms < fromUtcMs || ms >= toUtcMs) continue;
        const epsEstimate = res.calendarEvents?.earnings?.earningsAverage;
        const marketCap = res.price?.marketCap;
        collected.push({
          symbol: entry.symbol,
          name: res.price?.shortName ?? entry.name,
          date: ymdUtc(ms),
          startUtcMs: ms,
          // Korean disclosures publish after market close in KRX time;
          // mark TNS to avoid implying we know precisely.
          timing: "TNS",
          eventType: null,
          epsEstimate: typeof epsEstimate === "number" ? epsEstimate : null,
          epsActual: null,
          surprisePct: null,
          marketCap: typeof marketCap === "number" ? marketCap : null,
          timeZone: "Asia/Seoul",
          region: "KR",
        });
      }
    }
  }
  stats.push({
    source: "yahoo-quotesummary-kr",
    ok: okCount > 0,
    count: collected.length,
    error: okCount === 0 ? firstError : undefined,
  });
  return collected;
}

// ────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────

function dedupeAndSort(events: EarningsEvent[]): EarningsEvent[] {
  const seen = new Map<string, EarningsEvent>();
  for (const e of events) {
    const key = `${e.symbol}|${e.date}`;
    const prev = seen.get(key);
    // Prefer the entry with more data (eps estimate / market cap filled).
    if (!prev) {
      seen.set(key, e);
      continue;
    }
    const score = (x: EarningsEvent) =>
      (x.epsEstimate != null ? 1 : 0) +
      (x.marketCap != null ? 1 : 0) +
      (x.timing && x.timing !== "TNS" ? 1 : 0);
    if (score(e) > score(prev)) seen.set(key, e);
  }
  return Array.from(seen.values()).sort((a, b) => a.startUtcMs - b.startUtcMs);
}

function cacheKeyFor(fromUtcMs: number, toUtcMs: number): string {
  // Bucket to UTC day so the same logical "next 7 days from today" window
  // shares cache for a full day. The "v3" prefix invalidates older payloads
  // (which were built against an 80-symbol KR watchlist).
  const fromDay = Math.floor(fromUtcMs / DAY_MS);
  const toDay = Math.floor(toUtcMs / DAY_MS);
  return `earnings:v3:${fromDay}__${toDay}`;
}

export async function getEarningsCalendar(opts: {
  fromUtcMs: number;
  toUtcMs: number;
  /** Bypass KV cache and force fresh fetch from upstreams. */
  noCache?: boolean;
  /** Override default 7-day TTL. */
  ttlSeconds?: number;
}): Promise<EarningsResponse> {
  const key = cacheKeyFor(opts.fromUtcMs, opts.toUtcMs);
  const ttlSeconds = opts.ttlSeconds ?? CACHE_TTL_SECONDS;

  if (!opts.noCache) {
    const cached = await kvGetJson<EarningsResponse>(key);
    if (cached && cached.fetchedAt > Date.now() - ttlSeconds * 1000) {
      return { ...cached, cached: true };
    }
  }

  const stats: EarningsSourceStat[] = [];
  const [usEvents, krEvents] = await Promise.all([
    fetchUSEarnings(opts.fromUtcMs, opts.toUtcMs, stats).catch((err) => {
      stats.push({
        source: "nasdaq-calendar",
        ok: false,
        count: 0,
        error: err instanceof Error ? err.message : String(err),
      });
      return [] as EarningsEvent[];
    }),
    fetchKREarnings(opts.fromUtcMs, opts.toUtcMs, stats).catch((err) => {
      stats.push({
        source: "yahoo-quotesummary-kr",
        ok: false,
        count: 0,
        error: err instanceof Error ? err.message : String(err),
      });
      return [] as EarningsEvent[];
    }),
  ]);

  const events = dedupeAndSort([...usEvents, ...krEvents]);
  const payload: EarningsResponse = {
    events,
    fromUtcMs: opts.fromUtcMs,
    toUtcMs: opts.toUtcMs,
    fetchedAt: Date.now(),
    cached: false,
    sources: stats,
  };

  // Only cache if at least one source returned something. Otherwise we'd be
  // pinning an empty payload for a week and the bar would stay broken even
  // after upstreams recover.
  if (events.length > 0) {
    await kvSetJson(key, payload, ttlSeconds).catch(() => undefined);
  } else {
    // For total-empty results, write a *short-TTL* placeholder so we don't
    // hammer the upstreams from every page load while still recovering soon.
    await kvSetJson(key, payload, 15 * 60).catch(() => undefined);
  }
  return payload;
}
