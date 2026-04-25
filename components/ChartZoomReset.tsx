"use client";

/**
 * Tiny shared header strip for zoomable charts. Renders a hint and (when
 * zoomed) a reset button. Pair it with `useChartZoom` from `@/lib/useChartZoom`.
 */
export function ChartZoomBar({
  isZoomed,
  onReset,
  hint = "드래그 = 줌 / 더블클릭 = 리셋",
  className = "",
}: {
  isZoomed: boolean;
  onReset: () => void;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-end gap-2 text-[10px] text-ink-dim ${className}`}
    >
      <span>{hint}</span>
      {isZoomed ? (
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-border bg-bg-subtle px-2 py-0.5 text-[10px] font-medium text-ink-muted transition hover:border-border-strong hover:text-ink"
          title="더블클릭으로도 리셋 가능"
        >
          ↺ 리셋
        </button>
      ) : null}
    </div>
  );
}
