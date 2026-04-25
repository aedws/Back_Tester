import type { DcaResult } from "@/lib/backtest";
import { fmtMoney, fmtNumber, fmtPct } from "@/lib/format";

import { Card, CardBody, CardHeader } from "./Card";
import { EquityChart } from "./EquityChart";
import { Kpi } from "./Kpi";
import { PriceChart } from "./PriceChart";
import { PurchasesTable } from "./PurchasesTable";

export function ResultPanel({ result }: { result: DcaResult }) {
  const s = result.summary;
  const profitTone = s.profit >= 0 ? "good" : "bad";

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

        <div className="rounded-lg border border-border bg-bg-subtle p-3">
          <div className="mb-1 px-1 text-xs font-medium uppercase tracking-wider text-ink-muted">
            Portfolio value vs invested
          </div>
          <EquityChart result={result} />
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
