import type { DcaResult } from "@/lib/backtest";
import { classNames, fmtMoney, fmtMoneyCompact, fmtPct } from "@/lib/format";

export function CompareTable({ results }: { results: DcaResult[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="num min-w-full text-sm">
        <thead className="bg-bg-subtle text-[11px] uppercase tracking-wider text-ink-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Ticker</th>
            <th className="px-3 py-2 text-left font-medium">Period</th>
            <th className="px-3 py-2 text-right font-medium">Buys</th>
            <th className="px-3 py-2 text-right font-medium">Invested</th>
            <th className="px-3 py-2 text-right font-medium">Final value</th>
            <th className="px-3 py-2 text-right font-medium">Return</th>
            <th className="px-3 py-2 text-right font-medium">IRR</th>
            <th className="px-3 py-2 text-right font-medium">MDD</th>
            <th className="px-3 py-2 text-right font-medium">Avg cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {results.map((r) => {
            const s = r.summary;
            return (
              <tr key={r.ticker} className="hover:bg-bg-subtle/60">
                <td className="px-3 py-2 font-semibold">{s.ticker}</td>
                <td className="px-3 py-2 text-ink-muted">
                  {s.startDate} → {s.endDate}{" "}
                  <span className="text-ink-dim">({s.years.toFixed(1)}y)</span>
                </td>
                <td className="px-3 py-2 text-right">{s.nPurchases}</td>
                <td className="px-3 py-2 text-right">
                  {fmtMoneyCompact(s.totalInvested)}
                </td>
                <td className="px-3 py-2 text-right">
                  {fmtMoneyCompact(s.finalValue)}
                </td>
                <td
                  className={classNames(
                    "px-3 py-2 text-right",
                    s.totalReturn >= 0 ? "text-accent-green" : "text-accent-red",
                  )}
                >
                  {fmtPct(s.totalReturn)}
                </td>
                <td
                  className={classNames(
                    "px-3 py-2 text-right",
                    (s.irrAnnualized ?? 0) >= 0
                      ? "text-accent-green"
                      : "text-accent-red",
                  )}
                >
                  {fmtPct(s.irrAnnualized)}
                </td>
                <td className="px-3 py-2 text-right text-accent-red">
                  {fmtPct(s.maxDrawdown)}
                </td>
                <td className="px-3 py-2 text-right">
                  {fmtMoney(s.avgCost)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
