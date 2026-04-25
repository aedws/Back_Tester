// Heuristic detector for covered-call (option-income) ETFs.
//
// We layer four signals, weakest first:
//   1) Curated whitelist of well-known ETF tickers (high confidence).
//   2) Substring match on ticker root (covers e.g. all YieldMax single-stock variants).
//   3) Keyword match in the fund's longName / longBusinessSummary
//      (works for Korean ETFs containing "커버드콜" / "타겟커버드콜").
//   4) Dividend cadence + yield: a fund paying ≥10 distributions per year with
//      a yield ≥6% strongly suggests an option-income vehicle even if the
//      name doesn't say so explicitly.
//
// The detection result also carries the *expected payout cadence* so the
// dividend reinvestment simulator can correctly handle weekly distributors
// like YMAX / YMAG / ULTY.

import type { DividendEvent, QuoteSummary } from "./yahoo";

export type CoveredCallCadence = "weekly" | "monthly" | "irregular" | "unknown";

export interface CoveredCallDetection {
  /** True if the ticker is judged to be a covered-call / option-income ETF. */
  detected: boolean;
  /**
   * Confidence bucket:
   *  - "whitelist"  : ticker matches our curated list
   *  - "name"       : matched via name / description keywords
   *  - "cadence"    : matched via high-frequency / high-yield distribution pattern
   *  - "none"       : not detected
   */
  source: "whitelist" | "name" | "cadence" | "none";
  /** Expected distribution cadence (used by dividend simulator). */
  cadence: CoveredCallCadence;
  /** Human-readable explanation, shown in the UI. */
  reason: string;
}

// ---------------------------------------------------------------------------
// 1) Curated whitelist
// ---------------------------------------------------------------------------
// Tickers known to run covered-call / equity-income strategies. Keep this
// list deliberately conservative — false positives would cause us to apply
// "weekly dividend reinvestment" to plain index funds.

interface WhitelistEntry {
  cadence: CoveredCallCadence;
}

const WHITELIST: Record<string, WhitelistEntry> = {
  // --- US monthly-distribution covered-call ETFs ---
  JEPI: { cadence: "monthly" },
  JEPQ: { cadence: "monthly" },
  QYLD: { cadence: "monthly" },
  RYLD: { cadence: "monthly" },
  XYLD: { cadence: "monthly" },
  QYLG: { cadence: "monthly" },
  RYLG: { cadence: "monthly" },
  XYLG: { cadence: "monthly" },
  SPYI: { cadence: "monthly" },
  QQQI: { cadence: "monthly" },
  IWMI: { cadence: "monthly" },
  DIVO: { cadence: "monthly" },
  IDVO: { cadence: "monthly" },
  NUSI: { cadence: "monthly" },
  SVOL: { cadence: "monthly" },
  FEPI: { cadence: "monthly" },
  GPIQ: { cadence: "monthly" },
  GPIX: { cadence: "monthly" },
  ISPY: { cadence: "monthly" },
  BTCI: { cadence: "monthly" },
  KLIP: { cadence: "monthly" },
  HYDB: { cadence: "monthly" },

  // --- YieldMax single-stock funds (~monthly, 4-week cycle) ---
  TSLY: { cadence: "monthly" },
  NVDY: { cadence: "monthly" },
  MSFY: { cadence: "monthly" },
  APLY: { cadence: "monthly" },
  AMZY: { cadence: "monthly" },
  GOOY: { cadence: "monthly" },
  METY: { cadence: "monthly" },
  AMDY: { cadence: "monthly" },
  OARK: { cadence: "monthly" },
  BABO: { cadence: "monthly" },
  COIY: { cadence: "monthly" },
  CONY: { cadence: "monthly" },
  FBY: { cadence: "monthly" },
  FIAT: { cadence: "monthly" },
  MRNY: { cadence: "monthly" },
  MSTY: { cadence: "monthly" },
  NFLY: { cadence: "monthly" },
  PYPY: { cadence: "monthly" },
  SQY: { cadence: "monthly" },
  YBIT: { cadence: "monthly" },
  YQQQ: { cadence: "monthly" },
  XOMO: { cadence: "monthly" },
  JPMO: { cadence: "monthly" },
  ABNY: { cadence: "monthly" },
  DISO: { cadence: "monthly" },
  GDXY: { cadence: "monthly" },
  CRSH: { cadence: "monthly" },
  AIYY: { cadence: "monthly" },

  // --- YieldMax weekly-distribution group funds ---
  YMAX: { cadence: "weekly" },
  YMAG: { cadence: "weekly" },
  ULTY: { cadence: "weekly" },
  LFGY: { cadence: "weekly" },

  // --- Korean covered-call / option-income ETFs (KRX) ---
  // Kept conservative — only well-documented funds. Anything else we let the
  // name-keyword path catch (Korean names contain "커버드콜" or "인컴").
  "466920.KS": { cadence: "monthly" }, // TIGER 미국S&P500커버드콜
  "441680.KS": { cadence: "monthly" }, // TIGER 미국나스닥100커버드콜(합성)
  "458760.KS": { cadence: "monthly" }, // KODEX 미국나스닥100인컴
  "472150.KS": { cadence: "monthly" }, // ACE 미국빅테크7+커버드콜
  "481490.KS": { cadence: "monthly" }, // KODEX 미국나스닥100타겟커버드콜
  "481050.KS": { cadence: "monthly" }, // TIGER 미국배당다우존스타겟커버드콜
  "489790.KS": { cadence: "monthly" }, // KODEX 미국30년국채+12%프리미엄(준option income)
};

