// Dividend analysis & reinvestment simulator.
//
// Yahoo's `adjclose` series already bakes in dividend reinvestment, so the
// existing DCA result on adjusted prices represents the "total return /
// reinvested" scenario. To answer "what if I had *not* reinvested?" and to
// surface the explicit cash flow of distributions we run a parallel
// simulation on the *unadjusted* price series, applying split-aware share
// counts and explicit per-share dividend events.
//
// All math is split-adjusted via Yahoo's adjclose ratio: the *number of
// shares* the investor would actually hold after each split is recovered
// from `(adjclose / close)` over time, eliminating the need to fetch the
// split history separately.

import { runDca, type DcaResult, type Frequency, type PricePoint } from "./backtest";
import type { CoveredCallCadence } from "./coveredCall";
import type { DividendEvent, RawPricePoint } from "./yahoo";

export interface DividendAnalysis {
  /** Total per-share distributions paid in the holding window (sum of cash). */
  totalCash: number;
  /** Number of distribution events in the window. */
  eventCount: number;
  /** Trailing-12-month sum of distributions, $ per share. */
  trailing12mCash: number;
  /** trailing12mCash divided by current price (decimal yield, 0.07 = 7%). */
  trailingYield: number | null;
  /** Sum of cash actually received by the DCA investor (shares × dividend). */
  totalReceived: number;
  /** Detected payout cadence — useful for UI labelling. */
  cadence: CoveredCallCadence;
  /** Per-event ledger {date, perShare, sharesHeld, cashReceived}. */
  ledger: DividendLedgerRow[];
}

export interface DividendLedgerRow {
  date: string;
  perShare: number;
  sharesHeld: number;
  cashReceived: number;
}

export interface ReinvestComparison {
  /** "Don't reinvest" — buy on schedule, dividends paid out as cash. */
  noReinvest: { finalValue: number; totalReturn: number; cashCollected: number };
  /** "Reinvest" — same schedule, but each dividend buys more shares immediately. */
  reinvest: { finalValue: number; totalReturn: number };
  /** Drag/lift from reinvestment in dollar terms. */
  reinvestLift: number;
}

/**
 * Compute dividend analytics for a DCA result.
 *
 * `dcaResult` is the existing total-return DCA (already on adjclose).
 * `rawPrices` carries the *unadjusted* close (and adjclose) on the same
 * trading days. `dividends` is the raw per-share cash event stream.
 */
export function analyseDividends(args: {
  dcaResult: DcaResult;
  rawPrices: ReadonlyArray<RawPricePoint>;
  dividends: ReadonlyArray<DividendEvent>;
  cadence: CoveredCallCadence;
}): DividendAnalysis {
  const { dcaResult, rawPrices, dividends, cadence } = args;

  // No price data or no dividends → degenerate empty result.
  if (rawPrices.length === 0 || dividends.length === 0) {
    return {
      totalCash: 0,
      eventCount: 0,
      trailing12mCash: 0,
      trailingYield: null,
      totalReceived: 0,
      cadence,
      ledger: [],
    };
  }

  const startDate = dcaResult.summary.startDate;
  const endDate = dcaResult.summary.endDate;

  // Filter dividends to the holding window.
  const inWindow = dividends.filter(
    (d) => d.date >= startDate && d.date <= endDate,
  );

  // Build ledger by walking the equity curve and stamping each dividend
  // event with the share count *as of that day*.
  const sharesByDate = new Map<string, number>();
  for (const e of dcaResult.equityCurve) sharesByDate.set(e.date, e.shares);

  // We need the share count on the dividend record date even if it falls on
  // a non-trading day (Yahoo dates can be record dates that miss the trading
  // calendar). Walk the equity curve once and use the *most recent* date
  // ≤ dividend date.
  const sortedCurveDates = dcaResult.equityCurve.map((e) => e.date);

  const ledger: DividendLedgerRow[] = [];
  let totalCash = 0;
  let totalReceived = 0;
  for (const ev of inWindow) {
    const sharesHeld = sharesAsOf(ev.date, sortedCurveDates, sharesByDate);
    const cashReceived = sharesHeld * ev.amount;
    totalCash += ev.amount;
    totalReceived += cashReceived;
    ledger.push({
      date: ev.date,
      perShare: ev.amount,
      sharesHeld,
      cashReceived,
    });
  }

  // Trailing 12-month cash & yield (per share / last price).
  const lastDiv = inWindow[inWindow.length - 1];
  let trailing12mCash = 0;
  if (lastDiv) {
    const cutoff = shiftIso(endDate, -365);
    for (const d of inWindow) if (d.date >= cutoff) trailing12mCash += d.amount;
  }
  const lastPrice = rawPrices[rawPrices.length - 1].rawClose;
  const trailingYield =
    trailing12mCash > 0 && lastPrice > 0 ? trailing12mCash / lastPrice : null;

  return {
    totalCash,
    eventCount: inWindow.length,
    trailing12mCash,
    trailingYield,
    totalReceived,
    cadence,
    ledger,
  };
}

/**
 * Run a side-by-side "reinvest vs don't reinvest" comparison.
 *
 * - "noReinvest" simulates DCA on the *raw* (price-only) series with cash
 *   distributions accumulating on the side.
 * - "reinvest" simulates DCA on the same raw series, but every dividend
 *   immediately buys additional shares on the next trading day at the raw
 *   close. This converges to the adjclose total-return scenario, with a
 *   small numerical residual due to the next-trading-day reinvestment lag.
 */
