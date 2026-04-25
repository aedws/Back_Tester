// Sliding-window DCA distribution.
//
// Given a long price history, run the same DCA strategy from *every* viable
// start point (one per month) over a fixed window length, and return the
// distribution of annualized IRR outcomes. This answers questions like:
// "If I had started this DCA at any month in the last 30 years, what would
// my N-year return have looked like?".

import { runDca, type Frequency, type PricePoint } from "@/lib/backtest";

export interface DistributionPercentiles {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface DistributionBin {
  /** Lower bound of the bin (inclusive), expressed as decimal IRR (0.05 = 5%) */
  lo: number;
  /** Upper bound (exclusive). */
  hi: number;
  /** Number of samples in this bin. */
  count: number;
}

export interface WindowDistribution {
  ticker: string;
  /** Window length in years used for every sample. */
  windowYears: number;
  /** How many starts (and IRR samples) we generated. */
  sampleCount: number;
  /**
   * Total years of history we had access to. (For UI text — "from 30 years
   * of data we have N starts".)
   */
  historyYears: number;
  percentiles: DistributionPercentiles;
  mean: number;
  /** Histogram bins (10 bins between p5−margin and p95+margin). */
  bins: DistributionBin[];
  /** The IRR of the *current* run — the one the user actually ran. Lets the
   *  UI show "your run sits in the K-th percentile of historical starts." */
  current: number | null;
  /** Percentile rank (0–100) of `current` within the sampled distribution.
   *  null when current is null. */
  currentPercentile: number | null;
}

export interface BuildDistributionArgs {
  ticker: string;
  prices: PricePoint[];
  windowYears: number;
  unitMode?: "amount" | "shares";
  amount?: number;
  shares?: number;
  frequency: Frequency;
  fractional: boolean;
  fractionalShares?: boolean;
  /** IRR of the user's actual run. */
  currentIrr: number | null;
  /** Cap on the number of slices we run — defaults to 240 (20y of monthly starts). */
  maxSamples?: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Build a sliding-window distribution by running an N-year DCA from each
 * viable monthly start. We keep this inside the same backtest engine so the
 * outcomes are directly comparable to the user's run.
 */
export function buildWindowDistribution(
  args: BuildDistributionArgs,
): WindowDistribution | null {
  const {
    ticker,
    prices,
    windowYears,
    unitMode = "amount",
    amount,
    shares,
    frequency,
    fractional,
    fractionalShares = false,
    currentIrr,
    maxSamples = 240,
  } = args;

  if (!Array.isArray(prices) || prices.length < 60 || windowYears <= 0) {
    return null;
  }

  // We need at least *one* full window of history beyond the first available
  // bar, otherwise there's nothing to slide.
  const totalYears = yearsBetween(prices[0].date, prices[prices.length - 1].date);
  if (!Number.isFinite(totalYears) || totalYears < windowYears + 0.5) {
    return null;
  }

  const startsCount = Math.floor((totalYears - windowYears) * 12) + 1;
  if (startsCount < 6) return null;

  // If we have many candidate starts, decimate to keep total compute bounded.
  const stride = Math.max(1, Math.ceil(startsCount / maxSamples));

  // Index prices by month-key for efficient lookup of "first trading day on
  // or after month X".
  const sorted = [...prices]
    .filter((p) => Number.isFinite(p.close) && p.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (sorted.length < 60) return null;

  const firstDate = parseUtc(sorted[0].date);
  const lastDate = parseUtc(sorted[sorted.length - 1].date);

  const samples: number[] = [];

  for (let s = 0; s < startsCount; s += stride) {
    const startCursor = addMonths(firstDate, s);
    const endCursor = addYears(startCursor, windowYears);
    if (endCursor > lastDate) break;

    const sliceStartIdx = lowerBound(sorted, toIso(startCursor));
    const sliceEndIdx = upperBound(sorted, toIso(endCursor));
    if (sliceEndIdx - sliceStartIdx < 30) continue;

    const slice = sorted.slice(sliceStartIdx, sliceEndIdx);
    try {
      const result = runDca(ticker, slice, {
        unitMode,
        amount,
        shares,
        frequency,
        fractional,
        fractionalShares,
      });
      const irr = result.summary.irrAnnualized;
      if (irr !== null && Number.isFinite(irr)) {
        samples.push(irr);
      }
    } catch {
      // Slice too short / no buy dates — skip.
    }
  }

  if (samples.length < 5) return null;

  samples.sort((a, b) => a - b);
  const percentiles: DistributionPercentiles = {
    p5: quantile(samples, 0.05),
    p25: quantile(samples, 0.25),
    p50: quantile(samples, 0.5),
    p75: quantile(samples, 0.75),
    p95: quantile(samples, 0.95),
  };
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

  // Histogram bounds widen slightly past the 5/95th percentiles so an outlier
  // current run still lands inside.
  const span = Math.max(0.005, percentiles.p95 - percentiles.p5);
  const lo = percentiles.p5 - span * 0.1;
  const hi = percentiles.p95 + span * 0.1;
  const binCount = 10;
  const binWidth = (hi - lo) / binCount;
  const bins: DistributionBin[] = Array.from({ length: binCount }, (_, i) => ({
    lo: lo + i * binWidth,
    hi: lo + (i + 1) * binWidth,
    count: 0,
  }));
  for (const v of samples) {
    let idx = Math.floor((v - lo) / binWidth);
    if (idx < 0) idx = 0;
    if (idx >= binCount) idx = binCount - 1;
    bins[idx].count += 1;
  }

  const currentPercentile =
    currentIrr === null || !Number.isFinite(currentIrr)
      ? null
      : percentRank(samples, currentIrr);

  return {
    ticker,
    windowYears,
    sampleCount: samples.length,
    historyYears: totalYears,
    percentiles,
    mean,
    bins,
    current: currentIrr,
    currentPercentile,
  };
}

/* ───────────────────── helpers ───────────────────── */

function parseUtc(date: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Date(date + "T00:00:00Z");
  }
  return new Date(date);
}

function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yearsBetween(a: string, b: string): number {
  const da = parseUtc(a).getTime();
  const db = parseUtc(b).getTime();
  return (db - da) / MS_PER_DAY / 365.25;
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + months,
      d.getUTCDate(),
      0,
      0,
      0,
    ),
  );
  return out;
}

function addYears(d: Date, years: number): Date {
  const wholeYears = Math.floor(years);
  const fracMonths = Math.round((years - wholeYears) * 12);
  return addMonths(
    new Date(
      Date.UTC(
        d.getUTCFullYear() + wholeYears,
        d.getUTCMonth(),
        d.getUTCDate(),
      ),
    ),
    fracMonths,
  );
}

/** First index whose date is >= target (binary search). */
function lowerBound(arr: PricePoint[], target: string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].date < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose date is > target. */
function upperBound(arr: PricePoint[], target: string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].date <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return NaN;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const frac = pos - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

function percentRank(sortedAsc: number[], value: number): number {
  if (sortedAsc.length === 0) return 50;
  let below = 0;
  for (const v of sortedAsc) {
    if (v < value) below++;
    else break;
  }
  return (below / sortedAsc.length) * 100;
}
