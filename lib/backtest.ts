// DCA backtest engine ported from the original Python implementation.
// Pure functions, no I/O — safe to call from server routes or scripts.

export type Frequency = "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
export type PeriodMode = "years" | "inception" | "custom";

export interface PricePoint {
  /** ISO date string YYYY-MM-DD (UTC) */
  date: string;
  /** Adjusted close */
  close: number;
}

export interface Purchase {
  date: string;
  price: number;
  shares: number;
  invested: number;
}

export interface EquityPoint {
  date: string;
  price: number;
  shares: number;
  invested: number;
  value: number;
}

export interface DcaSummary {
  ticker: string;
  startDate: string;
  endDate: string;
  years: number;
  nPurchases: number;
  totalInvested: number;
  finalValue: number;
  profit: number;
  totalReturn: number;
  irrAnnualized: number | null;
  totalShares: number;
  avgCost: number;
  lastPrice: number;
  maxDrawdown: number;
  buyHoldFinalValue: number;
  buyHoldReturn: number;
  buyHoldCagr: number;
}

export interface DcaResult {
  ticker: string;
  summary: DcaSummary;
  purchases: Purchase[];
  equityCurve: EquityPoint[];
}

export interface RunDcaOptions {
  amount: number;
  frequency: Frequency;
  fractional?: boolean;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
const MS_PER_DAY = 86_400_000;

function parseUtc(date: string): Date {
  // Accept "YYYY-MM-DD" or full ISO; force UTC interpretation.
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

function diffYears(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MS_PER_DAY / 365.25;
}

/** ISO week starting Monday — returns YYYY-Www. */
function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((t.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function bucketKey(d: Date, frequency: Frequency): string {
  switch (frequency) {
    case "daily":
      return toIso(d);
    case "weekly":
      return isoWeekKey(d);
    case "monthly":
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    case "yearly":
      return String(d.getUTCFullYear());
    case "biweekly":
      // handled separately to pair consecutive weeks
      return isoWeekKey(d);
  }
}

/** Pick the earliest available trading day per bucket. */
function buildBuyIndices(
  dates: Date[],
  frequency: Frequency,
): number[] {
  if (dates.length === 0) return [];
  if (frequency === "daily") return dates.map((_, i) => i);

  const out: number[] = [];

  if (frequency === "biweekly") {
    // Build ordered list of unique weeks then pair them (0,1) (2,3) ...
    const weekOf = dates.map((d) => isoWeekKey(d));
    const uniqueWeeks: string[] = [];
    const seen = new Set<string>();
    for (const w of weekOf) {
      if (!seen.has(w)) {
        seen.add(w);
        uniqueWeeks.push(w);
      }
    }
    const biweekIdOfWeek = new Map<string, number>();
    uniqueWeeks.forEach((w, i) => biweekIdOfWeek.set(w, Math.floor(i / 2)));

    let lastBucket = -1;
    for (let i = 0; i < dates.length; i++) {
      const id = biweekIdOfWeek.get(weekOf[i])!;
      if (id !== lastBucket) {
        out.push(i);
        lastBucket = id;
      }
    }
    return out;
  }

  let lastKey: string | null = null;
  for (let i = 0; i < dates.length; i++) {
    const key = bucketKey(dates[i], frequency);
    if (key !== lastKey) {
      out.push(i);
      lastKey = key;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------
function maxDrawdown(values: number[]): number {
  if (values.length === 0) return 0;
  let peak = values[0];
  let maxDd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (v - peak) / peak;
      if (dd < maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

interface CashFlow {
  date: Date;
  amount: number;
}

/** XIRR via bisection on irregular cashflows. Returns null if no sign change. */
function xirr(cashflows: CashFlow[]): number | null {
  if (cashflows.length < 2) return null;
  const hasPos = cashflows.some((c) => c.amount > 0);
  const hasNeg = cashflows.some((c) => c.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const t0 = cashflows[0].date.getTime();
  const years = cashflows.map((c) => (c.date.getTime() - t0) / MS_PER_DAY / 365.25);

  const npv = (rate: number): number => {
    let sum = 0;
    for (let i = 0; i < cashflows.length; i++) {
      sum += cashflows[i].amount / Math.pow(1 + rate, years[i]);
    }
    return sum;
  };

  let low = -0.9999;
  let high = 10;
  let fLow = npv(low);
  let fHigh = npv(high);
  if (!isFinite(fLow) || !isFinite(fHigh) || fLow * fHigh > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (low + high);
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7) return mid;
    if (fLow * fMid < 0) {
      high = mid;
      fHigh = fMid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return 0.5 * (low + high);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function runDca(
  ticker: string,
  prices: PricePoint[],
  opts: RunDcaOptions,
): DcaResult {
  const { amount, frequency, fractional = true } = opts;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be positive");
  }
  if (!prices || prices.length === 0) {
    throw new Error("prices is empty");
  }

  // Sort + dedupe by date.
  const seen = new Set<string>();
  const sorted = [...prices]
    .filter((p) => Number.isFinite(p.close) && p.close > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .filter((p) => {
      if (seen.has(p.date)) return false;
      seen.add(p.date);
      return true;
    });

  if (sorted.length === 0) {
    throw new Error("No valid price points after filtering");
  }

  const dates = sorted.map((p) => parseUtc(p.date));
  const closes = sorted.map((p) => p.close);
  const isoDates = sorted.map((p) => p.date);

  const buyIdx = buildBuyIndices(dates, frequency);
  if (buyIdx.length === 0) throw new Error("No buy dates were generated");

  const purchases: Purchase[] = [];
  let cashCarry = 0;
  for (const i of buyIdx) {
    const price = closes[i];
    const budget = amount + cashCarry;
    let shares: number;
    let spent: number;
    if (fractional) {
      shares = budget / price;
      spent = budget;
      cashCarry = 0;
    } else {
      shares = Math.floor(budget / price);
      spent = shares * price;
      cashCarry = budget - spent;
    }
    purchases.push({
      date: isoDates[i],
      price,
      shares,
      invested: spent,
    });
  }

  // Forward-fill cumulative shares and invested across the whole price index.
  const equityCurve: EquityPoint[] = new Array(sorted.length);
  let cumShares = 0;
  let cumInvested = 0;
  let buyPtr = 0;
  for (let i = 0; i < sorted.length; i++) {
    while (buyPtr < buyIdx.length && buyIdx[buyPtr] === i) {
      cumShares += purchases[buyPtr].shares;
      cumInvested += purchases[buyPtr].invested;
      buyPtr++;
    }
    equityCurve[i] = {
      date: isoDates[i],
      price: closes[i],
      shares: cumShares,
      invested: cumInvested,
      value: cumShares * closes[i],
    };
  }

  const last = equityCurve[equityCurve.length - 1];
  const totalInvested = last.invested;
  const finalValue = last.value;
  const totalShares = last.shares;
  const lastPrice = last.price;
  const profit = finalValue - totalInvested;
  const totalReturn = totalInvested > 0 ? profit / totalInvested : NaN;
  const avgCost = totalShares > 0 ? totalInvested / totalShares : NaN;

  const years = diffYears(dates[0], dates[dates.length - 1]);

  const cashflows: CashFlow[] = purchases.map((p) => ({
    date: parseUtc(p.date),
    amount: -p.invested,
  }));
  cashflows.push({ date: dates[dates.length - 1], amount: finalValue });
  const irrAnnualized = xirr(cashflows);

  const firstPrice = closes[0];
  const bhShares = totalInvested > 0 ? totalInvested / firstPrice : 0;
  const buyHoldFinalValue = bhShares * lastPrice;
  const buyHoldReturn =
    totalInvested > 0 ? buyHoldFinalValue / totalInvested - 1 : NaN;
  const buyHoldCagr =
    totalInvested > 0 && years > 0
      ? Math.pow(buyHoldFinalValue / totalInvested, 1 / years) - 1
      : NaN;

  const summary: DcaSummary = {
    ticker,
    startDate: isoDates[0],
    endDate: isoDates[isoDates.length - 1],
    years,
    nPurchases: purchases.length,
    totalInvested,
    finalValue,
    profit,
    totalReturn,
    irrAnnualized,
    totalShares,
    avgCost,
    lastPrice,
    maxDrawdown: maxDrawdown(equityCurve.map((e) => e.value)),
    buyHoldFinalValue,
    buyHoldReturn,
    buyHoldCagr,
  };

  return { ticker, summary, purchases, equityCurve };
}
