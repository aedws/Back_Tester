// Synthetic "Fear & Greed" index built from data Yahoo gives us for free.
//
// We don't have access to NYSE breadth / advance-decline / put-call ratios,
// so we approximate the spirit of CNN's index with five components that we
// *can* compute cleanly:
//
//   1. Market volatility           — VIX vs its 50-day mean       (30%)
//   2. S&P 500 momentum             — close vs 125-day SMA         (20%)
//   3. Stock strength (52w pos.)    — close position in 52w range  (20%)
//   4. Junk bond demand             — HYG 20d return − LQD 20d     (15%)
//   5. Safe haven demand            — SPY 20d return − TLT 20d     (15%)
//
// Each component is mapped to 0 (extreme fear) ↔ 100 (extreme greed) via a
// linear clamp; the final score is the weighted average. All weights sum to 1.

export interface PricePointMin {
  /** epoch ms or ISO string — we only need the close. */
  close: number;
}

export type SentimentLabel =
  | "extreme-fear"
  | "fear"
  | "neutral"
  | "greed"
  | "extreme-greed";

export interface SentimentComponent {
  key: string;
  label: string;
  weight: number;
  /** 0 = extreme fear, 100 = extreme greed. null = no data */
  score: number | null;
  /** Raw underlying value used for the score, for tooltips/labels. */
  raw: string;
  /** What the user should read from this component when it's high (greed) or low (fear). */
  description: string;
}

export interface SentimentResult {
  /** 0–100. */
  score: number;
  label: SentimentLabel;
  components: SentimentComponent[];
  /** ISO timestamp the calculation was performed. */
  asOf: string;
}

/* ───────────────────── helpers ───────────────────── */

function linearClamp(
  value: number,
  fearAt: number,
  greedAt: number,
): number {
  // fearAt → 0, greedAt → 100. Either direction is supported.
  if (!Number.isFinite(value)) return 50;
  const t = (value - fearAt) / (greedAt - fearAt);
  return Math.max(0, Math.min(100, t * 100));
}

function mean(arr: number[]): number {
  if (arr.length === 0) return NaN;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function lastN(closes: number[], n: number): number[] {
  if (closes.length <= n) return closes.slice();
  return closes.slice(closes.length - n);
}

function periodReturn(closes: number[], days: number): number {
  if (closes.length < days + 1) return NaN;
  const a = closes[closes.length - 1 - days];
  const b = closes[closes.length - 1];
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) return NaN;
  return b / a - 1;
}

function lastValue(closes: number[]): number {
  return closes.length > 0 ? closes[closes.length - 1] : NaN;
}

/* ───────────────────── components ───────────────────── */

/**
 * Volatility: a low VIX vs its recent average → greed. We invert the natural
 * "VIX up = fear" relationship by mapping the *ratio* (VIX / VIX_50d_MA).
 *
 * ratio ≤ 0.70  → score 100 (vol crushed, complacency / greed)
 * ratio ≥ 1.50  → score 0   (panic spike vs trend)
 */
export function volComponent(vixCloses: number[]): SentimentComponent {
  const vix = lastValue(vixCloses);
  const vixMa50 = mean(lastN(vixCloses, 50));
  const score =
    Number.isFinite(vix) && Number.isFinite(vixMa50) && vixMa50 > 0
      ? linearClamp(vix / vixMa50, 1.5, 0.7)
      : null;
  return {
    key: "vol",
    label: "변동성 (VIX)",
    weight: 0.3,
    score,
    raw:
      Number.isFinite(vix) && Number.isFinite(vixMa50)
        ? `VIX ${vix.toFixed(1)} · 50d 평균 ${vixMa50.toFixed(1)}`
        : "—",
    description:
      "VIX가 50일 평균보다 낮으면 변동성 위축으로 위험선호(탐욕), 평균을 큰 폭으로 웃돌면 패닉(공포)으로 해석.",
  };
}

/**
 * S&P 500 momentum vs 125-day SMA. Close above MA → greed.
 *
 * (close − sma)/sma:
 *   +5% → 100, −5% → 0
 */
export function momentumComponent(spxCloses: number[]): SentimentComponent {
  const cur = lastValue(spxCloses);
  const sma125 = mean(lastN(spxCloses, 125));
  const score =
    Number.isFinite(cur) && Number.isFinite(sma125) && sma125 > 0
      ? linearClamp((cur - sma125) / sma125, -0.05, 0.05)
      : null;
  return {
    key: "momentum",
    label: "모멘텀 (S&P500 vs 125d MA)",
    weight: 0.2,
    score,
    raw:
      Number.isFinite(cur) && Number.isFinite(sma125)
        ? `종가 ${cur.toFixed(0)} · 125d MA ${sma125.toFixed(0)} (${(((cur - sma125) / sma125) * 100).toFixed(2)}%)`
        : "—",
    description:
      "S&P 500이 장기 추세선(125일선)을 위에 두고 있을수록 강세 모멘텀(탐욕). 아래로 이탈하면 약세(공포).",
  };
}

