"use client";

import { useState } from "react";

import type { DcaResult, Frequency } from "@/lib/backtest";
import type { FetchMode } from "@/lib/yahoo";
import { classNames } from "@/lib/format";

import { CompareChart } from "./CompareChart";
import { CompareTable } from "./CompareTable";
import { ResultPanel } from "./ResultPanel";

type PeriodChoice = "10y" | "ny" | "inception" | "custom";

interface PerTickerOutcome {
  ticker: string;
  ok: boolean;
  result?: DcaResult;
  error?: string;
}

const FREQ_LABEL: Record<Frequency, string> = {
  daily: "매일",
  weekly: "매주",
  biweekly: "2주마다",
  monthly: "매월",
  yearly: "매년",
};

const today = () => new Date().toISOString().slice(0, 10);
const tenYearsAgo = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 10);
  return d.toISOString().slice(0, 10);
};

export function BacktestForm() {
  const [tickersRaw, setTickersRaw] = useState("AAPL");
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice>("10y");
  const [years, setYears] = useState(10);
  const [start, setStart] = useState(tenYearsAgo());
  const [end, setEnd] = useState(today());
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [amount, setAmount] = useState(500);
  const [fractional, setFractional] = useState(true);

  const [loading, setLoading] = useState(false);
  const [outcomes, setOutcomes] = useState<PerTickerOutcome[] | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function buildPayload() {
    const tickers = tickersRaw
      .split(",")
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);

    let mode: FetchMode = "years";
    if (periodChoice === "10y") mode = "years";
    else if (periodChoice === "ny") mode = "years";
    else if (periodChoice === "inception") mode = "inception";
    else mode = "custom";

    return {
      tickers,
      mode,
      years: periodChoice === "10y" ? 10 : periodChoice === "ny" ? years : undefined,
      start: mode === "custom" ? start : undefined,
      end: mode === "custom" ? end : undefined,
      frequency,
      amount,
      fractional,
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setOutcomes(null);

    const payload = buildPayload();
    if (payload.tickers.length === 0) {
      setSubmitError("티커를 한 개 이상 입력해주세요.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      setOutcomes(data.results as PerTickerOutcome[]);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const successResults = (outcomes ?? [])
    .filter((o): o is PerTickerOutcome & { result: DcaResult } => o.ok && !!o.result)
    .map((o) => o.result);

  const failed = (outcomes ?? []).filter((o) => !o.ok);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <form
          onSubmit={onSubmit}
          className="rounded-xl border border-border bg-bg-panel p-5 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]"
        >
          <h2 className="mb-4 text-sm font-semibold tracking-wide text-ink-muted">
            백테스트 설정
          </h2>

          <Field label="티커 (쉼표로 구분, 최대 10개)">
            <input
              type="text"
              value={tickersRaw}
              onChange={(e) => setTickersRaw(e.target.value)}
              placeholder="AAPL, MSFT, SPY"
              className={inputCls}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>

          <Field label="기간">
            <div className="grid grid-cols-2 gap-2">
              <Choice
                active={periodChoice === "10y"}
                onClick={() => setPeriodChoice("10y")}
              >
                최근 10년
              </Choice>
              <Choice
                active={periodChoice === "ny"}
                onClick={() => setPeriodChoice("ny")}
              >
                최근 N년
              </Choice>
              <Choice
                active={periodChoice === "inception"}
                onClick={() => setPeriodChoice("inception")}
              >
                상장일부터
              </Choice>
              <Choice
                active={periodChoice === "custom"}
                onClick={() => setPeriodChoice("custom")}
              >
                커스텀
              </Choice>
            </div>
            {periodChoice === "ny" ? (
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={40}
                  value={years}
                  onChange={(e) => setYears(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="num w-10 text-right text-sm">{years}y</span>
              </div>
            ) : null}
            {periodChoice === "custom" ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className={inputCls}
                />
                <input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className={inputCls}
                />
              </div>
            ) : null}
          </Field>

          <Field label="매수 주기">
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(FREQ_LABEL) as Frequency[]).map((f) => (
                <Choice
                  key={f}
                  active={frequency === f}
                  onClick={() => setFrequency(f)}
                >
                  {FREQ_LABEL[f]}
                </Choice>
              ))}
            </div>
          </Field>

          <Field label="매수 금액 (USD)">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                $
              </span>
              <input
                type="number"
                min={1}
                step={50}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className={classNames(inputCls, "pl-6")}
              />
            </div>
          </Field>

          <label className="mt-1 flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={fractional}
              onChange={(e) => setFractional(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-bg-subtle accent-accent"
            />
            분수 매수 허용 (해제 시 정수 주식만, 잔액 이월)
          </label>

          <button
            type="submit"
            disabled={loading}
            className="mt-5 inline-flex w-full items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "실행 중…" : "백테스트 실행"}
          </button>

          {submitError ? (
            <div className="mt-3 rounded-md border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
              {submitError}
            </div>
          ) : null}
        </form>

        <p className="mt-3 px-1 text-[11px] leading-relaxed text-ink-dim">
          데이터: Yahoo Finance (배당·분할 조정). 세금/수수료 미반영.
          IRR은 이분법으로 계산하며 수렴하지 않으면 “—”로 표시됩니다.
        </p>
      </aside>

      <section className="min-w-0 space-y-6">
        {!outcomes && !loading ? (
          <Empty />
        ) : null}
        {loading ? <LoadingPlaceholder /> : null}

        {failed.length > 0 ? (
          <div className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-4 py-3 text-sm">
            <div className="font-semibold text-accent-red">일부 티커 실행 실패</div>
            <ul className="mt-1 list-disc pl-5 text-xs text-accent-red/90">
              {failed.map((f) => (
                <li key={f.ticker}>
                  <span className="font-mono">{f.ticker}</span>: {f.error}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {successResults.length > 1 ? (
          <div className="rounded-xl border border-border bg-bg-panel p-5">
            <div className="mb-3 text-sm font-semibold tracking-wide text-ink-muted">
              티커 비교 — 평가액 / 누적 투자금 (1.0 = 본전)
            </div>
            <CompareChart results={successResults} />
            <div className="mt-4">
              <CompareTable results={successResults} />
            </div>
          </div>
        ) : null}

        {successResults.map((r) => (
          <ResultPanel key={r.ticker} result={r} />
        ))}
      </section>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-ink placeholder:text-ink-dim outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "rounded-md border px-2.5 py-1.5 text-xs font-medium transition",
        active
          ? "border-accent bg-accent/15 text-accent"
          : "border-border bg-bg-subtle text-ink-muted hover:border-border-strong hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Empty() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-bg-panel/50 px-6 py-16 text-center">
      <div className="text-base font-medium">시작할 준비 완료</div>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
        좌측에 티커, 기간, 매수 주기, 금액을 입력하고
        <span className="mx-1 text-accent">백테스트 실행</span>
        을 누르세요. 여러 티커를 쉼표로 입력하면 비교 차트가 함께 나옵니다.
      </p>
    </div>
  );
}

function LoadingPlaceholder() {
  return (
    <div className="space-y-3">
      <div className="h-32 animate-pulse rounded-xl border border-border bg-bg-panel/60" />
      <div className="h-64 animate-pulse rounded-xl border border-border bg-bg-panel/60" />
      <div className="h-48 animate-pulse rounded-xl border border-border bg-bg-panel/60" />
    </div>
  );
}
