// Pure technical-indicator helpers. Operate on plain number arrays so they
// can be reused regardless of candle layout.
//
// All functions return arrays the same length as the input; missing values
// at the head of the series (where there isn't enough history) are filled
// with `NaN` so chart libraries can naturally skip them.

export type Series = ReadonlyArray<number>;

const NAN = Number.NaN;

// ---------------------------------------------------------------------------
// Moving averages
// ---------------------------------------------------------------------------
export function sma(values: Series, period: number): number[] {
  const out: number[] = new Array(values.length).fill(NAN);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: Series, period: number): number[] {
  const out: number[] = new Array(values.length).fill(NAN);
  if (period <= 0 || values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev = NAN;
  let sumForSeed = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (i < period - 1) {
      sumForSeed += v;
      continue;
    }
    if (i === period - 1) {
      sumForSeed += v;
      prev = sumForSeed / period;
      out[i] = prev;
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bollinger Bands (typically SMA(20) ± 2σ)
// ---------------------------------------------------------------------------
export interface BollingerBands {
  middle: number[];
  upper: number[];
  lower: number[];
}

export function bollinger(
  values: Series,
  period = 20,
  stddevs = 2,
): BollingerBands {
  const middle = sma(values, period);
  const upper: number[] = new Array(values.length).fill(NAN);
  const lower: number[] = new Array(values.length).fill(NAN);
  for (let i = period - 1; i < values.length; i++) {
    let sumSq = 0;
    const mean = middle[i];
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean;
      sumSq += d * d;
    }
    const stdev = Math.sqrt(sumSq / period);
    upper[i] = mean + stddevs * stdev;
    lower[i] = mean - stddevs * stdev;
  }
  return { middle, upper, lower };
}

// ---------------------------------------------------------------------------
// RSI (Wilder's smoothing)
// ---------------------------------------------------------------------------
export function rsi(values: Series, period = 14): number[] {
  const out: number[] = new Array(values.length).fill(NAN);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += -diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stochastic %K / %D (typically 14, 3, 3)
// ---------------------------------------------------------------------------
export interface Stochastic {
  k: number[];
  d: number[];
}

export function stochastic(
  high: Series,
  low: Series,
  close: Series,
  kPeriod = 14,
  dPeriod = 3,
  smoothK = 3,
): Stochastic {
  const n = close.length;
  const rawK: number[] = new Array(n).fill(NAN);
  for (let i = kPeriod - 1; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (high[j] > hh) hh = high[j];
      if (low[j] < ll) ll = low[j];
    }
    const denom = hh - ll;
    rawK[i] = denom > 0 ? ((close[i] - ll) / denom) * 100 : 50;
  }
  const k = sma(rawK.map((v) => (Number.isFinite(v) ? v : 0)), smoothK).map(
    (v, i) => (Number.isFinite(rawK[i - smoothK + 1] ?? NAN) ? v : NAN),
  );
  // Recompute %K cleanly to avoid leaking smoothed values into NaN positions.
  const kClean: number[] = new Array(n).fill(NAN);
  for (let i = 0; i < n; i++) {
    if (i >= kPeriod - 1 + smoothK - 1) kClean[i] = k[i];
  }
  const d = sma(kClean.map((v) => (Number.isFinite(v) ? v : 0)), dPeriod).map(
    (v, i) =>
      Number.isFinite(kClean[i - dPeriod + 1] ?? NAN) && i >= kPeriod - 1 + smoothK - 1 + dPeriod - 1
        ? v
        : NAN,
  );
  return { k: kClean, d };
}

// ---------------------------------------------------------------------------
// ATR (Wilder's true range smoothing)
// ---------------------------------------------------------------------------
export function atr(
  high: Series,
  low: Series,
  close: Series,
  period = 14,
): number[] {
  const n = close.length;
  const out: number[] = new Array(n).fill(NAN);
  if (n < period + 1) return out;

  const tr: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr[i] = high[i] - low[i];
    } else {
      const a = high[i] - low[i];
      const b = Math.abs(high[i] - close[i - 1]);
      const c = Math.abs(low[i] - close[i - 1]);
      tr[i] = Math.max(a, b, c);
    }
  }
  let prev = 0;
  for (let i = 1; i <= period; i++) prev += tr[i];
  prev /= period;
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

// ---------------------------------------------------------------------------
// MACD (12, 26, 9)
// ---------------------------------------------------------------------------
export interface Macd {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(
  values: Series,
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): Macd {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line = fastEma.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(slowEma[i]) ? v - slowEma[i] : NAN,
  );
  const signal = ema(
    line.map((v) => (Number.isFinite(v) ? v : 0)),
    signalPeriod,
  ).map((v, i) => (Number.isFinite(line[i]) ? v : NAN));
  const histogram = line.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NAN,
  );
  return { macd: line, signal, histogram };
}

// ---------------------------------------------------------------------------
// Helpers used by chart UI
// ---------------------------------------------------------------------------
/** Rolling N-period highest high & lowest low (used for breakout/support). */
export function rollingExtremes(
  high: Series,
  low: Series,
  period: number,
): { highestHigh: number[]; lowestLow: number[] } {
  const n = high.length;
  const hh: number[] = new Array(n).fill(NAN);
  const ll: number[] = new Array(n).fill(NAN);
  for (let i = period - 1; i < n; i++) {
    let mh = -Infinity;
    let ml = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (high[j] > mh) mh = high[j];
      if (low[j] < ml) ml = low[j];
    }
    hh[i] = mh;
    ll[i] = ml;
  }
  return { highestHigh: hh, lowestLow: ll };
}