// ---------------------------------------------------------------------------
// 2) Keyword phrases — these are matched against longName / longBusinessSummary.
// ---------------------------------------------------------------------------
const STRONG_KEYWORDS = [
  // English
  "covered call",
  "covered-call",
  "buywrite",
  "buy-write",
  "option income",
  "option-income",
  "option premium",
  "premium income",
  "yieldmax",
  "yield max",
  // Korean
  "커버드콜",
  "타겟커버드콜",
  "프리미엄인컴",
  "프리미엄 인컴",
  "옵션인컴",
  "옵션 인컴",
];

// Weaker — only triggers when combined with high yield (>=6%).
const WEAK_KEYWORDS = ["high income", "premium yield", "인컴"];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function detectCoveredCall(input: {
  ticker: string;
  summary?: QuoteSummary | null;
  dividends?: ReadonlyArray<DividendEvent>;
  /** Last close price — used to estimate trailing yield. */
  lastPrice?: number | null;
}): CoveredCallDetection {
  const ticker = input.ticker.trim().toUpperCase();

  // (1) whitelist
  const wl = WHITELIST[ticker];
  if (wl) {
    return {
      detected: true,
      source: "whitelist",
      cadence: wl.cadence,
      reason: `${ticker}는 잘 알려진 커버드콜/옵션인컴 ETF입니다. (${
        wl.cadence === "weekly" ? "주배당" : "월배당"
      } 가정)`,
    };
  }

  // (2) name / description keywords
  const haystack = [
    input.summary?.longName ?? "",
    input.summary?.shortName ?? "",
    input.summary?.longBusinessSummary ?? "",
    input.summary?.category ?? "",
  ]
    .join(" \n ")
    .toLowerCase();

  const strongHit = STRONG_KEYWORDS.find((k) => haystack.includes(k));
  if (strongHit) {
    const cadenceFromHistory = inferCadence(input.dividends);
    return {
      detected: true,
      source: "name",
      cadence: cadenceFromHistory ?? "monthly",
      reason: `펀드 설명/이름에서 "${strongHit}" 키워드를 발견했습니다.`,
    };
  }

  // (3) cadence + yield heuristic
  const divs = input.dividends ?? [];
  const cadence = inferCadence(divs);
  const trailingYield = computeTrailingYield(divs, input.lastPrice ?? null);

  // High frequency *and* high yield = very likely option-income.
  if (
    (cadence === "weekly" || cadence === "monthly") &&
    trailingYield !== null &&
    trailingYield >= 0.06
  ) {
    const yieldPct = (trailingYield * 100).toFixed(1);
    return {
      detected: true,
      source: "cadence",
      cadence,
      reason: `최근 12개월 분배 수익률 ${yieldPct}% + ${
        cadence === "weekly" ? "주배당" : "월배당"
      } 패턴 → 옵션 인컴 펀드 가능성 높음.`,
    };
  }

  // weak keyword combined with elevated yield
  const weakHit = WEAK_KEYWORDS.find((k) => haystack.includes(k));
  if (weakHit && trailingYield !== null && trailingYield >= 0.06) {
    return {
      detected: true,
      source: "name",
      cadence: cadence ?? "monthly",
      reason: `"${weakHit}" 키워드 + 분배 수익률 ${
        (trailingYield * 100).toFixed(1)
      }%`,
    };
  }

  return {
    detected: false,
    source: "none",
    cadence: cadence ?? "unknown",
    reason: "커버드콜/옵션인컴 ETF로 판단되지 않습니다.",
  };
}

/**
 * Look at the gaps between dividend events in the most recent 12 months and
 * decide whether the cadence is weekly, monthly, or irregular.
 */
export function inferCadence(
  dividends?: ReadonlyArray<DividendEvent>,
): CoveredCallCadence | null {
  if (!dividends || dividends.length === 0) return null;
  const sorted = [...dividends].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = sorted[sorted.length - 1];
  const cutoff = shiftIso(last.date, -370);
  const recent = sorted.filter((d) => d.date >= cutoff);
  if (recent.length < 3) return null;

  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    gaps.push(daysBetween(recent[i - 1].date, recent[i].date));
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];

  if (recent.length >= 30 && median <= 10) return "weekly";
  if (recent.length >= 8 && median <= 40) return "monthly";
  if (recent.length >= 3) return "irregular";
  return null;
}

function computeTrailingYield(
  dividends: ReadonlyArray<DividendEvent>,
  lastPrice: number | null,
): number | null {
  if (!dividends.length || !lastPrice || lastPrice <= 0) return null;
  const last = dividends[dividends.length - 1];
  const cutoff = shiftIso(last.date, -365);
  let sum = 0;
  for (const d of dividends) if (d.date >= cutoff) sum += d.amount;
  if (sum <= 0) return null;
  return sum / lastPrice;
}

function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso + "T00:00:00Z");
  const b = Date.parse(bIso + "T00:00:00Z");
  return Math.abs((b - a) / 86_400_000);
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
