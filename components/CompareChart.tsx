"use client";

import { useMemo } from "react";
import {
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

import type { DcaResult } from "@/lib/backtest";
import { useChartZoom } from "@/lib/useChartZoom";
import { ChartZoomBar } from "./ChartZoomReset";

const COLORS = [
  "#3ea6ff",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#a78bfa",
  "#f472b6",
  "#22d3ee",
  "#fb923c",
];

interface MergedRow {
  date: string;
  [ticker: string]: string | number | null;
}

function mergeRatios(results: DcaResult[]): MergedRow[] {
  const dateSet = new Set<string>();
  for (const r of results) for (const e of r.equityCurve) dateSet.add(e.date);
  const dates = Array.from(dateSet).sort();

  const ratioMaps = results.map((r) => {
    const m = new Map<string, number>();
    for (const e of r.equityCurve) {
      m.set(e.date, e.invested > 0 ? e.value / e.invested : 1);
    }
    return m;
  });

  // Forward-fill across the union of dates so every series has a value.
  const lastValues = new Array(results.length).fill(NaN);
  const out: MergedRow[] = [];
  for (const d of dates) {
    const row: MergedRow = { date: d };
    results.forEach((r, i) => {
      const v = ratioMaps[i].get(d);
      if (typeof v === "number") lastValues[i] = v;
      row[r.ticker] = Number.isFinite(lastValues[i]) ? lastValues[i] : null;
    });
    out.push(row);
  }

  // Downsample to ~800 points
  const max = 800;
  if (out.length <= max) return out;
  const step = Math.ceil(out.length / max);
  const ds: MergedRow[] = [];
  for (let i = 0; i < out.length; i += step) ds.push(out[i]);
  ds.push(out[out.length - 1]);
  return ds;
}

export function CompareChart({ results }: { results: DcaResult[] }) {
  const data = useMemo(() => mergeRatios(results), [results]);
  const zoom = useChartZoom<string>();
  const xDomain = zoom.xDomain;
  const visible = useMemo(() => {
    if (!xDomain) return data;
    const [lo, hi] = xDomain;
    return data.filter((d) => d.date >= lo && d.date <= hi);
  }, [data, xDomain]);

  return (
    <div className="w-full">
      <ChartZoomBar isZoomed={zoom.isZoomed} onReset={zoom.reset} className="mb-1" />
      <div
        className="h-[340px] w-full select-none"
        onDoubleClick={zoom.onDoubleClick}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
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
              tickFormatter={(v) => Number(v).toFixed(2) + "x"}
              width={56}
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
              formatter={(v: number) => `${v.toFixed(3)}x`}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, color: "#9aa3b2" }}
              iconType="plainline"
            />
            <ReferenceLine y={1} stroke="#444a5c" strokeDasharray="3 3" />
            {results.map((r, i) => (
              <Line
                key={r.ticker}
                type="monotone"
                dataKey={r.ticker}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={1.6}
                dot={false}
                isAnimationActive={false}
                connectNulls
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
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
