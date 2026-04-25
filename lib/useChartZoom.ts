"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Generic drag-to-zoom hook for Recharts charts.
 *
 * UX:
 *   - Click + drag horizontally on the chart  → zooms to that X-range.
 *   - Double-click anywhere on the chart      → resets to full range.
 *   - Tiny click without drag                 → no-op (won't accidentally zoom to a point).
 *   - Mouse-up *outside* the chart            → still finalizes the zoom (window listener).
 *
 * How to wire into a chart (recharts):
 *   const zoom = useChartZoom<string>();
 *   const visible = zoom.xDomain ? data.filter((d) => zoom.inDomain(d.date)) : data;
 *
 *   <LineChart
 *     data={visible}
 *     onMouseDown={zoom.onMouseDown}
 *     onMouseMove={zoom.onMouseMove}
 *     onMouseUp={zoom.onMouseUp}
 *     onDoubleClick={zoom.onDoubleClick}
 *   >
 *     <XAxis dataKey="date" />
 *     ...
 *     {zoom.refAreaLeft != null && zoom.refAreaRight != null ? (
 *       <ReferenceArea x1={zoom.refAreaLeft} x2={zoom.refAreaRight} fillOpacity={0.08} />
 *     ) : null}
 *   </LineChart>
 *
 * NOTE: We filter the input data by `xDomain` instead of using `<XAxis domain>`
 * because Recharts ignores `domain` on type="category" axes (which most of our
 * charts use). Filtering also automatically rescales the Y axis to the visible
 * window — exactly what users expect from a zoom.
 */
export interface UseChartZoom<T extends string | number = string> {
  /** Current zoom window, or undefined when fully zoomed out. */
  xDomain: [T, T] | undefined;
  /** Drag-selection start (live) — render as a ReferenceArea to preview the zoom box. */
  refAreaLeft: T | null;
  /** Drag-selection end (live). */
  refAreaRight: T | null;
  /** Has the user zoomed in? Useful to conditionally render a "reset" button. */
  isZoomed: boolean;
  onMouseDown: (e: any) => void;
  onMouseMove: (e: any) => void;
  onMouseUp: () => void;
  onDoubleClick: () => void;
  reset: () => void;
  /** True iff `key` falls within the current zoom window (inclusive). */
  inDomain: (key: T) => boolean;
}

export function useChartZoom<T extends string | number = string>(): UseChartZoom<T> {
  const [refAreaLeft, setRefAreaLeft] = useState<T | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<T | null>(null);
  const [xDomain, setXDomain] = useState<[T, T] | undefined>(undefined);

  // Refs so we can read current drag state inside window-level mouseup without
  // worrying about stale closures.
  const draggingRef = useRef(false);
  const startRef = useRef<T | null>(null);
  const endRef = useRef<T | null>(null);

  const finishDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    let l = startRef.current;
    let r = endRef.current;
    startRef.current = null;
    endRef.current = null;
    setRefAreaLeft(null);
    setRefAreaRight(null);
    if (l !== null && r !== null && l !== r) {
      // String/number comparison both work via JS comparison operators.
      if ((l as unknown as number) > (r as unknown as number)) {
        const tmp = l;
        l = r;
        r = tmp;
      }
      setXDomain([l, r]);
    }
  }, []);

  const onMouseDown = useCallback((e: any) => {
    const lbl = e?.activeLabel;
    if (lbl === undefined || lbl === null) return;
    draggingRef.current = true;
    startRef.current = lbl as T;
    endRef.current = lbl as T;
    setRefAreaLeft(lbl as T);
    setRefAreaRight(lbl as T);
  }, []);

  const onMouseMove = useCallback((e: any) => {
    if (!draggingRef.current) return;
    const lbl = e?.activeLabel;
    if (lbl === undefined || lbl === null) return;
    endRef.current = lbl as T;
    setRefAreaRight(lbl as T);
  }, []);

  const onMouseUp = useCallback(() => {
    finishDrag();
  }, [finishDrag]);

  const reset = useCallback(() => {
    setXDomain(undefined);
    setRefAreaLeft(null);
    setRefAreaRight(null);
    draggingRef.current = false;
    startRef.current = null;
    endRef.current = null;
  }, []);

  // Window-level mouseup so a drag that ends *outside* the chart still commits.
  useEffect(() => {
    function onUp() {
      finishDrag();
    }
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [finishDrag]);

  const inDomain = useCallback(
    (key: T) => {
      if (!xDomain) return true;
      const [lo, hi] = xDomain;
      const k = key as unknown as number;
      return k >= (lo as unknown as number) && k <= (hi as unknown as number);
    },
    [xDomain],
  );

  return {
    xDomain,
    refAreaLeft,
    refAreaRight,
    isZoomed: xDomain !== undefined,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onDoubleClick: reset,
    reset,
    inDomain,
  };
}