/**
 * 52-week position: where in the 52w high/low range is the index trading?
 * 0% (at the low) → 0, 100% (at the high) → 100. Linear.
 */
export function strengthComponent(spxCloses: number[]): SentimentComponent {
  const window = lastN(spxCloses, 252);
  const cur = lastValue(window);
  let high = -Infinity;
  let low = Infinity;
  for (const v of window) {
    if (!Number.isFinite(v)) continue;
    if (v > high) high = v;
    if (v < low) low = v;
  }
  const range = high - low;
  const score =
    Number.isFinite(cur) && range > 0 ? linearClamp(cur, low, high) : null;
  const pct = range > 0 ? ((cur - low) / range) * 100 : NaN;
  return {
    key: "strength",
    label: "52주 위치 (S&P500)",
    weight: 0.2,
    score,
    raw:
      Number.isFinite(cur) && range > 0
        ? `52w 저 ${low.toFixed(0)} → 고 ${high.toFixed(0)} · 위치 ${pct.toFixed(0)}%`
        : "—",
    description:
      "52주 신고가 부근일수록 강세(탐욕), 신저가 부근일수록 약세(공포). CNN 지수의 'Stock Strength' 대용.",
  };
}

/**
 * Junk bond demand: 20d return spread between HYG (high yield) and LQD
 * (investment grade). Junk outperforming → risk on → greed.
 *
 * spread = HYG_ret_20d − LQD_ret_20d:
 *   +1.0% → 100, −1.0% → 0
 */
export function junkComponent(
  hygCloses: number[],
  lqdCloses: number[],
): SentimentComponent {
  const hygRet = periodReturn(hygCloses, 20);
  const lqdRet = periodReturn(lqdCloses, 20);
  const spread =
    Number.isFinite(hygRet) && Number.isFinite(lqdRet) ? hygRet - lqdRet : NaN;
  const score = Number.isFinite(spread)
    ? linearClamp(spread, -0.01, 0.01)
    : null;
  return {
    key: "junk",
    label: "위험채권 선호 (HYG − LQD 20d)",
    weight: 0.15,
    score,
    raw: Number.isFinite(spread)
      ? `HYG ${(hygRet * 100).toFixed(2)}% vs LQD ${(lqdRet * 100).toFixed(2)}% → ${(spread * 100).toFixed(2)}%`
      : "—",
    description:
      "정크본드(HYG)가 우량채(LQD)보다 잘 가면 위험선호 = 탐욕. 반대로 우량채가 더 잘 가면 안전자산 회피 = 공포.",
  };
}

/**
 * Safe haven demand: 20d return spread between SPY (stocks) and TLT
 * (long-duration treasuries). Stocks outperforming → risk on → greed.
 *
 * spread = SPY_ret_20d − TLT_ret_20d:
 *   +5% → 100, −5% → 0
 */
export function safeHavenComponent(
  spyCloses: number[],
  tltCloses: number[],
): SentimentComponent {
  const spyRet = periodReturn(spyCloses, 20);
  const tltRet = periodReturn(tltCloses, 20);
  const spread =
    Number.isFinite(spyRet) && Number.isFinite(tltRet) ? spyRet - tltRet : NaN;
  const score = Number.isFinite(spread)
    ? linearClamp(spread, -0.05, 0.05)
    : null;
  return {
    key: "safe_haven",
    label: "안전자산 회피 (SPY − TLT 20d)",
    weight: 0.15,
    score,
    raw: Number.isFinite(spread)
      ? `SPY ${(spyRet * 100).toFixed(2)}% vs TLT ${(tltRet * 100).toFixed(2)}% → ${(spread * 100).toFixed(2)}%`
      : "—",
    description:
      "주식(SPY)이 장기국채(TLT)보다 잘 가는 구간은 위험선호(탐욕), 반대는 안전자산 선호(공포).",
  };
}

/* ───────────────────── aggregation ───────────────────── */

export function aggregate(components: SentimentComponent[]): SentimentResult {
  let weighted = 0;
  let weightSum = 0;
  for (const c of components) {
    if (c.score === null) continue;
    weighted += c.score * c.weight;
    weightSum += c.weight;
  }
  const score = weightSum > 0 ? weighted / weightSum : 50;
  return {
    score: Math.round(score * 10) / 10,
    label: scoreToLabel(score),
    components,
    asOf: new Date().toISOString(),
  };
}

export function scoreToLabel(score: number): SentimentLabel {
  if (score < 25) return "extreme-fear";
  if (score < 45) return "fear";
  if (score <= 55) return "neutral";
  if (score <= 75) return "greed";
  return "extreme-greed";
}

export const LABEL_KO: Record<SentimentLabel, string> = {
  "extreme-fear": "극도의 공포",
  fear: "공포",
  neutral: "중립",
  greed: "탐욕",
  "extreme-greed": "극도의 탐욕",
};

export const REQUIRED_TICKERS = [
  "^VIX",
  "^GSPC",
  "HYG",
  "LQD",
  "SPY",
  "TLT",
] as const;
