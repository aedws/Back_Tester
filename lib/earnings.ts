/**
 * Earnings calendar fetcher (US + KR + global, via Yahoo Finance's
 * unofficial visualization API).
 *
 * The endpoint is the same one used internally by Yahoo's earnings calendar
 * page: it accepts a date range query and returns the earnings reports
 * scheduled to land in that window across every region Yahoo covers. Because
 * it's an unofficial API the response shape can drift; we intentionally
 * return an empty list (rather than throwing) when the response is missing
 * or malformed so the UI degrades gracefully.
 *
 * Endpoint:  POST  https://query1.finance.yahoo.com/v1/finance/visualization
 *
 * Request body example (range query):
 *   {
 *     "size": 250,
 *     "offset": 0,
 *     "sortField": "startdatetime",
 *     "sortType": "ASC",
 *     "entityIdType": "earnings",
 *     "includeFields": ["ticker","companyshortname","startdatetime",
 *                       "startdatetimetype","epsestimate","epsactual",
 *                       "epssurprisepct","intradaymarketcap","timeZoneShortName"],
 *     "query": {
 *       "operator": "AND",
 *       "operands": [
 *         { "operator": "GTE", "operands": ["startdatetime","2026-04-25T00:00:00Z"] },
 *         { "operator": "LT",  "operands": ["startdatetime","2026-05-02T00:00:00Z"] }
 *       ]
 *     }
 *   }
 *
 * Response shape:
 *   { finance: { result: [{ documents: [{ columns: [...], rows: [[...]] }] }] } }
 */

import { kvGetJson, kvSetJson } from "./cache";

export type EarningsTiming =
  | "BMO" // Before Market Open
  | "AMC" // After Market Close
  | "TAS" // Time As Supplied (intraday)
  | "TNS" // Time Not Supplied
  | null;

export type EarningsRegion = "US" | "KR" | "OTHER";

export interface EarningsEvent {
  symbol: string;
  name: string | null;
  date: string; // YYYY-MM-DD (UTC date of the report timestamp)
  startUtcMs: number;
  timing: EarningsTiming;
  /** "1" = call, "2" = report, "11" = stockholders meeting (when present). */
  eventType: string | null;
  epsEstimate: number | null;
  epsActual: number | null;
  surprisePct: number | null;
  marketCap: number | null;
  timeZone: string | null;
  region: EarningsRegion;
}

const VIZ_URL =
  "https://query1.finance.yahoo.com/v1/finance/visualization?lang=en-US&region=US&corsDomain=finance.yahoo.com";

const DEFAULT_FIELDS = [
  "ticker",
  "companyshortname",
  "startdatetime",
  "startdatetimetype",
  "epsestimate",
  "epsactual",
  "epssurprisepct",
  "intradaymarketcap",
  "timeZoneShortName",
  "eventtype",
];

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

function classifyTiming(t: unknown): EarningsTiming {
  const s = asString(t);
  if (!s) return null;
  if (s === "BMO" || s === "AMC" || s === "TAS" || s === "TNS") return s;
  return null;
}

function classifyRegion(symbol: string): EarningsRegion {
  if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) return "KR";
  if (!symbol.includes(".")) return "US";
  return "OTHER";
}

interface VizQueryOperand {
  operator: string;
  operands: unknown[];
}

interface VizColumn {
  id: string;
  label?: string;
  type?: string;
}

