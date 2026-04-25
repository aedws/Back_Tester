"use client";

import { useMemo, useState } from "react";

import type { DcaResult, Purchase } from "@/lib/backtest";
import { fmtMoney, fmtNumber } from "@/lib/format";

function buildCsv(result: DcaResult): string {
  const header = ["date", "price", "shares", "invested", "cum_shares", "cum_invested"];
  const rows: string[] = [header.join(",")];
  let cumShares = 0;
  let cumInvested = 0;
  for (const p of result.purchases) {
    cumShares += p.shares;
    cumInvested += p.invested;
    rows.push(
      [
        p.date,
        p.price.toFixed(6),
        p.shares.toFixed(8),
        p.invested.toFixed(6),
        cumShares.toFixed(8),
        cumInvested.toFixed(6),
      ].join(","),
    );
  }
  return rows.join("\n");
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function PurchasesTable({ result }: { result: DcaResult }) {
  const [open, setOpen] = useState(false);
  const enriched = useMemo(() => {
    const out: (Purchase & { cumShares: number; cumInvested: number })[] = [];
    let cs = 0;
    let ci = 0;
    for (const p of result.purchases) {
      cs += p.shares;
      ci += p.invested;
      out.push({ ...p, cumShares: cs, cumInvested: ci });
    }
    return out;
  }, [result]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-sm text-accent hover:underline"
        >
          {open ? "▾ 매수 내역 숨기기" : "▸ 매수 내역 보기"} ({result.purchases.length}회)
        </button>
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              `${result.ticker}_dca_purchases.csv`,
              buildCsv(result),
            )
          }
          className="rounded-md border border-border px-2.5 py-1 text-xs text-ink-muted transition hover:border-border-strong hover:text-ink"
        >
          CSV 다운로드
        </button>
      </div>
      {open ? (
        <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-border">
          <table className="num min-w-full text-sm">
            <thead className="sticky top-0 bg-bg-subtle text-[11px] uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Shares</th>
                <th className="px-3 py-2 text-right font-medium">Invested</th>
                <th className="px-3 py-2 text-right font-medium">Cum. shares</th>
                <th className="px-3 py-2 text-right font-medium">Cum. invested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {enriched.map((p) => (
                <tr key={p.date} className="hover:bg-bg-subtle/60">
                  <td className="px-3 py-1.5 text-ink-muted">{p.date}</td>
                  <td className="px-3 py-1.5 text-right">{fmtMoney(p.price)}</td>
                  <td className="px-3 py-1.5 text-right">
                    {fmtNumber(p.shares, 6)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {fmtMoney(p.invested)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {fmtNumber(p.cumShares, 6)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {fmtMoney(p.cumInvested)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
