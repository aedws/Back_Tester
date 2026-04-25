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
  reinvestAlt?: number;
  principalAlt?: number;
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
  const reinvestAltSeries = comparison.reinvestAlt?.series;
  const principalAltSeries = comparison.principalAlt?.series;

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
  function ensure(date: string): MergedPoint {
    let p = byDate.get(date);
    if (!p) {
      p = { date };
      byDate.set(date, p);
    }
    return p;
  }
  for (const p of reinvestSeries) {
    const m = ensure(p.date);
    m.reinvest = p.value;
    m.invested = m.invested ?? p.invested;
  }
  for (const p of noReinvestSeries) {
    const m = ensure(p.date);
    m.noReinvest = p.value;
    m.invested = m.invested ?? p.invested;
  }
  if (reinvestAltSeries) {
    for (const p of reinvestAltSeries) {
      const m = ensure(p.date);
      m.reinvestAlt = p.value;
      m.invested = m.invested ?? p.invested;
    }
  }
  if (principalAltSeries) {
    for (const p of principalAltSeries) {
      const m = ensure(p.date);
      m.principalAlt = p.value;
      m.invested = m.invested ?? p.invested;
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

  const altReinvest = comparison.reinvestAlt;
  const altPrincipal = comparison.principalAlt;

  return (
    <div className="rounded-lg border border-border bg-bg-subtle/40 px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          {ticker} · 분배금 재투자 vs 비재투자
          {altReinvest || altPrincipal ? (
            <span className="ml-1 normal-case text-ink-dim">
              + 대체 시나리오
            </span>
          ) : null}
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
      {altReinvest || altPrincipal ? (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-dim">
          {altReinvest ? (
            <span>
              <span className="text-ink-muted">분배금 → {altReinvest.altTicker}:</span>{" "}
              <span className="tabular-nums text-[#60a5fa]">
                {fmtMoney(altReinvest.finalValue)}
              </span>
              {Number.isFinite(altReinvest.totalReturn) ? (
                <span className="ml-1 tabular-nums">
                  ({altReinvest.totalReturn >= 0 ? "+" : ""}
                  {fmtPct(altReinvest.totalReturn)})
                </span>
              ) : null}
              {altReinvest.altCashIn > 0 ? (
                <span className="ml-1 text-ink-dim">
                  / 유입 분배금 {fmtMoney(altReinvest.altCashIn)}
                </span>
              ) : null}
            </span>
          ) : null}
          {altPrincipal ? (
            <span>
              <span className="text-ink-muted">원금 → {altPrincipal.altTicker}:</span>{" "}
              <span className="tabular-nums text-[#c084fc]">
                {fmtMoney(altPrincipal.finalValue)}
              </span>
              {Number.isFinite(altPrincipal.totalReturn) ? (
                <span className="ml-1 tabular-nums">
                  ({altPrincipal.totalReturn >= 0 ? "+" : ""}
                  {fmtPct(altPrincipal.totalReturn)})
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
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
            {altReinvest ? (
              <Line
                type="monotone"
                dataKey="reinvestAlt"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={false}
                name={`분배금 → ${altReinvest.altTicker} 재투자`}
                isAnimationActive={false}
                connectNulls
              />
            ) : null}
            {altPrincipal ? (
              <Line
                type="monotone"
                dataKey="principalAlt"
                stroke="#c084fc"
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                name={`원금 → ${altPrincipal.altTicker} DCA`}
                isAnimationActive={false}
                connectNulls
              />
            ) : null}
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
        ※ <span className="text-ink-muted">재투자 / 비재투자</span> 곡선은 매수
        스케줄·금액이 모두 동일합니다 — 차이는 분배금 처리뿐 (재투자는 다음
        거래일 종가에 매수 가정).
        {altReinvest ? (
          <>
            {" "}
            <span className="text-ink-muted">분배금 → {altReinvest.altTicker}</span>{" "}
            곡선은 메인 분배 cash가 발생할 때마다 {altReinvest.altTicker}를
            매수해 합산한 평가액 (메인 보유분 + {altReinvest.altTicker} 보유분).
          </>
        ) : null}
        {altPrincipal ? (
          <>
            {" "}
            <span className="text-ink-muted">원금 → {altPrincipal.altTicker}</span>{" "}
            곡선은 같은 매수 스케줄·금액으로 메인 대신 {altPrincipal.altTicker}
            만 산 가상 시나리오입니다 (배당은 자동 재투자 가정).
          </>
        ) : null}
      </p>
    </div>
  );
}