async function callVisualization(body: unknown): Promise<{
  columns: VizColumn[];
  rows: unknown[][];
}> {
  const res = await fetch(VIZ_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (compatible; back-test-app/1.0; +https://github.com/aedws/Back_Tester)",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`yahoo visualization http ${res.status}`);
  }
  const json = (await res.json()) as {
    finance?: {
      result?: Array<{
        documents?: Array<{ columns?: VizColumn[]; rows?: unknown[][] }>;
      }>;
      error?: { description?: string } | null;
    };
  };
  if (json?.finance?.error?.description) {
    throw new Error(`yahoo visualization: ${json.finance.error.description}`);
  }
  const doc = json?.finance?.result?.[0]?.documents?.[0];
  return {
    columns: doc?.columns ?? [],
    rows: doc?.rows ?? [],
  };
}

/**
 * Fetch earnings events whose start time falls in [fromUtcMs, toUtcMs).
 * Pages internally if Yahoo returns the maximum batch size.
 */
export async function fetchEarningsCalendar(opts: {
  fromUtcMs: number;
  toUtcMs: number;
  /** Hard cap on rows we return (across all pages). Default 500. */
  maxRows?: number;
}): Promise<EarningsEvent[]> {
  const fromIso = new Date(opts.fromUtcMs).toISOString();
  const toIso = new Date(opts.toUtcMs).toISOString();
  const cap = Math.max(1, Math.min(2000, opts.maxRows ?? 500));

  const events: EarningsEvent[] = [];
  const seen = new Set<string>();

  const pageSize = 250;
  let offset = 0;
  for (let page = 0; page < 8 && events.length < cap; page++) {
    const dateRange: VizQueryOperand = {
      operator: "AND",
      operands: [
        { operator: "GTE", operands: ["startdatetime", fromIso] },
        { operator: "LT", operands: ["startdatetime", toIso] },
      ],
    };
    const body = {
      offset,
      size: pageSize,
      sortField: "startdatetime",
      sortType: "ASC",
      entityIdType: "earnings",
      includeFields: DEFAULT_FIELDS,
      query: dateRange,
    };

    let columns: VizColumn[] = [];
    let rows: unknown[][] = [];
    try {
      ({ columns, rows } = await callVisualization(body));
    } catch {
      break;
    }
    if (rows.length === 0) break;

    const idx = (id: string) => columns.findIndex((c) => c?.id === id);
    const tickerI = idx("ticker");
    const nameI = idx("companyshortname");
    const startI = idx("startdatetime");
    const typeI = idx("startdatetimetype");
    const eventI = idx("eventtype");
    const epsEstI = idx("epsestimate");
    const epsActI = idx("epsactual");
    const surprI = idx("epssurprisepct");
    const mcapI = idx("intradaymarketcap");
    const tzI = idx("timeZoneShortName");

    if (tickerI < 0 || startI < 0) break;

    for (const row of rows) {
      const symbol = asString(row[tickerI]);
      const startStr = asString(row[startI]);
      if (!symbol || !startStr) continue;
      const startMs = Date.parse(startStr);
      if (!Number.isFinite(startMs)) continue;
      const dedupKey = `${symbol}|${startMs}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const dateStr = new Date(startMs).toISOString().slice(0, 10);
      events.push({
        symbol,
        name: nameI >= 0 ? asString(row[nameI]) : null,
        date: dateStr,
        startUtcMs: startMs,
        timing: typeI >= 0 ? classifyTiming(row[typeI]) : null,
        eventType: eventI >= 0 ? asString(row[eventI]) : null,
        epsEstimate: epsEstI >= 0 ? asNumber(row[epsEstI]) : null,
        epsActual: epsActI >= 0 ? asNumber(row[epsActI]) : null,
        surprisePct: surprI >= 0 ? asNumber(row[surprI]) : null,
        marketCap: mcapI >= 0 ? asNumber(row[mcapI]) : null,
        timeZone: tzI >= 0 ? asString(row[tzI]) : null,
        region: classifyRegion(symbol),
      });
      if (events.length >= cap) break;
    }

    if (rows.length < pageSize) break; // last page
    offset += pageSize;
  }

  return events;
}

export interface EarningsResponse {
  events: EarningsEvent[];
  fromUtcMs: number;
  toUtcMs: number;
  fetchedAt: number;
  cached: boolean;
}

/** 6 hours - earnings calendars rarely change intra-day. */
const CACHE_TTL_SECONDS = 6 * 60 * 60;

function cacheKeyFor(fromUtcMs: number, toUtcMs: number): string {
  // Bucket to the hour so identical rolling windows reuse cache for ~1h.
  const fromHr = Math.floor(fromUtcMs / 3_600_000);
  const toHr = Math.floor(toUtcMs / 3_600_000);
  return `earnings:v1:${fromHr}__${toHr}`;
}

export async function getEarningsCalendar(opts: {
  fromUtcMs: number;
  toUtcMs: number;
  maxRows?: number;
  /** Set true to bypass KV cache (forces a fresh upstream fetch). */
  noCache?: boolean;
}): Promise<EarningsResponse> {
  const key = cacheKeyFor(opts.fromUtcMs, opts.toUtcMs);
  if (!opts.noCache) {
    const cached = await kvGetJson<EarningsResponse>(key);
    if (cached && cached.fetchedAt > Date.now() - CACHE_TTL_SECONDS * 1000) {
      return { ...cached, cached: true };
    }
  }
  const events = await fetchEarningsCalendar({
    fromUtcMs: opts.fromUtcMs,
    toUtcMs: opts.toUtcMs,
    maxRows: opts.maxRows,
  });
  const payload: EarningsResponse = {
    events,
    fromUtcMs: opts.fromUtcMs,
    toUtcMs: opts.toUtcMs,
    fetchedAt: Date.now(),
    cached: false,
  };
  await kvSetJson(key, payload, CACHE_TTL_SECONDS).catch(() => undefined);
  return payload;
}
