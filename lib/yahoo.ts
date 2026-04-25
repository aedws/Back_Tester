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
export const yf = new YahooFinance({
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

export interface MarketQuote {
  symbol: string;
  shortName: string | null;
  price: number | null;
  change: number | null;
  /** Percent value already scaled (1.23 = 1.23%). */
  changePercent: number | null;
  prevClose: number | null;
  currency: string | null;
  marketState: string | null;
}

/**
 * Fetch many quotes in parallel. Uses Yahoo's chart endpoint (no crumb auth
 * required, unlike `quote()` which currently fails with
 * "No set-cookie header present in Yahoo's response"). For each symbol we
 * grab the last ~7 days of daily candles and derive the last price + the
 * change vs. the prior session close.
 */
export async function fetchQuotes(symbols: string[]): Promise<MarketQuote[]> {
  const cleaned = symbols.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];

  // 7 days back is enough to span weekends/holidays and still return at
  // least 2 daily candles (today + previous trading day).
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - 7 * MS_PER_DAY);

  const results = await Promise.allSettled(
    cleaned.map((symbol) =>
      yf
        .chart(symbol, {
          period1,
          period2,
          interval: "1d",
        })
        .then((chart) => ({ symbol, chart })),
    ),
  );

  const quotes: MarketQuote[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const symbol = cleaned[i];
    const settled = results[i];
    if (settled.status !== "fulfilled") {
      quotes.push(emptyQuote(symbol));
      continue;
    }
    const candles = settled.value.chart?.quotes ?? [];
    const meta = settled.value.chart?.meta as Record<string, unknown> | undefined;
    quotes.push(buildQuoteFromCandles(symbol, candles, meta));
  }
  return quotes;
}

function emptyQuote(symbol: string): MarketQuote {
  return {
    symbol,
    shortName: null,
    price: null,
    change: null,
    changePercent: null,
    prevClose: null,
    currency: null,
    marketState: null,
  };
}

interface Candle {
  close?: number | null;
  date?: Date | string;
}

function buildQuoteFromCandles(
  symbol: string,
  candles: Candle[],
  meta?: Record<string, unknown>,
): MarketQuote {
  // Pick the last two candles whose close is finite.
  const valid = candles.filter(
    (c) => typeof c.close === "number" && Number.isFinite(c.close),
  ) as Array<Candle & { close: number }>;
  if (valid.length === 0) return emptyQuote(symbol);

  const last = valid[valid.length - 1];
  // Prefer meta.regularMarketPrice & meta.previousClose if available — those
  // reflect the *intraday* live price (vs the latest daily close which is
  // yesterday's during pre-market).
  const metaPrice =
    meta && typeof meta.regularMarketPrice === "number"
      ? (meta.regularMarketPrice as number)
      : null;
  const metaPrev =
    meta && typeof (meta.chartPreviousClose ?? meta.previousClose) === "number"
      ? (meta.chartPreviousClose ?? meta.previousClose) as number
      : null;
  const metaCurrency =
    meta && typeof meta.currency === "string" ? (meta.currency as string) : null;
  const metaState =
    meta && typeof meta.marketState === "string"
      ? (meta.marketState as string)
      : null;
  const metaName =
    meta && typeof meta.shortName === "string"
      ? (meta.shortName as string)
      : meta && typeof meta.longName === "string"
      ? (meta.longName as string)
      : null;

  const price = metaPrice ?? last.close;
  const prev = metaPrev ?? (valid.length >= 2 ? valid[valid.length - 2].close : null);
  const change =
    typeof prev === "number" && Number.isFinite(prev) ? price - prev : null;
  const changePct =
    typeof prev === "number" && Number.isFinite(prev) && prev !== 0
      ? ((price - prev) / prev) * 100
      : null;

  return {
    symbol,
    shortName: metaName,
    price,
    change,
    changePercent: changePct,
    prevClose: prev,
    currency: metaCurrency,
    marketState: metaState,
  };
}

function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface DividendEvent {
  /** ISO date (YYYY-MM-DD, UTC). */
  date: string;
  /** Per-share cash distribution. */
  amount: number;
}

export interface SplitEvent {
  /** ISO date (YYYY-MM-DD, UTC). */
  date: string;
  /** numerator / denominator e.g. 4-for-1 → ratio 4. */
  ratio: number;
  /** Yahoo's display label, e.g. "4:1". May be undefined. */
  label?: string;
}

export interface RawPricePoint extends PricePoint {
  /** Unadjusted (price-return only) close — useful for separating dividend
   * cash flow from price action. */
  rawClose: number;
}

export async function fetchPrices(args: FetchPricesArgs): Promise<{
  ticker: string;
  prices: PricePoint[];
  rawPrices: RawPricePoint[];
  dividends: DividendEvent[];
  splits: SplitEvent[];
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
  const rawPrices: RawPricePoint[] = [];
  for (const q of quotes) {
    const d = q.date instanceof Date ? q.date : new Date(q.date as unknown as string);
    if (isNaN(d.getTime())) continue;
    const close = q.close as number | null | undefined;
    const adj = (q.adjclose ?? q.close) as number | null | undefined;
    if (adj === null || adj === undefined || !Number.isFinite(adj)) continue;
    const iso = toIso(d);
    prices.push({ date: iso, close: adj });
    if (typeof close === "number" && Number.isFinite(close) && close > 0) {
      rawPrices.push({ date: iso, close: adj, rawClose: close });
    }
  }

  if (prices.length === 0) {
    throw new Error(`No usable adjusted prices for '${ticker}'`);
  }

  const dividends = extractDividends(chart?.events);
  const splits = extractSplits(chart?.events);
  return { ticker, prices, rawPrices, dividends, splits };
}

