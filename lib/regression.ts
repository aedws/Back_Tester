// Log-linear regression channel.
//
// On a long timeframe many growth assets approximate exponential growth, so
// fitting an OLS line through ln(price) vs time yields a "trend line" with
// well-behaved residuals. The standard deviation σ of the residuals (in log
// space) gives ±1σ / ±2σ envelopes that act as soft support / resistance:
//
//   • price > +2σ  → far above trend, often reverts
//   • price < −2σ  → far below trend, often bounces
//
// This file is pure math; the chart route calls it and ships the resulting
// channel to the client as price-space arrays.

export interface LogChannelPoint {
  /** epoch ms */
  t: number;
  /** Fitted trend value at t (price-space, not log). */
  fit: number;
  plus1: number;
  plus2: number;
  minus1: number;
  minus2: number;
}

export interface LogChannelResult {
  points: LogChannelPoint[];
  /** Slope in log-space per millisecond. Positive = uptrend. */
  slopePerMs: number;
  /** Annualized growth rate (e^(slopePerMs * ms_per_year) − 1). */
  cagr: number;
  /** Standard deviation of residuals in log-space. */
  sigma: number;
  /** Coefficient of determination of the log-fit. */
  r2: number;
  /** Where the *latest* close sits in σ units. Positive = above trend. */
  zScore: number;
}

const MS_PER_YEAR = 365.25 * 86_400_000;

export interface RegressionInput {
  t: number;
  close: number;
}

/**
 * Fit ln(close) = a + b·t and return the channel.
 *
 * @param points  time-ordered (t, close) pairs; close > 0 required.
 * @param sigmas  optional override of σ multipliers (defaults to ±1 and ±2)
 */
export function logLinearChannel(
  points: RegressionInput[],
): LogChannelResult | null {
  // Need at least a few dozen points for the σ estimate to mean anything.
  const cleaned: { t: number; y: number }[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.t)) continue;
    if (typeof p.close !== "number" || !Number.isFinite(p.close) || p.close <= 0) continue;
    cleaned.push({ t: p.t, y: Math.log(p.close) });
  }
  if (cleaned.length < 30) return null;

  // Centre time for numerical stability — slope/intercept are invariant once
  // we re-shift back at the end.
  const tMean = cleaned.reduce((s, p) => s + p.t, 0) / cleaned.length;
  const yMean = cleaned.reduce((s, p) => s + p.y, 0) / cleaned.length;

  let num = 0;
  let den = 0;
  for (const p of cleaned) {
    const dt = p.t - tMean;
    num += dt * (p.y - yMean);
    den += dt * dt;
  }
  if (den === 0) return null;

  const slope = num / den;          // log-space slope per ms
  const intercept = yMean - slope * tMean;

  // Residuals in log-space.
  let ssRes = 0;
  let ssTot = 0;
  for (const p of cleaned) {
    const yHat = intercept + slope * p.t;
    ssRes += (p.y - yHat) ** 2;
    ssTot += (p.y - yMean) ** 2;
  }
  const variance = ssRes / Math.max(1, cleaned.length - 2);
  const sigma = Math.sqrt(variance);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  const channel: LogChannelPoint[] = points.map((p) => {
    const fitLog = intercept + slope * p.t;
    const fit = Math.exp(fitLog);
    return {
      t: p.t,
      fit,
      plus1: Math.exp(fitLog + sigma),
      plus2: Math.exp(fitLog + 2 * sigma),
      minus1: Math.exp(fitLog - sigma),
      minus2: Math.exp(fitLog - 2 * sigma),
    };
  });

  // Where does the most-recent close sit, in σ units?
  const last = cleaned[cleaned.length - 1];
  const lastFit = intercept + slope * last.t;
  const zScore = sigma > 0 ? (last.y - lastFit) / sigma : 0;

  return {
    points: channel,
    slopePerMs: slope,
    cagr: Math.exp(slope * MS_PER_YEAR) - 1,
    sigma,
    r2,
    zScore,
  };
}
