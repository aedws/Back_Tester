// Swing-trading signal markers.
//
// Five marker families that the chart layer can sprinkle on top of price as
// up/down arrows:
//
//   1. macd-up / macd-down       — MACD line crosses signal line
//   2. rsi50-up / rsi50-down     — RSI(14) crosses 50 (recovery from extremes)
//   3. golden-cross / death-cross — MA50 crosses MA200
//   4. breakout-20d              — Close > prior 20-period high
//   5. breakdown-20d             — Close < prior 20-period low
//
// All math here is pure and operates on plain number arrays so it can run on
// either the server or the client.

export type SignalKind =
  | "macd-up"
  | "macd-down"
  | "rsi50-up"
  | "rsi50-down"
  | "golden-cross"
  | "death-cross"
  | "breakout-20d"
  | "breakdown-20d";

export type SignalSide = "buy" | "sell";

export interface SignalMarker {
  /** Index into the supplied candles array. */
  i: number;
  kind: SignalKind;
  side: SignalSide;
  /** Price at which the marker fires (close at index `i`). */
  price: number;
  label: string;
}

export interface CandleLite {
  high: number;
  low: number;
  close: number;
}

export interface BuildSignalsArgs {
  candles: CandleLite[];
  ma50?: number[];
  ma200?: number[];
  rsi?: number[];
  /** Optional pre-computed MACD; if missing we'll compute it. */
  macdLine?: number[];
  signalLine?: number[];
  /** When set, only signals at indices >= this many bars from the start emit. */
  warmup?: number;
}

const SIGNAL_LABELS: Record<SignalKind, string> = {
  "macd-up": "MACD ↑",
  "macd-down": "MACD ↓",
  "rsi50-up": "RSI 50↑",
  "rsi50-down": "RSI 50↓",
  "golden-cross": "골든 크로스",
  "death-cross": "데드 크로스",
  "breakout-20d": "20일 신고가",
  "breakdown-20d": "20일 신저가",
};

const SIGNAL_SIDE: Record<SignalKind, SignalSide> = {
  "macd-up": "buy",
  "macd-down": "sell",
  "rsi50-up": "buy",
  "rsi50-down": "sell",
  "golden-cross": "buy",
  "death-cross": "sell",
  "breakout-20d": "buy",
  "breakdown-20d": "sell",
};

export function buildSignals(args: BuildSignalsArgs): SignalMarker[] {
  const { candles } = args;
  const n = candles.length;
  if (n < 30) return [];

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const macdLine = args.macdLine ?? macdLineEma(closes);
  const signalLine = args.signalLine ?? emaPad(macdLine, 9);

  const out: SignalMarker[] = [];

  const warmup = args.warmup ?? 26;

  for (let i = warmup + 1; i < n; i++) {
    const price = closes[i];
    if (!Number.isFinite(price)) continue;

    // 1. MACD cross
    if (
      Number.isFinite(macdLine[i]) &&
      Number.isFinite(signalLine[i]) &&
      Number.isFinite(macdLine[i - 1]) &&
      Number.isFinite(signalLine[i - 1])
    ) {
      const prevDiff = macdLine[i - 1] - signalLine[i - 1];
      const curDiff = macdLine[i] - signalLine[i];
      if (prevDiff <= 0 && curDiff > 0) {
        push(out, "macd-up", i, price);
      } else if (prevDiff >= 0 && curDiff < 0) {
        push(out, "macd-down", i, price);
      }
    }

    // 2. RSI 50 cross
    if (args.rsi && Number.isFinite(args.rsi[i]) && Number.isFinite(args.rsi[i - 1])) {
      if (args.rsi[i - 1] <= 50 && args.rsi[i] > 50) {
        push(out, "rsi50-up", i, price);
      } else if (args.rsi[i - 1] >= 50 && args.rsi[i] < 50) {
        push(out, "rsi50-down", i, price);
      }
    }

    // 3. Golden / Death cross (50 / 200 SMA)
    if (
      args.ma50 && args.ma200 &&
      Number.isFinite(args.ma50[i]) && Number.isFinite(args.ma200[i]) &&
      Number.isFinite(args.ma50[i - 1]) && Number.isFinite(args.ma200[i - 1])
    ) {
      const prev = args.ma50[i - 1] - args.ma200[i - 1];
      const cur = args.ma50[i] - args.ma200[i];
      if (prev <= 0 && cur > 0) {
        push(out, "golden-cross", i, price);
      } else if (prev >= 0 && cur < 0) {
        push(out, "death-cross", i, price);
      }
    }

    // 4 & 5. 20-day breakout / breakdown (Donchian channel break)
    if (i >= 20) {
      let priorHigh = -Infinity;
      let priorLow = Infinity;
      for (let j = i - 20; j < i; j++) {
        if (highs[j] > priorHigh) priorHigh = highs[j];
        if (lows[j] < priorLow) priorLow = lows[j];
      }
      if (price > priorHigh) push(out, "breakout-20d", i, price);
      if (price < priorLow) push(out, "breakdown-20d", i, price);
    }
  }

  return dedupeNeighbors(out);
}

function push(arr: SignalMarker[], kind: SignalKind, i: number, price: number) {
  arr.push({
    i,
    kind,
    side: SIGNAL_SIDE[kind],
    price,
    label: SIGNAL_LABELS[kind],
  });
}

/**
 * Suppress repeat firings of the *same* signal kind within a 3-bar cooldown,
 * which keeps choppy regions from saturating the chart.
 */
function dedupeNeighbors(markers: SignalMarker[]): SignalMarker[] {
  const lastIdxByKind = new Map<SignalKind, number>();
  const out: SignalMarker[] = [];
  for (const m of markers) {
    const last = lastIdxByKind.get(m.kind);
    if (last !== undefined && m.i - last < 3) continue;
    lastIdxByKind.set(m.kind, m.i);
    out.push(m);
  }
  return out;
}

/* ───────────────────── EMA helpers ───────────────────── */

function emaPad(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  if (values.length < period) return out;

  // Skip leading NaNs (e.g. when computing on a series that itself has NaN
  // tails, like macdLine).
  let firstIdx = 0;
  while (firstIdx < values.length && !Number.isFinite(values[firstIdx])) firstIdx++;
  if (firstIdx + period > values.length) return out;

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = firstIdx; i < firstIdx + period; i++) sum += values[i];
  let ema = sum / period;
  out[firstIdx + period - 1] = ema;
  for (let i = firstIdx + period; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      out[i] = ema;
      continue;
    }
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function macdLineEma(closes: number[]): number[] {
  const ema12 = emaPad(closes, 12);
  const ema26 = emaPad(closes, 26);
  const out = new Array(closes.length).fill(NaN);
  for (let i = 0; i < closes.length; i++) {
    if (Number.isFinite(ema12[i]) && Number.isFinite(ema26[i])) {
      out[i] = ema12[i] - ema26[i];
    }
  }
  return out;
}
