import Link from "next/link";

import type { DcaResult } from "@/lib/backtest";
import { fmtMoney, fmtNumber, fmtPct, classNames } from "@/lib/format";

import { Card, CardBody, CardHeader } from "./Card";
import { EquityChart } from "./EquityChart";
import { Kpi } from "./Kpi";
import { PriceChart } from "./PriceChart";
import { PurchasesTable } from "./PurchasesTable";

export function ResultPanel({
  result,
  benchmark,
  benchmarkSymbol,
}: {
  result: DcaResult;
  benchmark?: DcaResult | null;
  benchmarkSymbol?: string | null;
}) {
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
          <Link
            href={`/chart/${encodeURIComponent(s.ticker)}`}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-subtle px-2.5 py-1.5 text-[11px] font-medium text-ink-muted transition hover:border-accent hover:text-accent"
          >
            상세 차트 →
          </Link>
        }
      />
      <CardBody className="space-y-6">
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
            Price & buy points
          </div>
          <PriceChart result={result} />
        </div>

        <PurchasesTable result={result} />
      </CardBody>
    </Card>
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
