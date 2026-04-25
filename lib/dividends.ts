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
import type { DividendEvent, RawPricePoint, SplitEvent } from "./yahoo";

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

export interface ReinvestSeriesPoint {
  date: string;
  /** Mark-to-market portfolio value (shares × price) + uninvested cash. */
  value: number;
  /** Cumulative invested capital (out-of-pocket only). */
  invested: number;
}

export interface ReinvestComparison {
  /** "Don't reinvest" — buy on schedule, dividends paid out as cash. */
  noReinvest: {
    finalValue: number;
    totalReturn: number;
    cashCollected: number;
    series: ReinvestSeriesPoint[];
  };
  /** "Reinvest" — same schedule, but each dividend buys more shares immediately. */
  reinvest: { finalValue: number; totalReturn: number; series: ReinvestSeriesPoint[] };
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
export interface CompareReinvestmentArgs {
  ticker: string;
  rawPrices: ReadonlyArray<RawPricePoint>;
  dividends: ReadonlyArray<DividendEvent>;
  /** Split events from yahoo chart — applied to share count on each ratio day. */
  splits?: ReadonlyArray<SplitEvent>;
  /** unitMode: "amount" → use `amount`; "shares" → use `shares` per period. */
  unitMode?: "amount" | "shares";
  amount?: number;
  shares?: number;
  frequency: Frequency;
  /** amount mode: allow fractional. shares mode: per-period integer by default. */
  fractional?: boolean;
  fractionalShares?: boolean;
}

export function compareReinvestment(args: CompareReinvestmentArgs): ReinvestComparison {
  const {
    ticker,
    rawPrices,
    dividends,
    splits = [],
    unitMode = "amount",
    amount,
    shares: sharesPerPeriod,
    frequency,
    fractional = true,
    fractionalShares = false,
  } = args;

  // Build a price series of the *unadjusted* close — this is what we want
  // to use because dividends are paid on top of price movement, not baked
  // into it.
  const rawSeries: PricePoint[] = rawPrices.map((p) => ({
    date: p.date,
    close: p.rawClose,
  }));

  // We need the buy schedule. Reuse runDca on a clone of the price series
  // to obtain the buy index — we only care about *which dates* are buy days.
  const scheduleRun = runDca("__schedule__", [...rawSeries], {
    unitMode,
    amount,
    shares: sharesPerPeriod,
    frequency,
    fractional,
    fractionalShares,
  });
  const buyDates = new Set(scheduleRun.purchases.map((p) => p.date));

  // Run both scenarios in parallel through one chronological walk to keep
  // them perfectly aligned, then split into separate series.
  const out = runReinvestSimulations({
    rawPrices: rawSeries,
    buyDates,
    dividends,
    splits,
    unitMode,
    amount: amount ?? 0,
    sharesPerPeriod: sharesPerPeriod ?? 0,
    fractional,
    fractionalShares,
  });

  // Tag the ticker (used for debug; not consumed by UI).
  void ticker;

  return out;
}

interface RunReinvestArgs {
  rawPrices: ReadonlyArray<PricePoint>;
  buyDates: Set<string>;
  dividends: ReadonlyArray<DividendEvent>;
  splits: ReadonlyArray<SplitEvent>;
  unitMode: "amount" | "shares";
  amount: number;
  sharesPerPeriod: number;
  fractional: boolean;
  fractionalShares: boolean;
}

/**
 * Walk trading days once, advancing both "no reinvest" and "reinvest"
 * scenarios in lockstep. Splits are applied at the start of the trading
 * day they're recorded for (Yahoo's convention) by multiplying the share
 * count by the ratio.
 */
function runReinvestSimulations(args: RunReinvestArgs): ReinvestComparison {
  const {
    rawPrices,
    buyDates,
    dividends,
    splits,
    unitMode,
    amount,
    sharesPerPeriod,
    fractional,
    fractionalShares,
  } = args;

  const divByDate = new Map<string, number>();
  for (const ev of dividends) {
    divByDate.set(ev.date, (divByDate.get(ev.date) ?? 0) + ev.amount);
  }
  const splitByDate = new Map<string, number>();
  for (const sp of splits) {
    splitByDate.set(sp.date, (splitByDate.get(sp.date) ?? 1) * sp.ratio);
  }

  // ---- "no reinvest" state ----------------------------------------------
  let nrShares = 0;
  let nrInvested = 0;
  let nrScheduleCash = 0; // scheduled-buy fractional residual
  let nrCashCollected = 0;
  const nrSeries: ReinvestSeriesPoint[] = [];

  // ---- "reinvest" state -------------------------------------------------
  let rShares = 0;
  let rInvested = 0;
  let rScheduleCash = 0;
  let rPendingDiv = 0; // dividend cash waiting for next trading day
  const rSeries: ReinvestSeriesPoint[] = [];

  for (const point of rawPrices) {
    const price = point.close;
    if (!Number.isFinite(price) || price <= 0) continue;

    // (0) Apply split at start of this trading day, if any. Both scenarios
    //     hold the same underlying ticker so both share counts scale.
    const sp = splitByDate.get(point.date);
    if (sp && sp > 0 && sp !== 1) {
      nrShares *= sp;
      rShares *= sp;
    }

    // (1) Reinvest path: drain pending dividend cash into shares.
    if (rPendingDiv > 0) {
      if (fractional) {
        rShares += rPendingDiv / price;
        rPendingDiv = 0;
      } else {
        const whole = Math.floor(rPendingDiv / price);
        rShares += whole;
        rPendingDiv -= whole * price;
      }
    }

    // (2) Scheduled buy on this date (if any).
    if (buyDates.has(point.date)) {
      if (unitMode === "shares") {
        const target = fractionalShares
          ? sharesPerPeriod
          : Math.floor(sharesPerPeriod);
        if (target > 0) {
          const cost = target * price;
          nrShares += target;
          nrInvested += cost;
          rShares += target;
          rInvested += cost;
        }
      } else {
        // amount mode — both paths get the same out-of-pocket budget.
        const nrBudget = amount + nrScheduleCash;
        const rBudget = amount + rScheduleCash;
        if (fractional) {
          nrShares += nrBudget / price;
          nrInvested += nrBudget;
          nrScheduleCash = 0;
          rShares += rBudget / price;
          rInvested += rBudget;
          rScheduleCash = 0;
        } else {
          const nrWhole = Math.floor(nrBudget / price);
          nrShares += nrWhole;
          nrInvested += nrWhole * price;
          nrScheduleCash = nrBudget - nrWhole * price;
          const rWhole = Math.floor(rBudget / price);
          rShares += rWhole;
          rInvested += rWhole * price;
          rScheduleCash = rBudget - rWhole * price;
        }
      }
    }

    // (3) Distribution declared today.
    const dPerShare = divByDate.get(point.date);
    if (dPerShare) {
      nrCashCollected += nrShares * dPerShare;
      rPendingDiv += rShares * dPerShare;
    }

    nrSeries.push({
      date: point.date,
      value: nrShares * price + nrCashCollected,
      invested: nrInvested,
    });
    rSeries.push({
      date: point.date,
      value: rShares * price + rPendingDiv,
      invested: rInvested,
    });
  }

  const lastPrice = rawPrices[rawPrices.length - 1]?.close ?? 0;
  const noReinvestFinal = nrShares * lastPrice + nrCashCollected;
  const reinvestFinal = rShares * lastPrice + rPendingDiv;

  return {
    noReinvest: {
      finalValue: noReinvestFinal,
      totalReturn:
        nrInvested > 0 ? (noReinvestFinal - nrInvested) / nrInvested : NaN,
      cashCollected: nrCashCollected,
      series: nrSeries,
    },
    reinvest: {
      finalValue: reinvestFinal,
      totalReturn:
        rInvested > 0 ? (reinvestFinal - rInvested) / rInvested : NaN,
      series: rSeries,
    },
    reinvestLift: reinvestFinal - noReinvestFinal,
  };
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

function shiftIso(iso: string, days: number): string {
  const t = Date.parse(iso + "T00:00:00Z");
  if (isNaN(t)) return iso;
  const d = new Date(t + days * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
