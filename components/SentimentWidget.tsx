"use client";

import { useEffect, useRef, useState } from "react";

import {
  LABEL_KO,
  type SentimentComponent,
  type SentimentLabel,
  type SentimentResult,
} from "@/lib/sentiment";
import { classNames } from "@/lib/format";

interface ApiResponse extends SentimentResult {
  cached?: boolean;
  ageMs?: number;
  ttlMs?: number;
  warning?: string;
  error?: string;
}

const REFRESH_MS = 5 * 60_000;       // foreground
const REFRESH_BG_MS = 30 * 60_000;   // hidden tab — slow it way down

export function SentimentWidget({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/sentiment", { cache: "no-store" });
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? `HTTP ${res.status}`);
        } else {
          setData(json);
          setUpdatedAt(Date.now());
          setError(json.warning ? `주의: ${json.warning}` : null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight.current = false;
      }
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      const wait =
        typeof document !== "undefined" && document.hidden
          ? REFRESH_BG_MS
          : REFRESH_MS;
      timer = setTimeout(async () => {
        await load();
        if (!cancelled) schedule();
      }, wait);
    }

    function onVis() {
      if (typeof document === "undefined" || document.hidden) return;
      load().finally(() => {
        if (!cancelled) schedule();
      });
    }

    load().finally(() => {
      if (!cancelled) schedule();
    });

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
  }, []);

  if (compact) {
    return (
      <CompactView data={data} error={error} updatedAt={updatedAt} />
    );
  }

  return <FullView data={data} error={error} updatedAt={updatedAt} />;
}

/* ─────────────────────────── full view ─────────────────────────── */

