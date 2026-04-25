"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ReinvestComparison } from "@/lib/dividends";
import { fmtMoney, fmtMoneyCompact, fmtPct } from "@/lib/format";

interface MergedPoint {
  date: string;
  reinvest?: number;
  noReinvest?: number;
  invested?: number;
}

function downsample<T>(points: T[], maxPoints = 600): T[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: T[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]);
  }
  return out;
}

/**
 * Side-by-side equity curve comparison: dividend-reinvest vs cash-collected.
 * Both scenarios share the same out-of-pocket schedule, so the divergence
 * between the two lines is *purely* the compounding effect of reinvestment.
 */
export function ReinvestCompareChart({
  ticker,
  comparison,
}: {
  ticker: string;
  comparison: ReinvestComparison;
}) {
  const reinvestSeries = comparison.reinvest.series;
  const noReinvestSeries = comparison.noReinvest.series;

  if (
    !reinvestSeries ||
    !noReinvestSeries ||
    reinvestSeries.length === 0 ||
    noReinvestSeries.length === 0
  ) {
    return null;
  }

  // Merge by date — both series come from the same chronological walk so
  // they should have identical date sequences, but be defensive.
  const byDate = new Map<string, MergedPoint>();
  for (const p of reinvestSeries) {
    byDate.set(p.date, {
      date: p.date,
      reinvest: p.value,
      invested: p.invested,
    });
  }
  for (const p of noReinvestSeries) {
    const existing = byDate.get(p.date);
    if (existing) {
      existing.noReinvest = p.value;
      existing.invested = existing.invested ?? p.invested;
    } else {
      byDate.set(p.date, {
        date: p.date,
        noReinvest: p.value,
        invested: p.invested,
      });
    }
  }
  const merged = downsample(
    Array.from(byDate.values()).sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    ),
  );

  const liftAbs = comparison.reinvestLift;
  const liftPct =
    Number.isFinite(comparison.reinvest.totalReturn) &&
    Number.isFinite(comparison.noReinvest.totalReturn)
      ? comparison.reinvest.totalReturn - comparison.noReinvest.totalReturn
      : null;

  return (
    <div className="rounded-lg border border-border bg-bg-subtle/40 px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          {ticker} · 분배금 재투자 vs 비재투자 — 시간 경과별 평가액
        </span>
        <span
          className={`text-[11px] tabular-nums ${
            liftAbs >= 0 ? "text-accent-green" : "text-accent-red"
          }`}
        >
          {liftAbs >= 0 ? "+" : ""}
          {fmtMoney(liftAbs)}
          {liftPct !== null ? (
            <span className="ml-1 text-[10px] text-ink-dim">
              ({liftPct >= 0 ? "+" : ""}
              {fmtPct(liftPct)} 수익률 차이)
            </span>
          ) : null}
        </span>
      </div>
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={merged}
            margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
          >
            <CartesianGrid stroke="#1f2530" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#9aa3b2", fontSize: 11 }}
              stroke="#2c3445"
              minTickGap={48}
            />
            <YAxis
              tick={{ fill: "#9aa3b2", fontSize: 11 }}
              stroke="#2c3445"
              tickFormatter={(v) => fmtMoneyCompact(v)}
              width={70}
            />
            <Tooltip
              contentStyle={{
                background: "#11141b",
                border: "1px solid #2c3445",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "#9aa3b2" }}
              formatter={(value: number, name) => [fmtMoney(value), name]}
            />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="line"
              wrapperStyle={{ fontSize: 11, paddingBottom: 4 }}
            />
            <Line
              type="monotone"
              dataKey="reinvest"
              stroke="#34d399"
              strokeWidth={2}
              dot={false}
              name="재투자 시"
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="noReinvest"
              stroke="#fbbf24"
              strokeWidth={2}
              dot={false}
              name="비재투자 (현금 수령)"
              isAnimationActive={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="invested"
              stroke="#6b7280"
              strokeWidth={1.25}
              strokeDasharray="4 3"
              dot={false}
              name="누적 투자금"
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">
        ※ 두 시나리오 모두 매수 스케줄·금액(또는 주식 수)은 동일합니다. 차이는
        분배금 처리 방식에서만 발생합니다 — 재투자 곡선은 다음 거래일 종가로
        매수했다고 가정합니다.
      </p>
    </div>
  );
}