function extractDividends(events: unknown): DividendEvent[] {
  if (!events || typeof events !== "object") return [];
  const e = events as { dividends?: unknown };
  const raw = e.dividends;
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
    if (dRaw instanceof Date) {
      d = dRaw;
    } else if (typeof dRaw === "number") {
      d = new Date(dRaw * (dRaw < 1e12 ? 1000 : 1));
    } else if (typeof dRaw === "string") {
      const parsed = new Date(dRaw);
      d = isNaN(parsed.getTime()) ? null : parsed;
    }
    if (!d || isNaN(d.getTime())) continue;
    out.push({ date: toIso(d), amount: amt });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

function extractSplits(events: unknown): SplitEvent[] {
  if (!events || typeof events !== "object") return [];
  const e = events as { splits?: unknown };
  const raw = e.splits;
  if (!raw) return [];

  const list: Array<Record<string, unknown>> = Array.isArray(raw)
    ? (raw as Array<Record<string, unknown>>)
    : Object.values(raw as Record<string, Record<string, unknown>>);

  const out: SplitEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const numerator = toFiniteOrNull(item.numerator);
    const denominator = toFiniteOrNull(item.denominator);
    let ratio = 0;
    if (numerator !== null && denominator !== null && denominator !== 0) {
      ratio = numerator / denominator;
    } else {
      const sr = item.splitRatio;
      if (typeof sr === "string") {
        const m = sr.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
        if (m) {
          const a = Number(m[1]);
          const b = Number(m[2]);
          if (Number.isFinite(a) && Number.isFinite(b) && b > 0) ratio = a / b;
        }
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

    const label =
      typeof item.splitRatio === "string"
        ? (item.splitRatio as string)
        : numerator !== null && denominator !== null
          ? `${numerator}:${denominator}`
          : undefined;

    out.push({ date: toIso(d), ratio, label });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

// ---------------------------------------------------------------------------
// quoteSummary helper — used to detect covered-call ETFs from name/description.
// ---------------------------------------------------------------------------
export interface QuoteSummary {
  symbol: string;
  longName: string | null;
  shortName: string | null;
  longBusinessSummary: string | null;
  category: string | null;
  legalType: string | null;
  quoteType: string | null;
  currency: string | null;
  /** Trailing dividend yield as a fraction (0.07 = 7%). */
  dividendYield: number | null;
  /** Trailing annual dividend rate ($ per share). */
  dividendRate: number | null;
}

const QS_CACHE = new Map<string, { at: number; data: QuoteSummary | null }>();
const QS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours; ETF metadata rarely changes.

export async function fetchQuoteSummary(
  ticker: string,
): Promise<QuoteSummary | null> {
  const sym = ticker.trim().toUpperCase();
  if (!sym) return null;
  const cached = QS_CACHE.get(sym);
  if (cached && Date.now() - cached.at < QS_TTL_MS) return cached.data;

  try {
    const r = (await yf.quoteSummary(sym, {
      modules: ["summaryProfile", "summaryDetail", "price", "assetProfile"],
    })) as {
      summaryProfile?: { longBusinessSummary?: string };
      assetProfile?: { longBusinessSummary?: string; category?: string; legalType?: string };
      summaryDetail?: { dividendYield?: number; dividendRate?: number; trailingAnnualDividendYield?: number; trailingAnnualDividendRate?: number; currency?: string };
      price?: {
        longName?: string;
        shortName?: string;
        currency?: string;
        quoteType?: string;
      };
    };

    const summary: QuoteSummary = {
      symbol: sym,
      longName: r.price?.longName ?? null,
      shortName: r.price?.shortName ?? null,
      longBusinessSummary:
        r.summaryProfile?.longBusinessSummary ??
        r.assetProfile?.longBusinessSummary ??
        null,
      category: r.assetProfile?.category ?? null,
      legalType: r.assetProfile?.legalType ?? null,
      quoteType: r.price?.quoteType ?? null,
      currency: r.price?.currency ?? r.summaryDetail?.currency ?? null,
      dividendYield:
        toFiniteOrNull(r.summaryDetail?.dividendYield) ??
        toFiniteOrNull(r.summaryDetail?.trailingAnnualDividendYield),
      dividendRate:
        toFiniteOrNull(r.summaryDetail?.dividendRate) ??
        toFiniteOrNull(r.summaryDetail?.trailingAnnualDividendRate),
    };
    QS_CACHE.set(sym, { at: Date.now(), data: summary });
    return summary;
  } catch {
    QS_CACHE.set(sym, { at: Date.now(), data: null });
    return null;
  }
}

function toFiniteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
