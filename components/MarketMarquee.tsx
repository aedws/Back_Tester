"use client";

import { useEffect, useRef, useState } from "react";

import { classNames } from "@/lib/format";
import type { MarketQuote } from "@/lib/yahoo";

interface MarketTicker {
  symbol: string;
  label: string;
  group: "fx" | "us" | "kr" | "commodity";
}

interface ApiResponse {
  quotes: MarketQuote[];
  tickers: MarketTicker[];
  cached?: boolean;
  ageMs?: number;
  ttlMs?: number;
  warning?: string;
  error?: string;
}

// Foreground: 30s. Background tabs: 5min. We also auto-refresh on
// `visibilitychange` so the bar is fresh the moment the user comes back.
const REFRESH_FOREGROUND_MS = 30_000;
const REFRESH_BACKGROUND_MS = 300_000;

export function MarketMarquee() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/market", { cache: "no-store" });
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? `HTTP ${res.status}`);
        } else {
          setData(json);
          setUpdatedAt(Date.now());
          if (json.warning) {
            setError(`주의: ${json.warning} (캐시값 표시 중)`);
          } else {
            setError(null);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        inFlight.current = false;
      }
    }

    function schedule() {
      if (timerId) clearTimeout(timerId);
      const wait =
        typeof document !== "undefined" && document.hidden
          ? REFRESH_BACKGROUND_MS
          : REFRESH_FOREGROUND_MS;
      timerId = setTimeout(async () => {
        await load();
        if (!cancelled) schedule();
      }, wait);
    }

    function onVisibility() {
      if (typeof document === "undefined") return;
      if (!document.hidden) {
        // Came back to foreground — refresh immediately, then resume cadence.
        load().finally(() => {
          if (!cancelled) schedule();
        });
      } else {
        schedule();
      }
    }

    function onOnline() {
      load();
    }

    load().finally(() => {
      if (!cancelled) schedule();
    });

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
    }

    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
      }
    };
  }, []);

  // Tick every second so the "방금 / Ns 전" label stays alive without
  // re-rendering the whole tree from a fetch.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const tickers = data?.tickers ?? [];
  const bySymbol = new Map<string, MarketQuote>();
  (data?.quotes ?? []).forEach((q) => bySymbol.set(q.symbol, q));

  const ageSeconds =
    updatedAt !== null ? Math.max(0, Math.floor((now - updatedAt) / 1000)) : null;

  return (
    <div className="border-b border-border bg-bg-panel/80 backdrop-blur supports-[backdrop-filter]:bg-bg-panel/60">
      <div className="mx-auto flex max-w-[1280px] items-stretch gap-2 px-3 sm:px-5 lg:px-6">
        <div className="flex shrink-0 items-center pr-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          Markets
        </div>

        {/* Grid that auto-distributes — at ≥640px every cell shares the same
            slot so the 11 tickers always fit on a single line. On very narrow
            mobile we still fall back to horizontal scroll (no overflow on
            desktop). */}
        <div className="min-w-0 flex-1 py-1.5">
          <div
            className="grid auto-cols-fr grid-flow-col gap-x-0 overflow-x-auto sm:overflow-visible"
            style={{ scrollbarWidth: "none" }}
          >
            {tickers.length === 0 && !error ? (
              <SkeletonRow count={11} />
            ) : (
              tickers.map((t, i) => (
                <Cell
                  key={t.symbol}
                  ticker={t}
                  quote={bySymbol.get(t.symbol)}
                  isLast={i === tickers.length - 1}
                />
              ))
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pl-1 text-[10px] text-ink-dim">
          <LiveDot stale={ageSeconds !== null && ageSeconds > 90} />
          {error ? (
            <span className="text-accent-red">{error}</span>
          ) : ageSeconds !== null ? (
            <span title={updatedAt ? new Date(updatedAt).toLocaleString() : ""}>
              {ageSeconds < 5
                ? "방금"
                : ageSeconds < 60
                ? `${ageSeconds}s 전`
                : `${Math.floor(ageSeconds / 60)}m 전`}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LiveDot({ stale }: { stale: boolean }) {
  return (
    <span
      className={classNames(
        "inline-block h-1.5 w-1.5 rounded-full",
        stale ? "bg-accent-amber" : "bg-accent-green animate-pulse",
      )}
      aria-label={stale ? "stale" : "live"}
    />
  );
}

function Cell({
  ticker,
  quote,
  isLast,
}: {
  ticker: MarketTicker;
  quote: MarketQuote | undefined;
  isLast: boolean;
}) {
  const price = quote?.price;
  const pct = quote?.changePercent;
  const tone =
    typeof pct === "number"
      ? pct > 0
        ? "good"
        : pct < 0
        ? "bad"
        : "neutral"
      : "neutral";

  const toneText =
    tone === "good"
      ? "text-accent-green"
      : tone === "bad"
      ? "text-accent-red"
      : "text-ink-muted";

  return (
    <div
      className={classNames(
        "group flex min-w-0 flex-col justify-center px-2 leading-tight",
        !isLast && "border-r border-border/60",
      )}
      title={`${ticker.label} (${ticker.symbol})${
        quote?.marketState ? ` · ${quote.marketState}` : ""
      }`}
    >
      <div className="flex items-baseline gap-1">
        <span className="truncate text-[10px] font-medium text-ink-muted">
          {ticker.label}
        </span>
        <span className={classNames("num shrink-0 text-[10px] font-medium tabular-nums", toneText)}>
          {typeof pct === "number" ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}
        </span>
      </div>
      <div className="num truncate text-[12px] font-semibold tabular-nums text-ink">
        {typeof price === "number" ? formatPrice(price, ticker.symbol) : "—"}
      </div>
    </div>
  );
}

function formatPrice(v: number, symbol: string): string {
  // FX rates 4 decimals, oil 2 decimals, indices 0~2 decimals depending
  // on magnitude (e.g. KOSPI 2,500.12 vs Nasdaq 19,250.45).
  const isFx = /=X$/.test(symbol);
  const isOil = symbol === "CL=F";
  const digits = isFx ? 4 : isOil ? 2 : v >= 10_000 ? 0 : 2;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function SkeletonRow({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={classNames(
            "flex flex-col justify-center gap-1 px-2",
            i < count - 1 && "border-r border-border/60",
          )}
        >
          <div className="h-2.5 w-12 animate-pulse rounded bg-bg-subtle" />
          <div className="h-3 w-16 animate-pulse rounded bg-bg-subtle" />
        </div>
      ))}
    </>
  );
}
