"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  atr,
  bollinger,
  rsi,
  sma,
  stochastic,
} from "@/lib/indicators";
import type { LogChannelResult } from "@/lib/regression";
import {
  INTERVAL_LABELS,
  INTERVAL_PLAN,
  UI_INTERVALS,
  type UiInterval,
} from "@/lib/resample";
import { buildSignals, type SignalMarker } from "@/lib/signals";
import { classNames, fmtMoneyCompact, fmtPct } from "@/lib/format";

interface CandleDto {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface ChartResponse {
  ticker: string;
  interval: UiInterval;
  yahooInterval: string;
  rangeDays: number;
  candles: CandleDto[];
  currency?: string | null;
  shortName?: string | null;
  regularMarketPrice?: number | null;
  regressionChannel?: LogChannelResult | null;
  error?: string;
}

const MA_PERIODS = [5, 20, 60, 120, 200] as const;
const MA_COLORS: Record<number, string> = {
  5: "#f87171",   // red
  20: "#fbbf24",  // amber
  60: "#34d399",  // green
  120: "#3ea6ff", // blue
  200: "#a78bfa", // violet
};

type MAFlag = `ma${typeof MA_PERIODS[number]}`;

interface OverlayState {
  ma5: boolean;
  ma20: boolean;
  ma60: boolean;
  ma120: boolean;
  ma200: boolean;
  bb: boolean;
  rsi: boolean;
  stoch: boolean;
  swingLevels: boolean;        // ATR-based stop / take-profit overlay
  regression: boolean;          // log-linear regression channel ±1σ/±2σ
  signals: boolean;             // swing-trade signal markers
}

const DEFAULT_OVERLAYS: OverlayState = {
  ma5: false,
  ma20: true,
  ma60: false,
  ma120: false,
  ma200: true,
  bb: true,
  rsi: true,
  stoch: false,
  swingLevels: false,
  regression: false,
  signals: false,
};

export type ChartPerspective = "investor" | "swing" | "day";

export function AdvancedChart({
  ticker,
  initialPerspective = "investor",
  hidePerspectiveSwitch = false,
  autoRefreshMs,
}: {
  ticker: string;
  /** Initial perspective; defaults to "investor" so existing pages keep working. */
  initialPerspective?: ChartPerspective;
  /** When true, hide the perspective tabs (used by the dedicated swing/day
   *  workspace where the parent owns the mode). */
  hidePerspectiveSwitch?: boolean;
  /** When set (>0), poll the chart endpoint every N ms so prices update
   *  without manual reload. Auto-paused when the tab is hidden. */
  autoRefreshMs?: number;
}) {
  const [interval, setIntervalState] = useState<UiInterval>(() => {
    if (initialPerspective === "swing") return "60m";
    if (initialPerspective === "day") return "5m";
    return "1d";
  });
  const [data, setData] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<OverlayState>(() => {
    if (initialPerspective === "swing") {
      return {
        ...DEFAULT_OVERLAYS,
        ma60: true,
        swingLevels: true,
      };
    }
    if (initialPerspective === "day") {
      return {
        ...DEFAULT_OVERLAYS,
        ma5: true,
        ma60: true,
        ma200: false,
        swingLevels: true,
      };
    }
    return DEFAULT_OVERLAYS;
  });
  const [perspective, setPerspective] =
    useState<ChartPerspective>(initialPerspective);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const reqId = useRef(0);

  // Sync perspective if parent forces a new one (e.g. swing/day sub-tab change).
  useEffect(() => {
    setPerspective(initialPerspective);
  }, [initialPerspective]);

  // Auto-tune overlays per perspective (one-shot when perspective changes).
  // Investors care about MA200/BB/RSI + log-regression channel; swing/day
  // enable swing levels and signal markers by default.
  useEffect(() => {
    if (perspective === "swing") {
      setOverlays((s) => ({
        ...s,
        ma20: true,
        ma60: true,
        ma200: true,
        bb: true,
        rsi: true,
        swingLevels: true,
        regression: false,
        signals: true,
      }));
    } else if (perspective === "day") {
      setOverlays((s) => ({
        ...s,
        ma5: true,
        ma20: true,
        ma60: true,
        ma200: false,
        bb: true,
        rsi: true,
        swingLevels: true,
        regression: false,
        signals: true,
      }));
    } else {
      setOverlays((s) => ({
        ...s,
        ma5: false,
        ma20: true,
        ma60: false,
        ma200: true,
        bb: true,
        rsi: true,
        stoch: false,
        swingLevels: false,
        regression: true,
        signals: false,
      }));
    }
  }, [perspective]);

  // Reasonable default interval per perspective.
  useEffect(() => {
    if (perspective === "investor") setIntervalState("1d");
    else if (perspective === "swing") setIntervalState("60m");
    else if (perspective === "day") setIntervalState("5m");
  }, [perspective]);

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    async function load(quiet: boolean) {
      const id = ++reqId.current;
      if (!quiet) setLoading(true);
      if (!quiet) setError(null);
      try {
        const params = new URLSearchParams({
          ticker,
          interval,
        });
        if (overlays.regression) params.set("regression", "log");
        const res = await fetch(`/api/chart?${params.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as ChartResponse;
        if (cancelled || id !== reqId.current) return;
        if (!res.ok) {
          if (!quiet) {
            setError(json.error ?? `HTTP ${res.status}`);
            setData(null);
          }
        } else {
          setData(json);
          setUpdatedAt(Date.now());
          setError(null);
        }
      } catch (err) {
        if (!cancelled && !quiet)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled && !quiet) setLoading(false);
      }
    }

    function schedule() {
      if (!autoRefreshMs || autoRefreshMs <= 0) return;
      if (timerId) clearTimeout(timerId);
      const wait =
        typeof document !== "undefined" && document.hidden
          ? Math.max(autoRefreshMs * 4, 60_000)
          : autoRefreshMs;
      timerId = setTimeout(async () => {
        await load(true);
        if (!cancelled) schedule();
      }, wait);
    }

    function onVisibility() {
      if (typeof document === "undefined") return;
      if (!document.hidden && autoRefreshMs && autoRefreshMs > 0) {
        load(true).finally(() => {
          if (!cancelled) schedule();
        });
      }
    }

    load(false).finally(() => {
      if (!cancelled) schedule();
    });

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [ticker, interval, autoRefreshMs, overlays.regression]);

  const enriched = useMemo(() => {
    if (!data || data.candles.length === 0) return null;
    const candles = data.candles;
    const closes = candles.map((c) => c.c);
    const highs = candles.map((c) => c.h);
    const lows = candles.map((c) => c.l);

    const mas: Record<number, number[]> = {};
    MA_PERIODS.forEach((p) => {
      mas[p] = sma(closes, p);
    });
    const bb = bollinger(closes, 20, 2);
    const rsi14 = rsi(closes, 14);
    const stoch = stochastic(highs, lows, closes, 14, 3, 3);
    const atr14 = atr(highs, lows, closes, 14);

    const last = candles[candles.length - 1];
    const lastIdx = candles.length - 1;

    return {
      candles,
      closes,
      highs,
      lows,
      mas,
      bb,
      rsi14,
      stoch,
      atr14,
      last,
      lastIdx,
    };
  }, [data]);

  // Build the data series consumed by recharts.
  const rows = useMemo(() => {
    if (!enriched) return [];
    const { candles, mas, bb, rsi14, stoch } = enriched;
    const channel = data?.regressionChannel?.points ?? null;
    return candles.map((c, i) => {
      const ch = channel?.[i];
      return {
        t: c.t,
        label: formatBucket(c.t, interval),
        close: c.c,
        high: c.h,
        low: c.l,
        open: c.o,
        volume: c.v,
        ma5: mas[5][i],
        ma20: mas[20][i],
        ma60: mas[60][i],
        ma120: mas[120][i],
        ma200: mas[200][i],
        bbU: bb.upper[i],
        bbL: bb.lower[i],
        bbM: bb.middle[i],
        rsi: rsi14[i],
        stochK: stoch.k[i],
        stochD: stoch.d[i],
        regFit: ch?.fit ?? NaN,
        regPlus1: ch?.plus1 ?? NaN,
        regPlus2: ch?.plus2 ?? NaN,
        regMinus1: ch?.minus1 ?? NaN,
        regMinus2: ch?.minus2 ?? NaN,
      };
    });
  }, [enriched, interval, data?.regressionChannel]);

  // Swing-trade signal markers — only computed when the user has enabled the
  // overlay so quiet refreshes don't waste CPU.
  const signals = useMemo<SignalMarker[]>(() => {
    if (!overlays.signals || !enriched) return [];
    const { candles, mas, rsi14 } = enriched;
    return buildSignals({
      candles: candles.map((c) => ({
        high: c.h,
        low: c.l,
        close: c.c,
      })),
      // The signals helper accepts the same MA arrays we already compute.
      // Fall back to MA60 if MA50 isn't available (we only run 5/20/60/120/200).
      ma50: mas[60],
      ma200: mas[200],
      rsi: rsi14,
    });
  }, [enriched, overlays.signals]);

  // Rolling 20-period high/low for swing levels (mainstream Donchian-ish).
  const swingLevels = useMemo(() => {
    if (!enriched) return null;
    const { candles, atr14, last, lastIdx } = enriched;
    const lookback = perspective === "day" ? 10 : 20;
    let recentHigh = -Infinity;
    let recentLow = Infinity;
    for (let i = Math.max(0, lastIdx - lookback); i <= lastIdx; i++) {
      if (candles[i].h > recentHigh) recentHigh = candles[i].h;
      if (candles[i].l < recentLow) recentLow = candles[i].l;
    }
    const lastAtr = Number.isFinite(atr14[lastIdx]) ? atr14[lastIdx] : 0;
    const atrMult = perspective === "day" ? 1.5 : 2.0;
    const stopAtr = last.c - atrMult * lastAtr;
    const targetAtr = last.c + atrMult * lastAtr;

    return {
      recentHigh,
      recentLow,
      stopAtr,
      targetAtr,
      atrMult,
      lastAtr,
      lookback,
      lastClose: last.c,
    };
  }, [enriched, perspective]);

  const currency = data?.currency ?? "USD";
  const showRsi = overlays.rsi;
  const showStoch = overlays.stoch;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2 text-sm font-semibold tracking-tight">
            {data?.shortName ? (
              <span className="text-ink">{data.shortName}</span>
            ) : null}
            <span className="font-mono text-ink-muted">{ticker}</span>
            {typeof data?.regularMarketPrice === "number" ? (
              <span className="num text-ink">
                {fmtMoneyCompact(data.regularMarketPrice)}
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-dim">
            <span>
              {INTERVAL_LABELS[interval]} · {INTERVAL_PLAN[interval].rangeHint}
              {currency ? ` · ${currency}` : ""}
            </span>
            {autoRefreshMs && updatedAt ? (
              <UpdatedAt at={updatedAt} />
            ) : null}
          </div>
        </div>
        {hidePerspectiveSwitch ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {(["investor", "swing", "day"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPerspective(p)}
                className={classNames(
                  "rounded-md border px-2.5 py-1.5 text-xs font-medium transition",
                  perspective === p
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border bg-bg-subtle text-ink-muted hover:border-border-strong hover:text-ink",
                )}
              >
                {p === "investor" ? "장기 투자" : p === "swing" ? "스윙" : "데이"}
              </button>
            ))}
          </div>
        )}
      </div>

      <IntervalBar value={interval} onChange={setIntervalState} />

      <OverlayToggles
        overlays={overlays}
        setOverlays={setOverlays}
        perspective={perspective}
      />

      {loading ? (
        <div className="h-[420px] animate-pulse rounded-lg border border-border bg-bg-panel/60" />
      ) : error ? (
        <div className="rounded-md border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-sm text-accent-red">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-border bg-bg-subtle px-3 py-8 text-center text-sm text-ink-muted">
          데이터가 없습니다.
        </div>
      ) : (
        <>
          <PriceFrame
            rows={rows}
            overlays={overlays}
            swingLevels={overlays.swingLevels ? swingLevels : null}
            signals={overlays.signals ? signals : []}
            channelMeta={overlays.regression ? data?.regressionChannel ?? null : null}
          />

          {showRsi ? <RsiFrame rows={rows} /> : null}
          {showStoch ? <StochFrame rows={rows} /> : null}

          {overlays.swingLevels && swingLevels ? (
            <SwingLevelsCard sl={swingLevels} perspective={perspective} />
          ) : null}

          {overlays.regression && data?.regressionChannel ? (
            <RegressionCard channel={data.regressionChannel} />
          ) : null}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------
function UpdatedAt({ at }: { at: number }) {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ageSec = Math.max(0, Math.floor((now - at) / 1000));
  const stale = ageSec > 90;
  const label =
    ageSec < 5 ? "방금 갱신" : ageSec < 60 ? `${ageSec}s 전` : `${Math.floor(ageSec / 60)}m 전`;
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
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

function IntervalBar({
  value,
  onChange,
}: {
  value: UiInterval;
  onChange: (v: UiInterval) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {UI_INTERVALS.map((iv) => (
        <button
          key={iv}
          onClick={() => onChange(iv)}
          className={classNames(
            "rounded-md border px-2 py-1 text-[11px] font-medium transition",
            value === iv
              ? "border-accent bg-accent/15 text-accent"
              : "border-border bg-bg-subtle text-ink-muted hover:border-border-strong hover:text-ink",
          )}
          title={INTERVAL_PLAN[iv].rangeHint}
        >
          {INTERVAL_LABELS[iv]}
        </button>
      ))}
    </div>
  );
}

function OverlayToggles({
  overlays,
  setOverlays,
  perspective,
}: {
  overlays: OverlayState;
  setOverlays: (s: OverlayState) => void;
  perspective: "investor" | "swing" | "day";
}) {
  const toggle = (k: keyof OverlayState) =>
    setOverlays({ ...overlays, [k]: !overlays[k] });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg-subtle/50 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
        Overlays
      </span>
      {MA_PERIODS.map((p) => {
        const k = (`ma${p}` as MAFlag) as keyof OverlayState;
        const on = overlays[k];
        return (
          <button
            key={p}
            onClick={() => toggle(k)}
            className={classNames(
              "rounded-md border px-2 py-0.5 text-[11px] font-medium transition",
              on
                ? "text-bg"
                : "border-border bg-bg-subtle text-ink-muted hover:border-border-strong hover:text-ink",
            )}
            style={
              on
                ? {
                    borderColor: MA_COLORS[p],
                    backgroundColor: MA_COLORS[p] + "26",
                    color: MA_COLORS[p],
                  }
                : {}
            }
          >
            MA{p}
          </button>
        );
      })}
      <Toggle on={overlays.bb} onClick={() => toggle("bb")}>
        BB(20, 2σ)
      </Toggle>
      <Toggle on={overlays.rsi} onClick={() => toggle("rsi")}>
        RSI(14)
      </Toggle>
      <Toggle on={overlays.stoch} onClick={() => toggle("stoch")}>
        Stoch(14,3,3)
      </Toggle>
      {perspective === "investor" ? (
        <Toggle
          on={overlays.regression}
          onClick={() => toggle("regression")}
          tone="violet"
        >
          로그 회귀 채널 ±σ
        </Toggle>
      ) : null}
      {perspective !== "investor" ? (
        <>
          <Toggle
            on={overlays.swingLevels}
            onClick={() => toggle("swingLevels")}
            tone="amber"
          >
            손절·익절선
          </Toggle>
          <Toggle
            on={overlays.signals}
            onClick={() => toggle("signals")}
            tone="green"
          >
            스윙 시그널
          </Toggle>
        </>
      ) : null}
    </div>
  );
}

function Toggle({
  on,
  onClick,
  children,
  tone,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "amber" | "violet" | "green";
}) {
  const onClass = (() => {
    if (!on) return "border-border bg-bg-subtle text-ink-muted hover:border-border-strong hover:text-ink";
    switch (tone) {
      case "amber": return "border-accent-amber bg-accent-amber/15 text-accent-amber";
      case "violet": return "border-[#a78bfa] bg-[#a78bfa]/15 text-[#a78bfa]";
      case "green": return "border-accent-green bg-accent-green/15 text-accent-green";
      default: return "border-accent bg-accent/15 text-accent";
    }
  })();
  return (
    <button
      onClick={onClick}
      className={classNames(
        "rounded-md border px-2 py-0.5 text-[11px] font-medium transition",
        onClass,
      )}
    >
      {children}
    </button>
  );
}

interface Row {
  t: number;
  label: string;
  close: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  ma5: number;
  ma20: number;
  ma60: number;
  ma120: number;
  ma200: number;
  bbU: number;
  bbL: number;
  bbM: number;
  rsi: number;
  stochK: number;
  stochD: number;
}

interface SwingLevels {
  recentHigh: number;
  recentLow: number;
  stopAtr: number;
  targetAtr: number;
  atrMult: number;
  lastAtr: number;
  lookback: number;
  lastClose: number;
}

function PriceFrame({
  rows,
  overlays,
  swingLevels,
  signals,
  channelMeta,
}: {
  rows: Row[];
  overlays: OverlayState;
  swingLevels: SwingLevels | null;
  signals: SignalMarker[];
  channelMeta: LogChannelResult | null;
}) {
  // We pass `channelMeta` only so the legend can show the trend's CAGR/σ if
  // the regression overlay is on; the overlay shape itself is rendered from
  // per-row regFit / regPlus1 / regPlus2 / regMinus1 / regMinus2 fields.
  void channelMeta;
  return (
    <div className="rounded-lg border border-border bg-bg-subtle p-3">
      <div className="h-[420px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
          >
            <XAxis
              dataKey="label"
              tick={{ fill: "#9aa3b2", fontSize: 11 }}
              stroke="#2c3445"
              minTickGap={48}
            />
            <YAxis
              yAxisId="price"
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
              formatter={(value: number, name: string) => {
                if (typeof value !== "number" || !Number.isFinite(value)) {
                  return ["—", name];
                }
                return [fmtMoneyCompact(value), name];
              }}
            />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke="#3ea6ff"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              name="Close"
            />
            {overlays.bb ? (
              <>
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="bbU"
                  stroke="#9aa3b2"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  dot={false}
                  isAnimationActive={false}
                  name="BB upper"
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="bbL"
                  stroke="#9aa3b2"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  dot={false}
                  isAnimationActive={false}
                  name="BB lower"
                />
              </>
            ) : null}
            {MA_PERIODS.map((p) => {
              const k = `ma${p}` as keyof Row;
              const flagKey = (`ma${p}` as MAFlag) as keyof OverlayState;
              if (!overlays[flagKey]) return null;
              return (
                <Line
                  key={p}
                  yAxisId="price"
                  type="monotone"
                  dataKey={k}
                  stroke={MA_COLORS[p]}
                  strokeWidth={1.25}
                  dot={false}
                  isAnimationActive={false}
                  name={`MA${p}`}
                />
              );
            })}
            {overlays.regression ? (
              <>
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="regFit"
                  stroke="#a78bfa"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  name="회귀 추세선"
                  connectNulls
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="regPlus1"
                  stroke="#a78bfa"
                  strokeOpacity={0.55}
                  strokeDasharray="3 4"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  name="+1σ"
                  connectNulls
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="regPlus2"
                  stroke="#a78bfa"
                  strokeOpacity={0.35}
                  strokeDasharray="2 5"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  name="+2σ"
                  connectNulls
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="regMinus1"
                  stroke="#a78bfa"
                  strokeOpacity={0.55}
                  strokeDasharray="3 4"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  name="−1σ"
                  connectNulls
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="regMinus2"
                  stroke="#a78bfa"
                  strokeOpacity={0.35}
                  strokeDasharray="2 5"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  name="−2σ"
                  connectNulls
                />
              </>
            ) : null}
            {signals.map((m, k) => {
              const row = rows[m.i];
              if (!row) return null;
              const isBuy = m.side === "buy";
              return (
                <ReferenceDot
                  key={`sig-${k}`}
                  yAxisId="price"
                  x={row.label}
                  y={m.price}
                  r={5}
                  fill={isBuy ? "#34d399" : "#f87171"}
                  stroke="#0b0d12"
                  strokeWidth={1.25}
                  isFront
                  ifOverflow="extendDomain"
                />
              );
            })}
            {swingLevels ? (
              <>
                <ReferenceLine
                  yAxisId="price"
                  y={swingLevels.stopAtr}
                  stroke="#f87171"
                  strokeDasharray="6 3"
                  label={{
                    value: `손절 (ATR ×${swingLevels.atrMult})`,
                    position: "insideTopRight",
                    fill: "#f87171",
                    fontSize: 10,
                  }}
                />
                <ReferenceLine
                  yAxisId="price"
                  y={swingLevels.targetAtr}
                  stroke="#34d399"
                  strokeDasharray="6 3"
                  label={{
                    value: `익절 (ATR ×${swingLevels.atrMult})`,
                    position: "insideBottomRight",
                    fill: "#34d399",
                    fontSize: 10,
                  }}
                />
                <ReferenceLine
                  yAxisId="price"
                  y={swingLevels.recentHigh}
                  stroke="#fbbf24"
                  strokeDasharray="2 4"
                  label={{
                    value: `최근 ${swingLevels.lookback}봉 고점`,
                    position: "insideTopLeft",
                    fill: "#fbbf24",
                    fontSize: 10,
                  }}
                />
                <ReferenceLine
                  yAxisId="price"
                  y={swingLevels.recentLow}
                  stroke="#fbbf24"
                  strokeDasharray="2 4"
                  label={{
                    value: `최근 ${swingLevels.lookback}봉 저점`,
                    position: "insideBottomLeft",
                    fill: "#fbbf24",
                    fontSize: 10,
                  }}
                />
              </>
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 h-[80px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: "#9aa3b2", fontSize: 10 }}
              stroke="#2c3445"
              minTickGap={48}
            />
            <YAxis
              tick={{ fill: "#9aa3b2", fontSize: 10 }}
              stroke="#2c3445"
              width={70}
              tickFormatter={(v) => fmtMoneyCompact(v)}
            />
            <Bar dataKey="volume" fill="#2c3445" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function RsiFrame({ rows }: { rows: Row[] }) {
  return (
    <div className="rounded-lg border border-border bg-bg-subtle p-3">
      <div className="mb-1 flex items-baseline justify-between px-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        <span>RSI(14)</span>
        <span className="text-[10px] text-ink-dim">
          70↑ 과매수 · 30↓ 과매도
        </span>
      </div>
      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fill: "#9aa3b2", fontSize: 10 }} stroke="#2c3445" minTickGap={48} />
            <YAxis
              tick={{ fill: "#9aa3b2", fontSize: 10 }}
              stroke="#2c3445"
              domain={[0, 100]}
              ticks={[0, 30, 50, 70, 100]}
              width={32}
            />
            <Tooltip
              contentStyle={{
                background: "#11141b",
                border: "1px solid #2c3445",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "#9aa3b2" }}
              formatter={(v: number) =>
                typeof v === "number" && Number.isFinite(v) ? v.toFixed(1) : "—"
              }
            />
            <ReferenceLine y={70} stroke="#f87171" strokeDasharray="3 3" />
            <ReferenceLine y={30} stroke="#34d399" strokeDasharray="3 3" />
            <ReferenceLine y={50} stroke="#2c3445" />
            <Line
              type="monotone"
              dataKey="rsi"
              stroke="#fbbf24"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              name="RSI"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StochFrame({ rows }: { rows: Row[] }) {
  return (
    <div className="rounded-lg border border-border bg-bg-subtle p-3">
      <div className="mb-1 flex items-baseline justify-between px-1 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        <span>Stochastic (14,3,3)</span>
        <span className="text-[10px] text-ink-dim">
          80↑ 과매수 · 20↓ 과매도
        </span>
      </div>
      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 16, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fill: "#9aa3b2", fontSize: 10 }} stroke="#2c3445" minTickGap={48} />
            <YAxis
              tick={{ fill: "#9aa3b2", fontSize: 10 }}
              stroke="#2c3445"
              domain={[0, 100]}
              ticks={[0, 20, 50, 80, 100]}
              width={32}
            />
            <Tooltip
              contentStyle={{
                background: "#11141b",
                border: "1px solid #2c3445",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "#9aa3b2" }}
              formatter={(v: number) =>
                typeof v === "number" && Number.isFinite(v) ? v.toFixed(1) : "—"
              }
            />
            <ReferenceLine y={80} stroke="#f87171" strokeDasharray="3 3" />
            <ReferenceLine y={20} stroke="#34d399" strokeDasharray="3 3" />
            <Line
              type="monotone"
              dataKey="stochK"
              stroke="#3ea6ff"
              strokeWidth={1.25}
              dot={false}
              isAnimationActive={false}
              name="%K"
            />
            <Line
              type="monotone"
              dataKey="stochD"
              stroke="#f87171"
              strokeWidth={1.25}
              dot={false}
              isAnimationActive={false}
              name="%D"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SwingLevelsCard({
  sl,
  perspective,
}: {
  sl: SwingLevels;
  perspective: "investor" | "swing" | "day";
}) {
  const headerLabel = perspective === "day" ? "데이트레이딩" : "스윙트레이딩";
  return (
    <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          {headerLabel} 손절·익절선 (현재가 기준)
        </div>
        <div className="text-[11px] text-ink-dim">
          현재가 {fmtMoneyCompact(sl.lastClose)} · ATR(14) {sl.lastAtr.toFixed(2)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cell label={`손절 (ATR ×${sl.atrMult})`} value={fmtMoneyCompact(sl.stopAtr)} tone="bad" />
        <Cell label={`익절 (ATR ×${sl.atrMult})`} value={fmtMoneyCompact(sl.targetAtr)} tone="good" />
        <Cell
          label={`최근 ${sl.lookback}봉 저점 (지지)`}
          value={fmtMoneyCompact(sl.recentLow)}
          tone="amber"
        />
        <Cell
          label={`최근 ${sl.lookback}봉 고점 (저항)`}
          value={fmtMoneyCompact(sl.recentHigh)}
          tone="amber"
        />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">
        ATR(14) 기반 트레일링 스톱 ×{sl.atrMult}는 변동성 대비 보수적으로 잡은 수치이고,
        최근 {sl.lookback}봉 고저점은 단기 지지·저항 가이드입니다. 데이는 ATR×1.5 + 10봉,
        스윙은 ATR×2 + 20봉 기준으로 자동 적용됩니다.
      </p>
    </div>
  );
}

function RegressionCard({ channel }: { channel: LogChannelResult }) {
  const z = channel.zScore;
  const zTone =
    z >= 2 ? "text-accent-red"
    : z >= 1 ? "text-accent-amber"
    : z <= -2 ? "text-accent-green"
    : z <= -1 ? "text-accent-green"
    : "text-ink-muted";
  const zLabel =
    z >= 2 ? "과열 (>+2σ — 추세선 대비 매우 위)"
    : z >= 1 ? "고평가 권역 (+1σ ~ +2σ)"
    : z <= -2 ? "과매도 (< −2σ — 추세선 대비 매우 아래)"
    : z <= -1 ? "저평가 권역 (−1σ ~ −2σ)"
    : "추세선 ±1σ 이내 — 정상 범위";
  return (
    <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
          로그-선형 회귀 채널
        </div>
        <div className="text-[11px] text-ink-dim">
          R² {channel.r2.toFixed(3)} · σ(log) {channel.sigma.toFixed(3)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Cell label="추정 연성장률 (CAGR)" value={fmtPct(channel.cagr)} tone={channel.cagr >= 0 ? "good" : "bad"} />
        <Cell label="현재 z-score" value={`${z.toFixed(2)}σ`} tone={z >= 1 ? "amber" : z <= -1 ? "good" : "amber"} />
        <Cell label="해석" value={zLabel} tone="amber" />
      </div>
      <p className={classNames("mt-3 text-[11px] leading-relaxed", zTone)}>
        ※ ln(가격) ≈ a + b·t에 OLS를 적합한 추세선과 ±1σ/±2σ 채널입니다. 채널 상단(±2σ)은
        장기 추세 대비 *과열·저항선* 후보, 하단은 *과매도·지지선* 후보로 해석됩니다. 단기
        타이밍 도구가 아니며, 보이는 차트 구간 내 데이터로만 적합됩니다.
      </p>
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "amber";
}) {
  const cls =
    tone === "good"
      ? "text-accent-green"
      : tone === "bad"
      ? "text-accent-red"
      : "text-accent-amber";
  return (
    <div className="rounded-md border border-border bg-bg-panel/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-dim">
        {label}
      </div>
      <div className={classNames("num mt-1 text-base font-semibold tabular-nums", cls)}>
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatBucket(t: number, interval: UiInterval): string {
  const d = new Date(t);
  if (interval === "1y" || interval === "1mo") {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (interval === "1wk" || interval === "1d") {
    return d.toISOString().slice(0, 10);
  }
  // intraday
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
