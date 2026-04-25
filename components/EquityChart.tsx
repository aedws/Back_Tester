"use client";

import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DcaResult } from "@/lib/backtest";
import { fmtMoney, fmtMoneyCompact } from "@/lib/format";
import { useChartZoom } from "@/lib/useChartZoom";
import { ChartZoomBar } from "./ChartZoomReset";

interface Point {
  date: string;
  value: number;
  invested: number;
  benchmark?: number;
}

function downsample(points: Point[], maxPoints = 600): Point[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]);
  }
  return out;
}

export function EquityChart({
  result,
  benchmark,
  benchmarkLabel = "VOO",
}: {
  result: DcaResult;
  benchmark?: DcaResult | null;
  benchmarkLabel?: string;
}) {
  const data: Point[] = useMemo(() => {
    const benchByDate = new Map<string, number>();
    if (benchmark) {
      for (const e of benchmark.equityCurve) benchByDate.set(e.date, e.value);
    }
    return downsample(
      result.equityCurve.map((e) => ({
        date: e.date,
        value: e.value,
        invested: e.invested,
        benchmark: benchByDate.get(e.date),
      })),
    );
  }, [result, benchmark]);

  const zoom = useChartZoom({ data, getKey: (d) => d.date });

  return (
    <div className="w-full">
      <ChartZoomBar isZoomed={zoom.isZoomed} onReset={zoom.reset} className="mb-1" />
      <div
        ref={zoom.containerRef}
        className="h-[360px] w-full touch-none select-none"
        onDoubleClick={zoom.onDoubleClick}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={zoom.visibleData}
            margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
            onMouseDown={zoom.onMouseDown}
            onMouseMove={zoom.onMouseMove}
            onMouseUp={zoom.onMouseUp}
          >
            <defs>
              <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3ea6ff" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#3ea6ff" stopOpacity={0} />
              </linearGradient>
            </defs>
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
            <Area
              type="monotone"
              dataKey="value"
              stroke="#3ea6ff"
              strokeWidth={2}
              fill="url(#equityFill)"
              name="Portfolio value"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="invested"
              stroke="#9aa3b2"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              name="Cumulative invested"
              isAnimationActive={false}
            />
            {benchmark ? (
              <Line
                type="monotone"
                dataKey="benchmark"
                stroke="#fbbf24"
                strokeWidth={1.75}
                dot={false}
                name={`${benchmarkLabel} 동일 DCA`}
                isAnimationActive={false}
                connectNulls
              />
            ) : null}
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
