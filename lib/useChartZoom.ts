"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * Generic zoom hook for Recharts charts.
 *
 * Supports three input modalities:
 *   1. **Mouse wheel zoom** (PC) — scroll wheel inside the chart container
 *      zooms in/out anchored at the cursor's X position. Page scroll is
 *      blocked while the cursor is over the chart.
 *   2. **Pinch zoom** (mobile / trackpad) — two-finger touch gesture zooms
 *      in/out anchored at the midpoint between the two fingers.
 *   3. **Drag-box zoom** — click + drag horizontally inside the chart to
 *      zoom into a specific range (the classic Recharts pattern).
 *
 * **Double-click anywhere** resets to full range. The hook also exposes
 * `reset()` so a separate "reset" button can call it.
 *
 * Internally, the zoom state is stored as an *index range* into the input
 * data array — this lets the wheel/pinch handlers map cursor X position to a
 * concrete data point without having to know anything about the chart's
 * internal layout. As a side effect Y-axis values are automatically rescaled
 * to the visible window because we feed `visibleData` (a slice) to the chart.
 *
 * Usage:
 *   const zoom = useChartZoom({ data, getKey: (d) => d.date });
 *
 *   <div ref={zoom.containerRef} onDoubleClick={zoom.onDoubleClick}>
 *     <ResponsiveContainer ...>
 *       <LineChart
 *         data={zoom.visibleData}
 *         onMouseDown={zoom.onMouseDown}
 *         onMouseMove={zoom.onMouseMove}
 *         onMouseUp={zoom.onMouseUp}
 *       >
 *         ...
 *         {zoom.refAreaLeft != null && zoom.refAreaRight != null ? (
 *           <ReferenceArea x1={zoom.refAreaLeft} x2={zoom.refAreaRight} ... />
 *         ) : null}
 *       </LineChart>
 *     </ResponsiveContainer>
 *   </div>
 */
export interface UseChartZoomOptions<T> {
  /** The full data array (already sorted on the X axis). */
  data: T[];
  /** Pulls the X-axis key from a data point. */
  getKey: (item: T) => string | number;
  /** Minimum number of points to keep visible after zooming. Default 5. */
  minVisible?: number;
}

export interface UseChartZoomReturn<T> {
  /** Attach to the chart's wrapping <div> so wheel/touch listeners can bind. */
  containerRef: RefObject<HTMLDivElement>;
  /** Pre-sliced data for the current zoom window — pass this into the chart. */
  visibleData: T[];
  /** True iff zoomed in (i.e. visibleData.length < data.length). */
  isZoomed: boolean;
  /** Drag-zoom selection start (live). Wire into <ReferenceArea x1=...>. */
  refAreaLeft: string | number | null;
  /** Drag-zoom selection end (live). Wire into <ReferenceArea x2=...>. */
  refAreaRight: string | number | null;
  /** Recharts onMouseDown handler — initiates drag-box selection. */
  onMouseDown: (e: any) => void;
  /** Recharts onMouseMove handler — updates drag-box selection. */
  onMouseMove: (e: any) => void;
  /** Recharts onMouseUp handler — commits drag-box selection. */
  onMouseUp: () => void;
  /** Bind to the wrapper div via onDoubleClick to reset. */
  onDoubleClick: () => void;
  reset: () => void;
}

interface ZoomRange {
  lo: number;
  hi: number;
}

