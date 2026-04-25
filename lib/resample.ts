// OHLCV resampling for intervals Yahoo doesn't natively support.
// Used to produce 3m/10m from 1m/5m, 120m/240m from 60m, and yearly bars
// from monthly bars.

export interface Candle {
  date: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Group every N consecutive candles into a single bar. */
export function resampleByCount(
  candles: ReadonlyArray<Candle>,
  groupSize: number,
): Candle[] {
  if (groupSize <= 1) return [...candles];
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += groupSize) {
    const slice = candles.slice(i, i + groupSize);
    if (slice.length === 0) continue;
    out.push(combine(slice));
  }
  return out;
}

/**
 * Group candles into calendar buckets keyed by the supplied function.
 * The first candle in the bucket determines its timestamp.
 */
export function resampleByKey(
  candles: ReadonlyArray<Candle>,
  keyFn: (date: Date) => string,
): Candle[] {
  const out: Candle[] = [];
  let bucket: Candle[] = [];
  let lastKey: string | null = null;
  for (const c of candles) {
    const key = keyFn(new Date(c.date));
    if (key !== lastKey) {
      if (bucket.length > 0) out.push(combine(bucket));
      bucket = [];
      lastKey = key;
    }
    bucket.push(c);
  }
  if (bucket.length > 0) out.push(combine(bucket));
  return out;
}

function combine(slice: ReadonlyArray<Candle>): Candle {
  const first = slice[0];
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  for (const c of slice) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    volume += c.volume;
  }
  return {
    date: first.date,
    open: first.open,
    high,
    low,
    close: slice[slice.length - 1].close,
    volume,
  };
}

/** Yahoo's intraday interval string (only ones we actually feed in). */
export type YahooInterval = "1m" | "5m" | "15m" | "30m" | "60m" | "1d" | "1wk" | "1mo";

export interface IntervalPlan {
  yahoo: YahooInterval;
  multiplier: number;
  /** When set, candles are bucketed by calendar year instead of fixed groupSize. */
  calendar?: "year";
  rangeHint: string;
}

export const UI_INTERVALS = [
  "1m", "3m", "5m", "10m", "15m", "30m", "60m", "120m", "240m",
  "1d", "1wk", "1mo", "1y",
] as const;

export type UiInterval = (typeof UI_INTERVALS)[number];

export const INTERVAL_PLAN: Record<UiInterval, IntervalPlan> = {
  "1m":   { yahoo: "1m",  multiplier: 1, rangeHint: "최근 7일" },
  "3m":   { yahoo: "1m",  multiplier: 3, rangeHint: "최근 7일" },
  "5m":   { yahoo: "5m",  multiplier: 1, rangeHint: "최근 60일" },
  "10m":  { yahoo: "5m",  multiplier: 2, rangeHint: "최근 60일" },
  "15m":  { yahoo: "15m", multiplier: 1, rangeHint: "최근 60일" },
  "30m":  { yahoo: "30m", multiplier: 1, rangeHint: "최근 60일" },
  "60m":  { yahoo: "60m", multiplier: 1, rangeHint: "최근 730일" },
  "120m": { yahoo: "60m", multiplier: 2, rangeHint: "최근 730일" },
  "240m": { yahoo: "60m", multiplier: 4, rangeHint: "최근 730일" },
  "1d":   { yahoo: "1d",  multiplier: 1, rangeHint: "최대 50년" },
  "1wk":  { yahoo: "1wk", multiplier: 1, rangeHint: "최대 50년" },
  "1mo":  { yahoo: "1mo", multiplier: 1, rangeHint: "최대 50년" },
  "1y":   { yahoo: "1mo", multiplier: 1, calendar: "year", rangeHint: "최대 50년" },
};

export const INTERVAL_LABELS: Record<UiInterval, string> = {
  "1m": "1분",
  "3m": "3분",
  "5m": "5분",
  "10m": "10분",
  "15m": "15분",
  "30m": "30분",
  "60m": "60분",
  "120m": "120분",
  "240m": "240분",
  "1d": "일봉",
  "1wk": "주봉",
  "1mo": "월봉",
  "1y": "년봉",
};
