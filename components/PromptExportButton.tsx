"use client";

import { useEffect, useState } from "react";

import type { Frequency } from "@/lib/backtest";
import type { PerTickerOutcome } from "@/lib/backtestApi";
import { buildBacktestPrompt } from "@/lib/promptExport";

export interface PromptExportSettings {
  frequency: Frequency;
  unitMode: "amount" | "shares";
  amount?: number;
  shares?: number;
  fractional?: boolean;
  fractionalShares?: boolean;
}

/**
 * "AI 분석용 프롬프트 복사" — opens a modal with a pre-formatted Korean
 * Markdown summary of the backtest result. The user can copy it directly
 * to clipboard and paste into ChatGPT / Claude / Gemini for analysis.
 *
 * Strictly client-side: no LLM calls happen on our servers. We only build
 * a deterministic Markdown string from data the page already has.
 */
export function PromptExportButton({
  outcome,
  benchmark,
  benchmarkSymbol,
  settings,
}: {
  outcome: PerTickerOutcome;
  benchmark?: PerTickerOutcome | null;
  benchmarkSymbol?: string | null;
  settings: PromptExportSettings;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  function openModal() {
    const md = buildBacktestPrompt({
      outcome,
      benchmark: benchmark ?? null,
      benchmarkSymbol: benchmarkSymbol ?? null,
      settings,
    });
    setText(md);
    setCopied(false);
    setOpen(true);
  }

  async function copyToClipboard() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Legacy fallback for older browsers / non-secure contexts.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  // Lock body scroll while modal is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ESC closes the modal.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-subtle px-2.5 py-1.5 text-[11px] font-medium text-ink-muted transition hover:border-accent hover:text-accent"
        title="결과를 한국어 Markdown 텍스트로 정리해서 ChatGPT/Claude/Gemini 등에 붙여넣을 수 있게 만듭니다."
      >
        AI 프롬프트 복사
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="AI 분석용 프롬프트"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-bg-panel shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
              <div>
                <div className="text-sm font-semibold">
                  AI 분석용 프롬프트 — {outcome.ticker}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
                  아래 텍스트를 복사하여 ChatGPT / Claude / Gemini 등 원하는
                  LLM에 그대로 붙여넣으면 자연어 해석을 받을 수 있습니다. 우리
                  쪽에서는 어떤 LLM도 호출하지 않습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-mr-1 rounded-md px-2 py-1 text-ink-muted hover:bg-bg-subtle hover:text-ink"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none border-0 bg-bg p-5 font-mono text-[12px] leading-relaxed text-ink outline-none"
            />

            <div className="flex items-center justify-between gap-3 border-t border-border bg-bg-panel px-5 py-3">
              <div className="text-[11px] text-ink-dim">
                {text.length.toLocaleString()}자 · 텍스트 직접 편집 후 복사 가능
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-border bg-bg-subtle px-3 py-1.5 text-xs text-ink-muted hover:border-border-strong hover:text-ink"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={copyToClipboard}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    copied
                      ? "bg-accent-green text-bg"
                      : "bg-accent text-bg hover:brightness-110"
                  }`}
                >
                  {copied ? "복사됨 ✓" : "클립보드에 복사"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
