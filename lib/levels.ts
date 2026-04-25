// Conservative stop-loss / take-profit reference levels.
//
// These are the most commonly cited "rule of thumb" levels in trading
// education and brokerage research notes. They are *guidelines*, not
// recommendations — surfaced so the user can see them at a glance
// alongside the simulated DCA result.
//
// References anchored on the DCA average cost (avgCost) so they make
// sense regardless of when the user actually entered.

import type { DcaSummary } from "./backtest";

export interface ProtectiveLevel {
  /** Display name shown in the UI. */
  label: string;
  /** Absolute price level. */
  price: number;
  /** Percent move from the *current* price required to reach this level. */
  fromPrice: number;
  /** Percent move from the user's *avg cost* this level represents. */
  fromAvg: number;
  /** "stop" = stop-loss, "target" = take-profit. */
  kind: "stop" | "target";
  /** Light/medium/heavy severity for color coding. */
  severity: "soft" | "base" | "hard";
}

export interface ProtectiveLevels {
  avgCost: number;
  lastPrice: number;
  /** Simple PnL from avgCost as a fraction (0.05 = +5%). */
  unrealizedPct: number;
  stops: ProtectiveLevel[];
  targets: ProtectiveLevel[];
}

/**
 * Build conservative stop / target levels from a DCA summary.
 *
 * Stops (mainstream textbook conservative ladder):
 *   - 평단 -8%   (소프트, 기계적 매도 트리거 — Investor's Business Daily 표준)
 *   - 평단 -15%  (베이스, 추세 훼손 경고)
 *   - 평단 -20%  (하드, 약세장 진입 — bear market 정의선)
 *
 * Targets (rule-of-thumb partial-take ladder, 1:1 ~ 1:5 R/R):
 *   - 평단 +25%  (1차 분할익절 — 단기 평균 강세 종목 익절선)
 *   - 평단 +50%  (2차 분할익절 — 중기 50% 이익 실현)
 *   - 평단 +100% (3차 / 텐배거 시작점 — 두 배 도달)
 */
export function buildProtectiveLevels(s: DcaSummary): ProtectiveLevels | null {
  const avg = s.avgCost;
  const last = s.lastPrice;
  if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(last) || last <= 0) {
    return null;
  }

  const stopFractions: Array<{ pct: number; severity: ProtectiveLevel["severity"]; label: string }> = [
    { pct: -0.08, severity: "soft", label: "소프트 손절 (평단 -8%)" },
    { pct: -0.15, severity: "base", label: "베이스 손절 (평단 -15%)" },
    { pct: -0.2, severity: "hard", label: "하드 손절 (평단 -20%)" },
  ];

  const targetFractions: Array<{ pct: number; severity: ProtectiveLevel["severity"]; label: string }> = [
    { pct: 0.25, severity: "soft", label: "1차 익절 (평단 +25%)" },
    { pct: 0.5, severity: "base", label: "2차 익절 (평단 +50%)" },
    { pct: 1.0, severity: "hard", label: "3차 익절 (평단 +100%)" },
  ];

  const toLevel = (
    pct: number,
    kind: ProtectiveLevel["kind"],
    severity: ProtectiveLevel["severity"],
    label: string,
  ): ProtectiveLevel => {
    const price = avg * (1 + pct);
    return {
      label,
      price,
      fromPrice: price / last - 1,
      fromAvg: pct,
      kind,
      severity,
    };
  };

  return {
    avgCost: avg,
    lastPrice: last,
    unrealizedPct: last / avg - 1,
    stops: stopFractions.map(({ pct, severity, label }) =>
      toLevel(pct, "stop", severity, label),
    ),
    targets: targetFractions.map(({ pct, severity, label }) =>
      toLevel(pct, "target", severity, label),
    ),
  };
}
