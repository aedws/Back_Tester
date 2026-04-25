import type { WindowDistribution } from "@/lib/distribution";
import { classNames, fmtPct } from "@/lib/format";

import { Card, CardBody, CardHeader } from "./Card";

export function WindowDistributionCard({
  distribution,
}: {
  distribution: WindowDistribution;
}) {
  const { percentiles, sampleCount, historyYears, windowYears, mean, current, currentPercentile, bins } = distribution;

  const summary = describeRank(currentPercentile);

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-baseline gap-3">
            <span className="text-base">과거 진입 분포</span>
            <span className="text-xs font-normal text-ink-muted">
              상장 이래 {historyYears.toFixed(1)}년 데이터에서 가능한 모든 시작점({sampleCount}개)에 대해
              {" "}{windowYears}년 DCA 시뮬레이션 결과
            </span>
          </span>
        }
      />
      <CardBody className="space-y-4">
        {/* Percentile bar — p5 / p25 / p50 / p75 / p95 with current marker. */}
        <PercentileBar
          percentiles={percentiles}
          current={current}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Pct label="하위 5%" value={percentiles.p5} muted />
          <Pct label="하위 25%" value={percentiles.p25} muted />
          <Pct label="중앙값" value={percentiles.p50} bold />
          <Pct label="상위 25%" value={percentiles.p75} muted />
          <Pct label="상위 5%" value={percentiles.p95} muted />
        </div>

        {/* Mean + current rank summary line */}
        <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs leading-relaxed text-ink-muted">
          <div>
            <span className="text-ink">과거 평균 IRR</span>:{" "}
            <span className={percentTone(mean)}>{fmtPct(mean)}</span>
          </div>
          {current !== null && currentPercentile !== null ? (
            <div className="mt-1">
              <span className="text-ink">현재 진입의 IRR</span>은{" "}
              <span className={classNames("font-semibold", percentTone(current))}>{fmtPct(current)}</span>
              {" "}으로 — 과거 시작점들의{" "}
              <span className="font-semibold text-ink">상위 {(100 - currentPercentile).toFixed(0)}%</span>
              {" "}({summary})
            </div>
          ) : null}
        </div>

        <Histogram bins={bins} current={current} />

        <p className="text-[10px] leading-relaxed text-ink-dim">
          ※ 슬라이딩 윈도우(월 단위 시작점)로 같은 DCA 주기·금액·분수매수 설정을 그대로 시뮬레이션한
          결과의 분포입니다. 과거 성과가 미래를 보장하지는 않습니다.
        </p>
      </CardBody>
    </Card>
  );
}

/* ─────────────────────────── percentile bar ─────────────────────────── */

function PercentileBar({
  percentiles,
  current,
}: {
  percentiles: WindowDistribution["percentiles"];
  current: number | null;
}) {
  const lo = Math.min(percentiles.p5, current ?? percentiles.p5);
  const hi = Math.max(percentiles.p95, current ?? percentiles.p95);
  const span = Math.max(0.0001, hi - lo);

  function pos(v: number): number {
    return ((v - lo) / span) * 100;
  }

  const center = pos(percentiles.p50);

  return (
    <div className="relative h-12 w-full">
      {/* Outer light band: p5 → p95 */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full bg-bg-subtle"
        style={{ left: `${pos(percentiles.p5)}%`, right: `${100 - pos(percentiles.p95)}%` }}
      />
      {/* Inner dark band: p25 → p75 (interquartile range) */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full bg-accent/40"
        style={{ left: `${pos(percentiles.p25)}%`, right: `${100 - pos(percentiles.p75)}%` }}
      />
      {/* Median tick */}
      <div
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-0.5 bg-accent"
        style={{ left: `${center}%` }}
        title={`Median ${fmtPct(percentiles.p50)}`}
      />
      {/* Current marker */}
      {current !== null ? (
        <>
          <div
            className={classNames(
              "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-7 w-1 rounded-full",
              current >= percentiles.p50 ? "bg-accent-green" : "bg-accent-red",
            )}
            style={{ left: `${pos(current)}%` }}
          />
          <div
            className={classNames(
              "absolute -translate-x-1/2 text-[10px] font-semibold tabular-nums",
              current >= percentiles.p50 ? "text-accent-green" : "text-accent-red",
            )}
            style={{ left: `${pos(current)}%`, top: 0 }}
          >
            현재 {fmtPct(current)}
          </div>
        </>
      ) : null}
      {/* Labels at the ends */}
      <div className="absolute bottom-0 left-0 text-[10px] text-ink-dim">
        {fmtPct(percentiles.p5)}
      </div>
      <div className="absolute bottom-0 right-0 text-[10px] text-ink-dim">
        {fmtPct(percentiles.p95)}
      </div>
    </div>
  );
}

/* ─────────────────────────── histogram ─────────────────────────── */

function Histogram({
  bins,
  current,
}: {
  bins: WindowDistribution["bins"];
  current: number | null;
}) {
  const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0) || 1;

  // Find which bin holds the current IRR.
  let currentBinIdx = -1;
  if (current !== null) {
    for (let i = 0; i < bins.length; i++) {
      if (current >= bins[i].lo && (i === bins.length - 1 ? current <= bins[i].hi : current < bins[i].hi)) {
        currentBinIdx = i;
        break;
      }
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-end justify-between text-[10px] uppercase tracking-wider text-ink-dim">
        <span>분포 히스토그램</span>
        <span>샘플 수 {bins.reduce((s, b) => s + b.count, 0)}</span>
      </div>
      <div className="flex h-20 items-end gap-0.5">
        {bins.map((b, i) => (
          <div key={i} className="flex flex-1 flex-col items-center" title={`${fmtPct(b.lo)} – ${fmtPct(b.hi)}: ${b.count}개`}>
            <div
              className={classNames(
                "w-full rounded-t transition-all",
                i === currentBinIdx ? "bg-accent-green" : "bg-accent/35",
              )}
              style={{ height: `${(b.count / maxCount) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-dim tabular-nums">
        <span>{fmtPct(bins[0].lo)}</span>
        <span>{fmtPct(bins[bins.length - 1].hi)}</span>
      </div>
    </div>
  );
}

/* ─────────────────────────── primitives ─────────────────────────── */

function Pct({
  label,
  value,
  muted,
  bold,
}: {
  label: string;
  value: number;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</div>
      <div
        className={classNames(
          "num tabular-nums",
          bold ? "text-base font-semibold" : "text-sm",
          muted ? "text-ink-muted" : "text-ink",
          percentTone(value),
        )}
      >
        {fmtPct(value)}
      </div>
    </div>
  );
}

function percentTone(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (v >= 0.05) return "text-accent-green";
  if (v <= -0.02) return "text-accent-red";
  return "";
}

function describeRank(percentile: number | null): string {
  if (percentile === null) return "샘플 부족";
  if (percentile >= 80) return "역사적으로 매우 좋은 진입";
  if (percentile >= 60) return "평균보다 좋은 진입";
  if (percentile >= 40) return "역사적 평균에 근접";
  if (percentile >= 20) return "평균보다 부진";
  return "역사적으로 부진한 진입";
}