export function useChartZoom<T>(
  opts: UseChartZoomOptions<T>,
): UseChartZoomReturn<T> {
  const { data, getKey, minVisible = 5 } = opts;

  const [range, setRange] = useState<ZoomRange | null>(null);
  const [refAreaLeft, setRefAreaLeft] = useState<string | number | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | number | null>(
    null,
  );

  const containerRef = useRef<HTMLDivElement>(null);

  // Mirror state into refs so window/native event listeners can read the
  // latest values without stale closures.
  const rangeRef = useRef<ZoomRange | null>(null);
  rangeRef.current = range;
  const dataRef = useRef(data);
  dataRef.current = data;
  const getKeyRef = useRef(getKey);
  getKeyRef.current = getKey;
  const minVisibleRef = useRef(minVisible);
  minVisibleRef.current = minVisible;

  // Drag-box zoom (Recharts events).
  const draggingRef = useRef(false);
  const dragStartRef = useRef<string | number | null>(null);
  const dragEndRef = useRef<string | number | null>(null);

  const visibleData = useMemo(() => {
    if (!range) return data;
    if (range.lo === 0 && range.hi >= data.length - 1) return data;
    return data.slice(range.lo, range.hi + 1);
  }, [data, range]);

  const reset = useCallback(() => {
    setRange(null);
    setRefAreaLeft(null);
    setRefAreaRight(null);
    draggingRef.current = false;
    dragStartRef.current = null;
    dragEndRef.current = null;
  }, []);

  /**
   * Apply a zoom factor to the current visible range.
   * - factor < 1  → zoom IN  (smaller window)
   * - factor > 1  → zoom OUT (larger window)
   * - ratio       → 0..1 position within the *current visible* window that
   *                 should stay anchored at the same screen X.
   */
  const zoomBy = useCallback((factor: number, ratio: number) => {
    const dataNow = dataRef.current;
    if (dataNow.length === 0) return;

    const cur = rangeRef.current ?? { lo: 0, hi: dataNow.length - 1 };
    const span = cur.hi - cur.lo + 1;
    const anchor = cur.lo + ratio * (span - 1);

    let newSpan = Math.round(span * factor);
    newSpan = Math.max(
      minVisibleRef.current,
      Math.min(dataNow.length, newSpan),
    );

    let newLo = Math.round(anchor - ratio * (newSpan - 1));
    let newHi = newLo + newSpan - 1;

    if (newLo < 0) {
      newHi += -newLo;
      newLo = 0;
    }
    if (newHi > dataNow.length - 1) {
      newLo -= newHi - (dataNow.length - 1);
      newHi = dataNow.length - 1;
    }
    newLo = Math.max(0, newLo);

    if (newLo === 0 && newHi === dataNow.length - 1) {
      setRange(null);
    } else {
      setRange({ lo: newLo, hi: newHi });
    }
  }, []);

  // Wheel + pinch listeners on the container element. We register them
  // imperatively (not via JSX onWheel) because React turns onWheel into a
  // passive listener and we need preventDefault() to stop page scroll while
  // the cursor is over the chart.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let pinchStartDist: number | null = null;
    let pinchStartRange: ZoomRange | null | undefined = undefined;
    let pinchAnchorRatio = 0.5;

    function ratioOf(clientX: number): number {
      const node = containerRef.current;
      if (!node) return 0.5;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0) return 0.5;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }

    function onWheel(e: WheelEvent) {
      // Prevent page scroll only when cursor is inside the chart.
      e.preventDefault();
      const ratio = ratioOf(e.clientX);
      // deltaY > 0  → scrolling down  → zoom OUT
      // deltaY < 0  → scrolling up    → zoom IN
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      zoomBy(factor, ratio);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        pinchStartDist = Math.hypot(
          t1.clientX - t2.clientX,
          t1.clientY - t2.clientY,
        );
        pinchStartRange = rangeRef.current;
        const midX = (t1.clientX + t2.clientX) / 2;
        pinchAnchorRatio = ratioOf(midX);
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && pinchStartDist != null) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(
          t1.clientX - t2.clientX,
          t1.clientY - t2.clientY,
        );
        if (dist === 0) return;
        const factor = pinchStartDist / dist; // pinch out → factor < 1 → zoom in

        const dataNow = dataRef.current;
        if (!dataNow.length) return;
        const baseRange = pinchStartRange ?? {
          lo: 0,
          hi: dataNow.length - 1,
        };
        const baseSpan = baseRange.hi - baseRange.lo + 1;
        let newSpan = Math.round(baseSpan * factor);
        newSpan = Math.max(
          minVisibleRef.current,
          Math.min(dataNow.length, newSpan),
        );
        const baseAnchor = baseRange.lo + pinchAnchorRatio * (baseSpan - 1);
        let newLo = Math.round(baseAnchor - pinchAnchorRatio * (newSpan - 1));
        let newHi = newLo + newSpan - 1;
        if (newLo < 0) {
          newHi += -newLo;
          newLo = 0;
        }
        if (newHi > dataNow.length - 1) {
          newLo -= newHi - (dataNow.length - 1);
          newHi = dataNow.length - 1;
        }
        newLo = Math.max(0, newLo);
        if (newLo === 0 && newHi === dataNow.length - 1) {
          setRange(null);
        } else {
          setRange({ lo: newLo, hi: newHi });
        }
      }
    }

    function onTouchEnd() {
      pinchStartDist = null;
      pinchStartRange = undefined;
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [zoomBy]);

  // ---- Drag-box zoom (Recharts events) ----
  const finishDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const l = dragStartRef.current;
    const r = dragEndRef.current;
    dragStartRef.current = null;
    dragEndRef.current = null;
    setRefAreaLeft(null);
    setRefAreaRight(null);
    if (l == null || r == null || l === r) return;

    // Resolve the labels to indices in the *full* data array.
    const dataNow = dataRef.current;
    const getKeyNow = getKeyRef.current;
    let loIdx = -1;
    let hiIdx = -1;
    for (let i = 0; i < dataNow.length; i++) {
      const k = getKeyNow(dataNow[i]);
      if (k === l && loIdx < 0) loIdx = i;
      if (k === r && hiIdx < 0) hiIdx = i;
      if (loIdx >= 0 && hiIdx >= 0) break;
    }
    if (loIdx < 0 || hiIdx < 0) return;
    if (loIdx > hiIdx) {
      const t = loIdx;
      loIdx = hiIdx;
      hiIdx = t;
    }
    if (hiIdx - loIdx + 1 < minVisibleRef.current) return;
    if (loIdx === 0 && hiIdx === dataNow.length - 1) {
      setRange(null);
    } else {
      setRange({ lo: loIdx, hi: hiIdx });
    }
  }, []);

  const onMouseDown = useCallback((e: any) => {
    const lbl = e?.activeLabel;
    if (lbl === undefined || lbl === null) return;
    draggingRef.current = true;
    dragStartRef.current = lbl;
    dragEndRef.current = lbl;
    setRefAreaLeft(lbl);
    setRefAreaRight(lbl);
  }, []);

  const onMouseMove = useCallback((e: any) => {
    if (!draggingRef.current) return;
    const lbl = e?.activeLabel;
    if (lbl === undefined || lbl === null) return;
    dragEndRef.current = lbl;
    setRefAreaRight(lbl);
  }, []);

  const onMouseUp = useCallback(() => {
    finishDrag();
  }, [finishDrag]);

  // Window-level mouseup so a drag that ends *outside* the container still
  // commits the selection.
  useEffect(() => {
    function up() {
      finishDrag();
    }
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [finishDrag]);

  return {
    containerRef,
    visibleData,
    isZoomed: range !== null,
    refAreaLeft,
    refAreaRight,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onDoubleClick: reset,
    reset,
  };
}