export function compareReinvestment(args: {
  ticker: string;
  rawPrices: ReadonlyArray<RawPricePoint>;
  dividends: ReadonlyArray<DividendEvent>;
  amount: number;
  frequency: Frequency;
  fractional: boolean;
}): ReinvestComparison {
  const { ticker, rawPrices, dividends, amount, frequency, fractional } = args;

  // Build a price series of the *unadjusted* close — this is what we want
  // to use because dividends are paid on top of price movement, not baked
  // into it.
  const rawSeries: PricePoint[] = rawPrices.map((p) => ({
    date: p.date,
    close: p.rawClose,
  }));

  // Baseline: DCA on raw close, dividends collected as cash on the side.
  const baseline = runDca(ticker, rawSeries, { amount, frequency, fractional });
  const baseLast = baseline.equityCurve[baseline.equityCurve.length - 1];
  const baseFinalValue = baseLast.value;

  // Sum cash received from dividends along the baseline schedule.
  const baseCurveByDate = new Map(baseline.equityCurve.map((e) => [e.date, e]));
  const baseCurveDates = baseline.equityCurve.map((e) => e.date);
  let baseCashCollected = 0;
  for (const ev of dividends) {
    if (ev.date < baseline.summary.startDate || ev.date > baseline.summary.endDate) {
      continue;
    }
    const shares = sharesAsOfFromMap(ev.date, baseCurveDates, baseCurveByDate);
    baseCashCollected += shares * ev.amount;
  }

  const baseInvested = baseLast.invested;
  const noReinvest = {
    finalValue: baseFinalValue + baseCashCollected,
    totalReturn:
      baseInvested > 0
        ? (baseFinalValue + baseCashCollected - baseInvested) / baseInvested
        : NaN,
    cashCollected: baseCashCollected,
  };

  // Reinvest path — walk the trading days, apply scheduled buys + dividend
  // reinvestment in chronological order.
  const reinvestResult = runDcaWithReinvestment({
    rawPrices: rawSeries,
    dividends,
    amount,
    frequency,
    fractional,
  });

  return {
    noReinvest,
    reinvest: reinvestResult,
    reinvestLift: reinvestResult.finalValue - noReinvest.finalValue,
  };
}

interface ReinvestRun {
  finalValue: number;
  totalReturn: number;
}

function runDcaWithReinvestment(args: {
  rawPrices: ReadonlyArray<PricePoint>;
  dividends: ReadonlyArray<DividendEvent>;
  amount: number;
  frequency: Frequency;
  fractional: boolean;
}): ReinvestRun {
  const { rawPrices, dividends, amount, frequency, fractional } = args;

  // We need to know which days are scheduled buy days. Reuse runDca on a
  // clone of the price series to obtain the buy index — we only care about
  // *which dates* are buy dates.
  const baseline = runDca("__bench__", [...rawPrices], {
    amount,
    frequency,
    fractional,
  });
  const buyDates = new Set(baseline.purchases.map((p) => p.date));

  // Pre-bucket dividends by date.
  const divByDate = new Map<string, number>();
  for (const ev of dividends) {
    divByDate.set(ev.date, (divByDate.get(ev.date) ?? 0) + ev.amount);
  }

  // Walk forward, executing buys + reinvestment.
  let shares = 0;
  let invested = 0;
  let scheduleCash = 0; // unused fractional residual from scheduled buys
  let pendingDividendCash = 0; // dividends waiting for next trading day reinvest

  for (const point of rawPrices) {
    const price = point.close;
    if (!Number.isFinite(price) || price <= 0) continue;

    // 1) Reinvest dividends pending from previous trading days.
    if (pendingDividendCash > 0) {
      if (fractional) {
        shares += pendingDividendCash / price;
      } else {
        const wholeShares = Math.floor(pendingDividendCash / price);
        shares += wholeShares;
        pendingDividendCash -= wholeShares * price;
      }
      if (fractional) pendingDividendCash = 0;
    }

    // 2) Scheduled buy on this date (if any).
    if (buyDates.has(point.date)) {
      const budget = amount + scheduleCash;
      if (fractional) {
        shares += budget / price;
        invested += budget;
        scheduleCash = 0;
      } else {
        const wholeShares = Math.floor(budget / price);
        shares += wholeShares;
        invested += wholeShares * price;
        scheduleCash = budget - wholeShares * price;
      }
    }

    // 3) Distribution declared on this date — credit cash; reinvest tomorrow.
    const div = divByDate.get(point.date);
    if (div) {
      pendingDividendCash += shares * div;
    }
  }

  const lastPrice = rawPrices[rawPrices.length - 1]?.close ?? 0;
  // Any leftover dividend cash that we never had a chance to reinvest counts
  // as cash on hand at the end — fold it into final value.
  const finalValue = shares * lastPrice + pendingDividendCash;
  const totalReturn = invested > 0 ? (finalValue - invested) / invested : NaN;
  return { finalValue, totalReturn };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function sharesAsOf(
  isoDate: string,
  sortedDates: ReadonlyArray<string>,
  sharesByDate: Map<string, number>,
): number {
  const exact = sharesByDate.get(isoDate);
  if (exact !== undefined) return exact;
  // Binary search for the latest date ≤ isoDate.
  let lo = 0;
  let hi = sortedDates.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDates[mid] <= isoDate) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return 0;
  return sharesByDate.get(sortedDates[best]) ?? 0;
}

function sharesAsOfFromMap<T extends { shares: number }>(
  isoDate: string,
  sortedDates: ReadonlyArray<string>,
  byDate: Map<string, T>,
): number {
  const exact = byDate.get(isoDate);
  if (exact !== undefined) return exact.shares;
  let lo = 0;
  let hi = sortedDates.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDates[mid] <= isoDate) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return 0;
  return byDate.get(sortedDates[best])?.shares ?? 0;
}

function shiftIso(iso: string, days: number): string {
  const t = Date.parse(iso + "T00:00:00Z");
  if (isNaN(t)) return iso;
  const d = new Date(t + days * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
