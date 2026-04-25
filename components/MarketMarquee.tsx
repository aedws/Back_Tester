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

const REFRESH_MS = 60_000;

export function MarketMarquee() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

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

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const tickers = data?.tickers ?? [];
  const bySymbol = new Map<string, MarketQuote>();
  (data?.quotes ?? []).forEach((q) => bySymbol.set(q.symbol, q));

  return (
    <div className="border-b border-border bg-bg-panel/80 backdrop-blur supports-[backdrop-filter]:bg-bg-panel/60">
      <div className="mx-auto flex max-w-[1280px] items-stretch gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex shrink-0 items-center text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
          Markets
        </div>
        <div
          className="flex min-w-0 flex-1 items-stretch gap-0 overflow-x-auto py-2"
          style={{ scrollbarWidth: "thin" }}
        >
          {tickers.length === 0 && !error ? (
            <SkeletonRow />
          ) : (
            tickers.map((t) => (
              <Cell key={t.symbol} ticker={t} quote={bySymbol.get(t.symbol)} />
            ))
          )}
        </div>
        <div className="flex shrink-0 items-center pl-2 text-[10px] text-ink-dim">
          {error ? (
            <span className="text-accent-red">{error}</span>
          ) : updatedAt ? (
            <span title={new Date(updatedAt).toLocaleString()}>
              {new Date(updatedAt).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
              <span className="ml-1 text-ink-dim/70">· 15m delayed</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Cell({
  ticker,
  quote,
}: {
  ticker: MarketTicker;
  quote: MarketQuote | undefined;
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
        "group flex shrink-0 items-baseline gap-2 border-r border-border/60 px-3 last:border-r-0",
      )}
      title={`${ticker.label} (${ticker.symbol})${
        quote?.marketState ? ` · ${quote.marketState}` : ""
      }`}
    >
      <span className="text-[11px] font-medium text-ink-muted">
        {ticker.label}
      </span>
      <span className="num text-[12px] font-semibold tabular-nums text-ink">
        {typeof price === "number" ? formatPrice(price, ticker.symbol) : "—"}
      </span>
      <span className={classNames("num text-[11px] tabular-nums", toneText)}>
        {typeof pct === "number" ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}
      </span>
    </div>
  );
}

function formatPrice(v: number, symbol: string): string {
  // FX rates show 4 decimals, indices/futures 2 decimals, %-like (VIX) 2.
  const isFx = /=X$/.test(symbol);
  const isOil = symbol === "CL=F";
  const digits = isFx ? 4 : isOil ? 2 : v >= 1000 ? 2 : 2;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function SkeletonRow() {
  return (
    <div className="flex w-full items-center gap-3 py-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-4 w-28 shrink-0 animate-pulse rounded bg-bg-subtle"
        />
      ))}
    </div>
  );
}
