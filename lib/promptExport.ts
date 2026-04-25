/**
 * Build a Korean-Markdown prompt that summarises a backtest outcome so the
 * user can paste it directly into ChatGPT / Claude / Gemini and ask for an
 * analysis. **No LLM is called from our side** — this module is a pure
 * formatter.
 *
 * The output is structured to be self-contained: a short context paragraph,
 * a metrics table, optional sliding-window distribution / regression
 * channel / dividend reinvestment / split sections, and a closing prompt
 * suggestion the user can edit. Keep the language compact and numerically
 * dense — LLMs do better with concrete tables than with prose.
 */

import type { Frequency } from "./backtest";
import type { PerTickerOutcome } from "./backtestApi";
import { fmtMoney, fmtPct } from "./format";

const FREQ_KO: Record<Frequency, string> = {
  daily: "매일",
  weekly: "매주",
  biweekly: "2주마다",
  monthly: "매월",
  yearly: "매년",
};

export interface BuildPromptOptions {
  outcome: PerTickerOutcome;
  /** Optional benchmark outcome (e.g. VOO) for direct comparison. */
  benchmark?: PerTickerOutcome | null;
  benchmarkSymbol?: string | null;
  /** User-facing settings used to run the backtest (echoed back as context). */
  settings: {
    frequency: Frequency;
    unitMode: "amount" | "shares";
    amount?: number;
    shares?: number;
    fractional?: boolean;
    fractionalShares?: boolean;
  };
}

/**
 * Top-level: returns a Markdown string suitable for clipboard copy.
 */
