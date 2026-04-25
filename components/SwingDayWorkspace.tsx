"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AdvancedChart, type ChartPerspective } from "@/components/AdvancedChart";
import { classNames } from "@/lib/format";

type Mode = "swing" | "day";

const QUICK_PICKS = [
  { v: "AAPL", label: "AAPL" },
  { v: "NVDA", label: "NVDA" },
  { v: "TSLA", label: "TSLA" },
  { v: "MSFT", label: "MSFT" },
  { v: "META", label: "META" },
  { v: "AMD", label: "AMD" },
  { v: "QQQ", label: "QQQ" },
  { v: "SPY", label: "SPY" },
  { v: "TQQQ", label: "TQQQ" },
  { v: "005930.KS", label: "삼성전자" },
  { v: "000660.KS", label: "SK하이닉스" },
  { v: "069500.KS", label: "KODEX 200" },
];

// Day-trading view refreshes far more aggressively than swing.
const REFRESH_MS: Record<Mode, number> = {
  swing: 60_000,
  day: 15_000,
};

export function SwingDayWorkspace() {
  const [mode, setMode] = useState<Mode>("swing");
  const [tickerInput, setTickerInput] = useState("AAPL");
  const [activeTicker, setActiveTicker] = useState("AAPL");

  // Submit on Enter or via the Apply button.
  function applyTicker(raw: string) {
    const t = raw.trim().toUpperCase();
    if (!t) return;
    setActiveTicker(t);
  }

  // Sync input when a quick-pick is chosen.
  useEffect(() => {
    setTickerInput(activeTicker);
  }, [activeTicker]);

  const perspective: ChartPerspective = mode;
  const refreshMs = REFRESH_MS[mode];

  const description = useMemo(() => {
    if (mode === "swing") {
      return "수일~수주 단위 스윙 트레이딩 관점 — 60m 봉 기본, 20봉 고저점 + ATR×2 손절·익절선";
    }
    return "장중 데이트레이딩 관점 — 5m 봉 기본, 10봉 고저점 + ATR×1.5 손절·익절선, 15초 자동 갱신";
  }, [mode]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-bg-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1">
            {(["swing", "day"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={classNames(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                  mode === m
                    ? "bg-accent text-bg shadow-[0_1px_0_rgba(0,0,0,0.15)]"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {m === "swing" ? "스윙" : "데이"}
              </button>
            ))}
          </div>
          <Link
            href={`/chart/${encodeURIComponent(activeTicker)}`}
            className="text-[11px] font-medium text-ink-muted underline-offset-2 hover:text-accent hover:underline"
          >
            상세 차트 페이지로 →
          </Link>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          {description}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-1 items-stretch gap-2">
            <input
              type="text"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyTicker(tickerInput);
                }
              }}
              placeholder="티커 (예: AAPL, 005930.KS)"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="w-full max-w-[260px] rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm font-mono uppercase text-ink placeholder:text-ink-dim outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <button
              type="button"
              onClick={() => applyTicker(tickerInput)}
              className="rounded-md bg-accent px-3 py-2 text-xs font-semibold text-bg transition hover:brightness-110"
            >
              적용
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {QUICK_PICKS.map((p) => (
            <button
              key={p.v}
              type="button"
              onClick={() => applyTicker(p.v)}
              className={classNames(
                "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                activeTicker === p.v.toUpperCase()
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-border bg-bg-subtle text-ink-muted hover:border-border-strong hover:text-ink",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <AdvancedChart
        ticker={activeTicker}
        initialPerspective={perspective}
        hidePerspectiveSwitch
        autoRefreshMs={refreshMs}
        // Re-mount on mode change so the chart reaches into a fresh state
        // (interval, overlays) instead of preserving the previous mode's UI.
        key={`${activeTicker}|${mode}`}
      />

      <div className="rounded-md border border-dashed border-border bg-bg-panel/50 px-4 py-3 text-[11px] leading-relaxed text-ink-dim">
        본 모드는 단기 트레이딩 보조용 가이드입니다. 손절·익절선은 ATR(14) 기반으로
        자동 산출되며, 실제 진입은 본인 판단/리스크 관리 하에 수행하세요.
        야후 무료 데이터는 약 15분 지연되며, 새로고침 없이 자동 갱신됩니다.
      </div>
    </div>
  );
}
