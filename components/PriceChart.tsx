"use client";

import { useMemo } from "react";
import {
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ComposedChart,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DcaResult } from "@/lib/backtest";
import { fmtMoney } from "@/lib/format";
import type { SplitEvent } from "@/lib/yahoo";
import { useChartZoom } from "@/lib/useChartZoom";
import { ChartZoomBar } from "./ChartZoomReset";

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

export function PriceChart({
  result,
  splits = [],
}: {
  result: DcaResult;
  splits?: SplitEvent[];
}) {
  const data = useMemo(() => {
    const buyByDate = new Map(result.purchases.map((p) => [p.date, p.price]));
    const allPoints: PricePoint[] = result.equityCurve.map((e) => ({
      date: e.date,
      price: e.price,
      buyPrice: buyByDate.get(e.date),
    }));

    const ds = downsample(allPoints).map((p) => ({
      ...p,
      // Re-attach buy markers that may have been thinned out by downsampling.
      buyPrice: buyByDate.get(p.date),
    }));

    // Always render every buy point even if downsampling removed it.
    for (const p of result.purchases) {
      if (!ds.find((d) => d.date === p.date)) {
        ds.push({ date: p.date, price: p.price, buyPrice: p.price });
      }
    }
    ds.sort((a, b) => (a.date < b.date ? -1 : 1));
    return ds;
  }, [result]);

  const zoom = useChartZoom<string>();
  const xDomain = zoom.xDomain;
  const visible = useMemo(() => {
    if (!xDomain) return data;
    const [lo, hi] = xDomain;
    return data.filter((d) => d.date >= lo && d.date <= hi);
  }, [data, xDomain]);
  const visibleSplits = useMemo(() => {
    if (!xDomain) return splits;
    const [lo, hi] = xDomain;
    return splits.filter((sp) => sp.date >= lo && sp.date <= hi);
  }, [splits, xDomain]);

  return (
    <div className="w-full">
      <ChartZoomBar isZoomed={zoom.isZoomed} onReset={zoom.reset} className="mb-1" />
      <div
        className="h-[260px] w-full select-none"
        onDoubleClick={zoom.onDoubleClick}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={visible}
            margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
            onMouseDown={zoom.onMouseDown}
            onMouseMove={zoom.onMouseMove}
            onMouseUp={zoom.onMouseUp}
          >
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
              domain={["auto", "auto"]}
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
            {visibleSplits.map((sp) => (
              <ReferenceLine
                key={`split-${sp.date}`}
                x={sp.date}
                stroke="#a78bfa"
                strokeDasharray="2 4"
                label={{
                  value: `Split ${sp.label ?? `${sp.ratio}:1`}`,
                  fill: "#a78bfa",
                  fontSize: 10,
                  position: "top",
                }}
              />
            ))}
            {zoom.refAreaLeft != null && zoom.refAreaRight != null ? (
              <ReferenceArea
                x1={zoom.refAreaLeft}
                x2={zoom.refAreaRight}
                strokeOpacity={0.3}
                fill="#3ea6ff"
                fillOpacity={0.08}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
