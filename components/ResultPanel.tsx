import Link from "next/link";

import type { DcaResult } from "@/lib/backtest";
import type { PerTickerOutcome } from "@/lib/backtestApi";
import type { CoveredCallDetection } from "@/lib/coveredCall";
import type { DividendAnalysis, ReinvestComparison } from "@/lib/dividends";
import { fmtMoney, fmtNumber, fmtPct, classNames } from "@/lib/format";
import type { SplitEvent } from "@/lib/yahoo";

import { Card, CardBody, CardHeader } from "./Card";
import { EquityChart } from "./EquityChart";
import { Kpi } from "./Kpi";
import { PriceChart } from "./PriceChart";
import {
  PromptExportButton,
  type PromptExportSettings,
} from "./PromptExportButton";
import { PurchasesTable } from "./PurchasesTable";
import { ReinvestCompareChart } from "./ReinvestCompareChart";
import { WindowDistributionCard } from "./WindowDistributionCard";

export function ResultPanel({
  outcome,
  benchmark,
  benchmarkOutcome,
  benchmarkSymbol,
  refreshing,
  onToggleCoveredCall,
  exportSettings,
}: {
  outcome: PerTickerOutcome & { result: DcaResult };
  benchmark?: DcaResult | null;
  /** Full benchmark outcome (used for AI-prompt export). */
  benchmarkOutcome?: PerTickerOutcome | null;
  benchmarkSymbol?: string | null;
  refreshing?: boolean;
  onToggleCoveredCall?: (applied: boolean) => void;
  /** When provided, renders an "AI 프롬프트 복사" button in the header. */
  exportSettings?: PromptExportSettings;
}) {
  const result = outcome.result;
  const s = result.summary;
  const profitTone = s.profit >= 0 ? "good" : "bad";

  const benchSymbol = benchmarkSymbol ?? benchmark?.summary.ticker ?? "VOO";
  const benchDelta =
    benchmark && Number.isFinite(benchmark.summary.totalReturn)
      ? s.totalReturn - benchmark.summary.totalReturn
      : null;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-baseline gap-3">
            <span className="text-xl">{s.ticker}</span>
            <span className="text-xs font-normal text-ink-muted">
              {s.startDate} → {s.endDate} · {s.years.toFixed(2)}년 · 매수 {s.nPurchases}회
            </span>
          </span>
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            {exportSettings ? (
              <PromptExportButton
                outcome={outcome}
                benchmark={benchmarkOutcome}
                benchmarkSymbol={benchmarkSymbol}
                settings={exportSettings}
              />
            ) : null}
            <Link
              href={`/chart/${encodeURIComponent(s.ticker)}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-subtle px-2.5 py-1.5 text-[11px] font-medium text-ink-muted transition hover:border-accent hover:text-accent"
            >
              상세 차트 →
            </Link>
          </div>
        }
      />
      <CardBody className="space-y-6">
        {outcome.detection ? (
          <CoveredCallToggle
            ticker={s.ticker}
            detection={outcome.detection}
            applied={outcome.coveredCallApplied ?? outcome.detection.detected}
            refreshing={refreshing ?? false}
            onToggle={onToggleCoveredCall}
          />
        ) : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="총 투자금" value={fmtMoney(s.totalInvested)} />
          <Kpi label="최종 평가액" value={fmtMoney(s.finalValue)} />
          <Kpi
            label="총 수익률"
            value={fmtPct(s.totalReturn)}
            delta={fmtMoney(s.profit)}
            tone={profitTone}
          />
          <Kpi
            label="연환산 IRR"
            value={fmtPct(s.irrAnnualized)}
            tone={(s.irrAnnualized ?? 0) >= 0 ? "good" : "bad"}
            hint="Money-weighted, XIRR"
          />
          <Kpi
            label="최대 낙폭"
            value={fmtPct(s.maxDrawdown)}
            tone="bad"
            hint="Equity curve MDD"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi label="평균 매수가" value={fmtMoney(s.avgCost)} tone="muted" />
          <Kpi label="현재 주가" value={fmtMoney(s.lastPrice)} tone="muted" />
          <Kpi
            label="총 보유 주수"
            value={fmtNumber(s.totalShares, 4)}
            tone="muted"
          />
          <Kpi
            label="일시 매수 시 수익률"
            value={fmtPct(s.buyHoldReturn)}
            hint={`Final ${fmtMoney(s.buyHoldFinalValue)}`}
            tone="muted"
          />
          <Kpi
            label="일시 매수 CAGR"
            value={fmtPct(s.buyHoldCagr)}
            tone="muted"
          />
        </div>

        {benchmark ? (
          <BenchmarkBar
            symbol={benchSymbol}
            self={result}
            bench={benchmark}
            delta={benchDelta}
          />
        ) : null}

        {outcome.splits && outcome.splits.length > 0 ? (
          <SplitsBanner splits={outcome.splits} />
        ) : null}

        {outcome.coveredCallApplied && outcome.dividendAnalysis ? (
          <DividendCard
            ticker={s.ticker}
            analysis={outcome.dividendAnalysis}
            comparison={outcome.reinvestComparison}
            totalInvested={s.totalInvested}
          />
        ) : null}

        {outcome.reinvestComparison &&
        (outcome.coveredCallApplied ||
          outcome.reinvestComparison.reinvestAlt ||
          outcome.reinvestComparison.principalAlt) ? (
          <ReinvestCompareChart
            ticker={s.ticker}
            comparison={outcome.reinvestComparison}
          />
        ) : null}

        {outcome.windowDistribution ? (
          <WindowDistributionCard distribution={outcome.windowDistribution} />
        ) : null}

        <div className="rounded-lg border border-border bg-bg-subtle p-3">
          <div className="mb-1 flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wider text-ink-muted">
            <span>Portfolio value vs invested</span>
            {benchmark ? (
              <span className="flex items-center gap-1.5 text-[10px] text-ink-dim">
                <span className="inline-block h-2 w-3 rounded-sm bg-accent-amber" />
                {benchSymbol} 동일 DCA
              </span>
            ) : null}
          </div>
          <EquityChart
            result={result}
            benchmark={benchmark ?? null}
            benchmarkLabel={benchSymbol}
          />
        </div>

        <div className="rounded-lg border border-border bg-bg-subtle p-3">
          <div className="mb-1 px-1 text-xs font-medium uppercase tracking-wider text-ink-muted">
            Price &amp; buy points
            {outcome.splits && outcome.splits.length > 0 ? (
              <span className="ml-2 text-[10px] font-normal text-ink-dim">
                · 보라색 점선 = 액면분할 시점
              </span>
            ) : null}
          </div>
          <PriceChart result={result} splits={outcome.splits} />
        </div>

        <PurchasesTable result={result} />
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SplitsBanner({ splits }: { splits: SplitEvent[] }) {
  return (
    <div className="rounded-lg border border-accent-amber/30 bg-accent-amber/5 px-3 py-2 text-xs text-ink-muted">
      <div className="mb-1 flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-accent-amber/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-amber">
          액면 분할 발생
        </span>
        <span className="text-[10px] text-ink-dim">
          ※ Yahoo의 조정종가(adjclose) 기준 시뮬이라 보유 주식 수와 평가액은 자동으로 분할 보정됩니다.
        </span>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {splits.map((sp) => (
          <li key={sp.date} className="font-mono">
            <span className="text-ink">{sp.date}</span>
            <span className="ml-1.5 text-accent-amber">
              {sp.label ?? `${sp.ratio}:1`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SOURCE_LABEL: Record<CoveredCallDetection["source"], string> = {
  whitelist: "화이트리스트",
  name: "이름/설명",
  cadence: "분배 패턴",
  none: "—",
};

const CADENCE_LABEL: Record<CoveredCallDetection["cadence"], string> = {
  weekly: "주배당",
  monthly: "월배당",
  irregular: "비정기 분배",
  unknown: "분배 정보 없음",
};

function CoveredCallToggle({
  ticker,
  detection,
  applied,
  refreshing,
  onToggle,
}: {
  ticker: string;
  detection: CoveredCallDetection;
  applied: boolean;
  refreshing: boolean;
  onToggle?: (applied: boolean) => void;
}) {
  const isAuto = detection.detected;

  // Three visual states:
  //  1. detected + applied  → green badge with X to disable
  //  2. detected + manually disabled → muted badge with "다시 켜기"
  //  3. not detected + manually enabled → blue badge "수동 적용 중"
  //  4. not detected + not applied → tiny note offering to enable
  if (applied && isAuto) {
    return (
      <div className="rounded-lg border border-accent-green/40 bg-accent-green/10 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-accent-green/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-green">
                커버드콜 ETF 자동 감지
              </span>
              <span className="text-[10px] text-ink-muted">
                · 근거: {SOURCE_LABEL[detection.source]}
              </span>
              <span className="text-[10px] text-ink-muted">
                · {CADENCE_LABEL[detection.cadence]} 가정
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-ink">
              {detection.reason}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
              분배금/배당 재투자 시뮬을 자동 적용했습니다. 잘못 감지된 경우
              <span className="text-ink"> X</span>를 눌러 끌 수 있어요.
            </p>
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => onToggle?.(false)}
            className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent-green/40 text-accent-green transition hover:border-accent-red hover:bg-accent-red/10 hover:text-accent-red disabled:cursor-not-allowed disabled:opacity-50"
            title={`${ticker}를 일반 종목으로 처리`}
            aria-label="커버드콜 처리 끄기"
          >
            {refreshing ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <span className="text-base leading-none">×</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  if (!applied && isAuto) {
    return (
      <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2 text-xs text-ink-muted">
        커버드콜 ETF로 자동 감지되었지만 사용자가 끔.{" "}
        <button
          type="button"
          disabled={refreshing}
          onClick={() => onToggle?.(true)}
          className="ml-1 font-medium text-accent underline-offset-2 hover:underline disabled:opacity-50"
        >
          {refreshing ? "다시 적용 중…" : "다시 적용"}
        </button>
      </div>
    );
  }

  if (applied && !isAuto) {
    return (
      <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1 rounded-md bg-accent/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
              커버드콜 수동 적용
            </span>
            <p className="mt-1 text-xs text-ink-muted">
              자동 감지되지 않았지만 분배금 분석 / 재투자 시뮬을 강제 적용 중입니다.
            </p>
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => onToggle?.(false)}
            className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/40 text-accent transition hover:border-accent-red hover:text-accent-red disabled:opacity-50"
            aria-label="수동 적용 끄기"
          >
            {refreshing ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <span className="text-base leading-none">×</span>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Not applied, not auto — show subtle "enable" affordance only when there
  // *might* be a reason (cadence detected even without keyword hit).
  return (
    <div className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-ink-dim">
      배당 분배 분석을 보려면{" "}
      <button
        type="button"
        disabled={refreshing}
        onClick={() => onToggle?.(true)}
        className="font-medium text-accent underline-offset-2 hover:underline disabled:opacity-50"
      >
        {refreshing ? "적용 중…" : "수동으로 켜기"}
      </button>
      <span className="ml-1 text-ink-dim">
        (자동 감지: {detection.reason})
      </span>
    </div>
  );
}

function DividendCard({
  ticker,
  analysis,
  comparison,
  totalInvested,
}: {
  ticker: string;
  analysis: DividendAnalysis;
  comparison?: ReinvestComparison;
  totalInvested: number;
}) {
  if (analysis.eventCount === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-subtle/50 px-4 py-3 text-xs text-ink-muted">
        보유 기간 동안의 분배금 이벤트를 찾지 못했습니다.
      </div>
    );
  }

  const cadenceLabel = CADENCE_LABEL[analysis.cadence];
  const yieldDelta =
    comparison && comparison.noReinvest.totalReturn !== undefined
      ? comparison.reinvest.totalReturn - comparison.noReinvest.totalReturn
      : null;
  const cashOnCash =
    totalInvested > 0 ? analysis.totalReceived / totalInvested : null;

  return (
    <div className="rounded-lg border border-border bg-bg-subtle/40 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          분배금 / 배당 재투자 — {ticker} ({cadenceLabel})
        </span>
        <span className="text-[10px] text-ink-dim">
          {analysis.eventCount}회 분배
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <DivCell
          label="누적 분배금 수령"
          value={fmtMoney(analysis.totalReceived)}
        />
        <DivCell
          label="현재 분배 수익률"
          value={
            analysis.trailingYield !== null
              ? fmtPct(analysis.trailingYield)
              : "—"
          }
          hint="trailing 12m / 현재가"
        />
        <DivCell
          label="투자금 대비 누적분배"
          value={cashOnCash !== null ? fmtPct(cashOnCash) : "—"}
          hint="cash-on-cash"
        />
        <DivCell
          label="분배금 (per share, 누적)"
          value={fmtMoney(analysis.totalCash)}
        />
      </div>

      {comparison ? (
        <div className="mt-3 rounded-md border border-border bg-bg/40 p-3">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
            재투자 vs 비재투자 (분배금 처리 방식 비교)
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            <DivCell
              label="재투자 시 평가액"
              value={fmtMoney(comparison.reinvest.finalValue)}
              hint={fmtPct(comparison.reinvest.totalReturn)}
            />
            <DivCell
              label="비재투자 시 평가액"
              value={fmtMoney(comparison.noReinvest.finalValue)}
              hint={`수익률 ${fmtPct(comparison.noReinvest.totalReturn)} · 현금 ${fmtMoney(
                comparison.noReinvest.cashCollected,
              )}`}
            />
            <DivCell
              label="재투자 효과"
              value={fmtMoney(comparison.reinvestLift)}
              hint={
                yieldDelta !== null
                  ? `${yieldDelta >= 0 ? "+" : ""}${fmtPct(yieldDelta)} 수익률 차이`
                  : undefined
              }
              tone={comparison.reinvestLift >= 0 ? "good" : "bad"}
            />
          </div>
        </div>
      ) : null}

      <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">
        ※ 일드맥스(YMAX/YMAG/ULTY 등) 주배당 ETF도 자동으로 처리됩니다. 분배금은
        다음 거래일 종가로 재매수했다고 가정하며, 세금/원천징수는 미반영합니다.
      </p>
    </div>
  );
}

function DivCell({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-ink-dim">
        {label}
      </div>
      <div
        className={classNames(
          "num text-sm font-semibold tabular-nums",
          tone === "good"
            ? "text-accent-green"
            : tone === "bad"
              ? "text-accent-red"
              : "text-ink",
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="text-[10px] text-ink-dim">{hint}</div>
      ) : null}
    </div>
  );
}

function BenchmarkBar({
  symbol,
  self,
  bench,
  delta,
}: {
  symbol: string;
  self: DcaResult;
  bench: DcaResult;
  delta: number | null;
}) {
  const beat = (delta ?? 0) >= 0;
  const tone = beat ? "text-accent-green" : "text-accent-red";

  return (
    <div className="rounded-lg border border-border bg-bg-subtle/50 px-4 py-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        벤치마크 비교 — 같은 기간·같은 주기로 {symbol} DCA
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        <BenchCell label={`${self.summary.ticker} 평가액`} value={fmtMoney(self.summary.finalValue)} />
        <BenchCell label={`${symbol} 평가액`} value={fmtMoney(bench.summary.finalValue)} />
        <BenchCell
          label={`${self.summary.ticker} 수익률`}
          value={fmtPct(self.summary.totalReturn)}
        />
        <BenchCell
          label={`${symbol} 수익률`}
          value={fmtPct(bench.summary.totalReturn)}
        />
      </div>
      {delta !== null ? (
        <div className={classNames("mt-2 text-xs font-medium", tone)}>
          {beat ? "▲" : "▼"} {symbol} 대비{" "}
          <span className="num">{fmtPct(Math.abs(delta))}</span> {beat ? "초과" : "부진"}
        </div>
      ) : null}
    </div>
  );
}

function BenchCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</div>
      <div className="num text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
