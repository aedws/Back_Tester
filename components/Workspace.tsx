"use client";

import { useEffect, useState } from "react";

import { BacktestForm } from "@/components/BacktestForm";
import { SentimentWidget } from "@/components/SentimentWidget";
import { SwingDayWorkspace } from "@/components/SwingDayWorkspace";
import { classNames } from "@/lib/format";

export type WorkspaceMode = "backtest" | "trade";

const STORAGE_KEY = "bt:workspace-mode";

export function Workspace() {
  const [mode, setMode] = useState<WorkspaceMode>("backtest");

  // Persist last-used mode locally so refreshes don't reset the user.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "backtest" || saved === "trade") setMode(saved);

    // Read URL hash on mount: #trade or #backtest can deep-link a mode.
    const hash = window.location.hash.replace(/^#/, "");
    if (hash === "trade") setMode("trade");
    else if (hash === "backtest") setMode("backtest");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, mode);
    if (window.location.hash.replace(/^#/, "") !== mode) {
      window.history.replaceState(null, "", `#${mode}`);
    }
  }, [mode]);

  return (
    <div className="space-y-6">
      <ModeTabs mode={mode} setMode={setMode} />
      <SentimentWidget />
      {mode === "backtest" ? <BacktestForm /> : <SwingDayWorkspace />}
    </div>
  );
}

function ModeTabs({
  mode,
  setMode,
}: {
  mode: WorkspaceMode;
  setMode: (m: WorkspaceMode) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-panel p-1.5">
      <div className="grid grid-cols-2 gap-1">
        <Tab
          active={mode === "backtest"}
          onClick={() => setMode("backtest")}
          title="DCA 백테스터"
          subtitle="장기 적립식 매수 시뮬레이션 · IRR · MDD · 벤치마크"
        />
        <Tab
          active={mode === "trade"}
          onClick={() => setMode("trade")}
          title="스윙 · 데이 트레이드"
          subtitle="단기 진입 가이드 · MA/BB/RSI · ATR 손절·익절"
        />
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "flex flex-col items-start rounded-lg px-4 py-3 text-left transition",
        active
          ? "bg-accent/15 text-accent ring-1 ring-accent/40"
          : "text-ink-muted hover:bg-bg-subtle hover:text-ink",
      )}
    >
      <div className="text-sm font-semibold tracking-tight">{title}</div>
      <div
        className={classNames(
          "mt-0.5 text-[11px] leading-snug",
          active ? "text-accent/80" : "text-ink-dim",
        )}
      >
        {subtitle}
      </div>
    </button>
  );
}