export function buildBacktestPrompt(opts: BuildPromptOptions): string {
  const { outcome, benchmark, benchmarkSymbol, settings } = opts;
  if (!outcome.ok || !outcome.result) {
    return `# 백테스트 결과 (실패)

티커: ${outcome.ticker}
오류: ${outcome.error ?? "알 수 없음"}
`;
  }

  const r = outcome.result;
  const s = r.summary;
  const lines: string[] = [];

  lines.push(`# ${r.ticker} DCA 백테스트 결과`);
  lines.push("");

  lines.push("## 1. 실행 조건");
  lines.push("");
  lines.push(`- 종목: **${r.ticker}**`);
  lines.push(`- 기간: ${s.startDate} ~ ${s.endDate} (${s.years.toFixed(2)}년)`);
  lines.push(`- 매수 주기: ${FREQ_KO[settings.frequency]}`);
  if (settings.unitMode === "amount") {
    lines.push(
      `- 매수 단위: 금액 고정 (회당 $${(settings.amount ?? 0).toLocaleString()}, ${
        settings.fractional ? "분수 매수 허용" : "정수 주식만"
      })`,
    );
  } else {
    lines.push(
      `- 매수 단위: 주식 수 고정 (회당 ${settings.shares ?? 0}주, ${
        settings.fractionalShares ? "소수점 허용" : "정수만"
      })`,
    );
  }
  lines.push("");

  lines.push("## 2. 핵심 수치");
  lines.push("");
  lines.push("| 항목 | 값 |");
  lines.push("|---|---|");
  lines.push(`| 총 투자금 | ${fmtMoney(s.totalInvested)} |`);
  lines.push(`| 최종 평가액 | ${fmtMoney(s.finalValue)} |`);
  lines.push(`| 평가손익 | ${fmtMoney(s.profit)} |`);
  lines.push(`| 총 수익률 | ${fmtPct(s.totalReturn)} |`);
  lines.push(
    `| 연환산 IRR (Money-weighted, XIRR) | ${
      s.irrAnnualized === null ? "—" : fmtPct(s.irrAnnualized)
    } |`,
  );
  lines.push(`| 최대 낙폭 (MDD) | ${fmtPct(s.maxDrawdown)} |`);
  lines.push(
    `| 보유 주식 수 | ${s.totalShares.toLocaleString("en-US", { maximumFractionDigits: 4 })} 주 |`,
  );
  lines.push(`| 평균 매수가 | ${fmtMoney(s.avgCost)} |`);
  lines.push(`| 마지막 가격 | ${fmtMoney(s.lastPrice)} |`);
  lines.push("");

  lines.push("### Lump-sum (일시 매수) 비교");
  lines.push("");
  lines.push(
    `- 동일 기간에 **첫날 한 번에** 같은 총 투자금을 박았다면:`,
  );
  lines.push(`  - 최종 평가액: ${fmtMoney(s.buyHoldFinalValue)}`);
  lines.push(`  - 총 수익률: ${fmtPct(s.buyHoldReturn)}`);
  lines.push(`  - CAGR: ${fmtPct(s.buyHoldCagr)}`);
  lines.push(
    `- DCA가 ${
      s.totalReturn >= s.buyHoldReturn ? "더 좋았음" : "Lump-sum보다 부진"
    } (${fmtPct(s.totalReturn - s.buyHoldReturn)} 차이)`,
  );
  lines.push("");

  if (benchmark && benchmark.ok && benchmark.result && benchmarkSymbol) {
    const b = benchmark.result.summary;
    lines.push(`## 3. 벤치마크 (${benchmarkSymbol}) 비교`);
    lines.push("");
    lines.push("| 항목 | 본 종목 | " + benchmarkSymbol + " |");
    lines.push("|---|---|---|");
    lines.push(
      `| 총 수익률 | ${fmtPct(s.totalReturn)} | ${fmtPct(b.totalReturn)} |`,
    );
    lines.push(
      `| 연환산 IRR | ${
        s.irrAnnualized === null ? "—" : fmtPct(s.irrAnnualized)
      } | ${b.irrAnnualized === null ? "—" : fmtPct(b.irrAnnualized)} |`,
    );
    lines.push(`| MDD | ${fmtPct(s.maxDrawdown)} | ${fmtPct(b.maxDrawdown)} |`);
    lines.push("");
  }

  if (outcome.windowDistribution) {
    const d = outcome.windowDistribution;
    const p = d.percentiles;
    lines.push("## 4. 과거 진입 시점 분포 (Sliding Window)");
    lines.push("");
    lines.push(
      `상장 이래 가능한 모든 월별 시작점에서 동일 DCA를 ${d.windowYears}년 돌렸을 때의 IRR 분포 (${d.sampleCount}개 시뮬, 데이터 ${d.historyYears.toFixed(1)}년):`,
    );
    lines.push("");
    lines.push("| 분위 | IRR |");
    lines.push("|---|---|");
    lines.push(`| p5 (하위 5%) | ${fmtPct(p.p5)} |`);
    lines.push(`| p25 | ${fmtPct(p.p25)} |`);
    lines.push(`| p50 (중앙) | ${fmtPct(p.p50)} |`);
    lines.push(`| p75 | ${fmtPct(p.p75)} |`);
    lines.push(`| p95 (상위 5%) | ${fmtPct(p.p95)} |`);
    lines.push(`| 평균 | ${fmtPct(d.mean)} |`);
    lines.push("");
    if (
      d.currentPercentile !== null &&
      Number.isFinite(d.currentPercentile)
    ) {
      // currentPercentile is 0-100 in our codebase.
      const pct = d.currentPercentile;
      const top = 100 - pct;
      lines.push(
        `**현재 진입 위치**: 과거 분포의 **상위 ${top.toFixed(0)}%** (백분위 ${pct.toFixed(0)})`,
      );
      lines.push("");
    }
  }

  if (outcome.dividendAnalysis) {
    const da = outcome.dividendAnalysis;
    lines.push("## 5. 분배금 분석");
    lines.push("");
    lines.push(`- 분배 빈도: ${da.cadence}`);
    lines.push(`- 분배 횟수 (윈도우 내): ${da.eventCount}회`);
    lines.push(`- 누적 1주당 분배금: ${fmtMoney(da.totalCash)}`);
    lines.push(`- 실제 수령 분배금 (보유 주식 × 1주당): ${fmtMoney(da.totalReceived)}`);
    lines.push(
      `- 트레일링 12개월 수익률: ${
        da.trailingYield === null ? "—" : fmtPct(da.trailingYield)
      }`,
    );
    lines.push(
      `- 누적 투자금 대비 cash-on-cash: ${
        s.totalInvested > 0 ? fmtPct(da.totalReceived / s.totalInvested) : "—"
      }`,
    );
    lines.push("");
  }

  if (outcome.reinvestComparison) {
    const rc = outcome.reinvestComparison;
    lines.push("## 6. 분배금 재투자 시나리오 비교");
    lines.push("");
    lines.push("| 시나리오 | 최종 평가액 | 총 수익률 |");
    lines.push("|---|---|---|");
    lines.push(
      `| 비재투자 (현금 수령) | ${fmtMoney(rc.noReinvest.finalValue)} | ${fmtPct(rc.noReinvest.totalReturn)} |`,
    );
    lines.push(
      `| 재투자 (자기 자신) | ${fmtMoney(rc.reinvest.finalValue)} | ${fmtPct(rc.reinvest.totalReturn)} |`,
    );
    if (rc.reinvestAlt) {
      lines.push(
        `| 분배금 → ${rc.reinvestAlt.altTicker} 재투자 | ${fmtMoney(rc.reinvestAlt.finalValue)} | ${fmtPct(rc.reinvestAlt.totalReturn)} |`,
      );
    }
    if (rc.principalAlt) {
      lines.push(
        `| 원금 → ${rc.principalAlt.altTicker} DCA | ${fmtMoney(rc.principalAlt.finalValue)} | ${fmtPct(rc.principalAlt.totalReturn)} |`,
      );
    }
    lines.push("");
    lines.push(
      `- 자기 재투자 vs 비재투자 차이: ${
        rc.reinvestLift >= 0 ? "+" : ""
      }${fmtMoney(rc.reinvestLift)}`,
    );
    lines.push("");
  }

  if (outcome.splits && outcome.splits.length > 0) {
    lines.push("## 7. 액면분할 이력 (윈도우 내)");
    lines.push("");
    for (const sp of outcome.splits) {
      lines.push(
        `- ${sp.date}: ${sp.label ?? `${sp.ratio.toFixed(2)}:1`} (비율 ${sp.ratio.toFixed(2)})`,
      );
    }
    lines.push("");
  }

  if (outcome.detection) {
    const det = outcome.detection;
    lines.push("## 8. 종목 메타");
    lines.push("");
    lines.push(`- 커버드콜 ETF 자동 감지: ${det.detected ? "예" : "아니오"}`);
    if (det.reason) {
      lines.push(`- 감지 사유: ${det.reason} (소스: ${det.source})`);
    }
    if (typeof outcome.coveredCallApplied === "boolean") {
      lines.push(
        `- 사용자 적용 여부: ${
          outcome.coveredCallApplied ? "적용 (분배금 분석 ON)" : "미적용"
        }`,
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 분석 요청");
  lines.push("");
  lines.push("위 백테스트 결과를 바탕으로 다음을 한국어로 분석해 주세요:");
  lines.push("");
  lines.push("1. 현재까지의 수익률·IRR·MDD가 객관적으로 어느 수준인지 (분포 기준).");
  lines.push("2. 같은 기간 벤치마크 대비 강점/약점.");
  lines.push("3. 분배금 재투자 시나리오 중 가장 유리한 선택과 그 이유.");
  lines.push("4. 향후 매수 전략에 대한 보수/적극 두 가지 시나리오 제안.");
  lines.push("5. 지금 주의해야 할 리스크 요인.");
  lines.push("");
  lines.push("> 데이터: Yahoo Finance (배당·분할 자동 조정). 세금/수수료 미반영.");

  return lines.join("\n");
}