function FullView({
  data,
  error,
  updatedAt,
}: {
  data: ApiResponse | null;
  error: string | null;
  updatedAt: number | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
            Fear &amp; Greed (자체 합성)
          </div>
          <div className="mt-0.5 text-[11px] text-ink-dim">
            VIX · S&amp;P 모멘텀 · 52주 위치 · 정크본드 · 안전자산 5개 지표 가중평균
          </div>
        </div>
        <FreshnessLabel updatedAt={updatedAt} />
      </div>

      {error && !data ? (
        <div className="mt-3 rounded-md border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[260px_1fr] lg:items-center">
        <div className="flex justify-center lg:justify-start">
          <Gauge score={data?.score ?? null} label={data?.label ?? null} />
        </div>

        <div className="space-y-2">
          {(data?.components ?? PLACEHOLDER_COMPONENTS).map((c) => (
            <ComponentRow key={c.key} c={c} loading={!data} />
          ))}
        </div>
      </div>

      <p className="mt-4 text-[10px] leading-relaxed text-ink-dim">
        ※ CNN의 Fear &amp; Greed Index를 그대로 복제할 수는 없어 (NYSE breadth, 풋콜비율 등은 무료 API 미제공)
        야후로 얻을 수 있는 5가지 지표만으로 자체 합성합니다. 절대값보다 *추세*를 참고하세요. 5분 캐시.
      </p>
    </div>
  );
}

const PLACEHOLDER_COMPONENTS: SentimentComponent[] = [
  { key: "vol", label: "변동성 (VIX)", weight: 0.3, score: null, raw: "—", description: "" },
  { key: "momentum", label: "모멘텀 (S&P500 vs 125d MA)", weight: 0.2, score: null, raw: "—", description: "" },
  { key: "strength", label: "52주 위치 (S&P500)", weight: 0.2, score: null, raw: "—", description: "" },
  { key: "junk", label: "위험채권 선호 (HYG − LQD 20d)", weight: 0.15, score: null, raw: "—", description: "" },
  { key: "safe_haven", label: "안전자산 회피 (SPY − TLT 20d)", weight: 0.15, score: null, raw: "—", description: "" },
];

function ComponentRow({ c, loading }: { c: SentimentComponent; loading: boolean }) {
  const score = c.score;
  const tone = scoreTone(score);
  return (
    <div title={c.description}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-ink-muted">
          {c.label}
          <span className="ml-1.5 text-[10px] text-ink-dim">{Math.round(c.weight * 100)}%</span>
        </span>
        <span
          className={classNames(
            "num tabular-nums font-semibold",
            tone.text,
            loading && "opacity-30",
          )}
        >
          {score === null ? "—" : Math.round(score)}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
        <div
          className={classNames("absolute inset-y-0 left-0 transition-all", tone.bar)}
          style={{ width: score === null ? "0%" : `${score}%` }}
        />
      </div>
      <div className="mt-1 truncate text-[10px] text-ink-dim">{c.raw}</div>
    </div>
  );
}

/* ─────────────────────────── compact view ─────────────────────────── */

function CompactView({
  data,
  error,
  updatedAt,
}: {
  data: ApiResponse | null;
  error: string | null;
  updatedAt: number | null;
}) {
  const score = data?.score ?? null;
  const label = data?.label ?? null;
  const tone = scoreTone(score);

  return (
    <div
      className="flex items-center gap-3 rounded-md border border-border bg-bg-subtle/40 px-3 py-2"
      title={
        error
          ? error
          : data
            ? `자체 합성 Fear & Greed — ${LABEL_KO[label!]} (${data.score})`
            : "자체 합성 Fear & Greed"
      }
    >
      <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
        F&amp;G
      </div>
      <div className="flex items-baseline gap-2">
        <span className={classNames("num text-2xl font-bold tabular-nums", tone.text)}>
          {score === null ? "—" : Math.round(score)}
        </span>
        <span className={classNames("text-xs font-medium", tone.text)}>
          {label ? LABEL_KO[label] : ""}
        </span>
      </div>
      <div className="ml-auto">
        <FreshnessLabel updatedAt={updatedAt} small />
      </div>
    </div>
  );
}

/* ─────────────────────────── gauge ─────────────────────────── */

function Gauge({
  score,
  label,
}: {
  score: number | null;
  label: SentimentLabel | null;
}) {
  // Render a half-circle gauge (180°) with five colored arc segments and an
  // angled needle pointing to the current score.
  const cx = 130;
  const cy = 130;
  const r = 100;
  const width = 260;
  const height = 156;

  // Five arc segments (each 36°), aligned so 0 = far left, 100 = far right.
  const segments = [
    { from: 0,  to: 20,  color: "#dc2626", label: "극공포" }, // red
    { from: 20, to: 40,  color: "#f97316", label: "공포" },   // orange
    { from: 40, to: 60,  color: "#facc15", label: "중립" },   // yellow
    { from: 60, to: 80,  color: "#84cc16", label: "탐욕" },   // light green
    { from: 80, to: 100, color: "#16a34a", label: "극탐욕" }, // green
  ];

  const tone = scoreTone(score);

  return (
    <div className="flex flex-col items-center">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {segments.map((s) => (
          <path
            key={s.from}
            d={describeArc(cx, cy, r, scoreToAngle(s.from), scoreToAngle(s.to))}
            stroke={s.color}
            strokeWidth={20}
            fill="none"
            strokeLinecap="butt"
          />
        ))}
        {/* Tick labels */}
        {[0, 25, 50, 75, 100].map((v) => {
          const ang = scoreToAngle(v) - 90;
          const rad = (ang * Math.PI) / 180;
          const tx = cx + (r + 18) * Math.cos(rad);
          const ty = cy + (r + 18) * Math.sin(rad);
          return (
            <text
              key={v}
              x={tx}
              y={ty}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fill="#6b7280"
            >
              {v}
            </text>
          );
        })}
        {/* Needle */}
        {score !== null ? (
          <NeedleSvg cx={cx} cy={cy} r={r - 14} score={score} />
        ) : null}
        {/* Center cap */}
        <circle cx={cx} cy={cy} r={6} fill="#11141b" stroke="#9aa3b2" strokeWidth={1.5} />
      </svg>
      <div className="-mt-2 flex flex-col items-center">
        <div className={classNames("num text-4xl font-bold tabular-nums", tone.text)}>
          {score === null ? "—" : Math.round(score)}
        </div>
        <div className={classNames("text-xs font-semibold", tone.text)}>
          {label ? LABEL_KO[label] : "데이터 로딩"}
        </div>
      </div>
    </div>
  );
}

function NeedleSvg({
  cx,
  cy,
  r,
  score,
}: {
  cx: number;
  cy: number;
  r: number;
  score: number;
}) {
  const ang = scoreToAngle(score) - 90;
  const rad = (ang * Math.PI) / 180;
  const tipX = cx + r * Math.cos(rad);
  const tipY = cy + r * Math.sin(rad);
  const baseLeft = {
    x: cx + 4 * Math.cos(rad + Math.PI / 2),
    y: cy + 4 * Math.sin(rad + Math.PI / 2),
  };
  const baseRight = {
    x: cx + 4 * Math.cos(rad - Math.PI / 2),
    y: cy + 4 * Math.sin(rad - Math.PI / 2),
  };
  return (
    <polygon
      points={`${tipX},${tipY} ${baseLeft.x},${baseLeft.y} ${baseRight.x},${baseRight.y}`}
      fill="#e5e7eb"
      stroke="#11141b"
      strokeWidth={1}
    />
  );
}

/** 0 → 180°, 100 → 0° (left to right along the top half) */
function scoreToAngle(score: number): number {
  return 180 - (score / 100) * 180;
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  // SVG arc: angle 0° = +x axis. We use "0° at top" semantics, so subtract 90°.
  const sa = ((startAngle - 90) * Math.PI) / 180;
  const ea = ((endAngle - 90) * Math.PI) / 180;
  const sx = cx + r * Math.cos(sa);
  const sy = cy + r * Math.sin(sa);
  const ex = cx + r * Math.cos(ea);
  const ey = cy + r * Math.sin(ea);
  // Note: startAngle > endAngle in our setup (180 → 0), so we sweep CCW.
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  const sweep = endAngle > startAngle ? 1 : 0;
  return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} ${sweep} ${ex} ${ey}`;
}

/* ─────────────────────────── shared bits ─────────────────────────── */

function FreshnessLabel({
  updatedAt,
  small = false,
}: {
  updatedAt: number | null;
  small?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!updatedAt) return null;
  const ageMin = Math.max(0, Math.floor((now - updatedAt) / 60_000));
  const stale = ageMin > 10;
  const label =
    ageMin === 0 ? "방금 갱신" : `${ageMin}m 전`;
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium",
        small ? "text-[10px]" : "text-[10px]",
        stale
          ? "border-accent-amber/40 bg-accent-amber/10 text-accent-amber"
          : "border-accent-green/40 bg-accent-green/10 text-accent-green",
      )}
    >
      <span
        className={classNames(
          "inline-block h-1.5 w-1.5 rounded-full",
          stale ? "bg-accent-amber" : "bg-accent-green animate-pulse",
        )}
      />
      {label}
    </span>
  );
}

function scoreTone(score: number | null): { text: string; bar: string } {
  if (score === null) {
    return { text: "text-ink-muted", bar: "bg-ink-muted/40" };
  }
  if (score < 25) return { text: "text-accent-red", bar: "bg-accent-red" };
  if (score < 45) return { text: "text-accent-amber", bar: "bg-accent-amber" };
  if (score <= 55) return { text: "text-ink-muted", bar: "bg-ink-muted" };
  if (score <= 75) return { text: "text-accent-green", bar: "bg-accent-green" };
  return { text: "text-accent-green", bar: "bg-accent-green" };
}
