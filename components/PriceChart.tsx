"use client";

import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ComposedChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DcaResult } from "@/lib/backtest";
import { fmtMoney } from "@/lib/format";

interface PricePoint {
  date: string;
  price: number;
  buyPrice?: number;
}

function downsample<T>(points: T[], maxPoints = 800): T[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: T[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]);
  }
  return out;
}

export function PriceChart({ result }: { result: DcaResult }) {
  const buyByDate = new Map(result.purchases.map((p) => [p.date, p.price]));

  const allPoints: PricePoint[] = result.equityCurve.map((e) => ({
    date: e.date,
    price: e.price,
    buyPrice: buyByDate.get(e.date),
  }));

  const data = downsample(allPoints).map((p) => ({
    ...p,
    // Re-attach buy markers that may have been thinned out by downsampling.
    buyPrice: buyByDate.get(p.date),
  }));

  // Always render every buy point even if downsampling removed it.
  for (const p of result.purchases) {
    if (!data.find((d) => d.date === p.date)) {
      data.push({ date: p.date, price: p.price, buyPrice: p.price });
    }
  }
  data.sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fill: "#9aa3b2", fontSize: 11 }}
            stroke="#2c3445"
            minTickGap={48}
          />
          <YAxis
            tick={{ fill: "#9aa3b2", fontSize: 11 }}
            stroke="#2c3445"
            tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
            width={64}
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
          <Line
            type="monotone"
            dataKey="price"
            stroke="#e6e8ee"
            strokeWidth={1.4}
            dot={false}
            name="Adj. close"
            isAnimationActive={false}
          />
          <Scatter
            dataKey="buyPrice"
            fill="#34d399"
            shape="triangle"
            name="Buy"
          />
          <ReferenceLine
            y={result.summary.avgCost}
            stroke="#fbbf24"
            strokeDasharray="3 3"
            label={{
              value: `Avg ${fmtMoney(result.summary.avgCost)}`,
              fill: "#fbbf24",
              fontSize: 11,
              position: "insideTopLeft",
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
