"use client";

import { useState } from "react";

import type { DcaResult, Frequency } from "@/lib/backtest";
import type { BacktestApiResponse, PerTickerOutcome } from "@/lib/backtestApi";
import type { FetchMode } from "@/lib/yahoo";
import { classNames } from "@/lib/format";

import { CompareChart } from "./CompareChart";
import { CompareTable } from "./CompareTable";
import { ResultPanel } from "./ResultPanel";
import { TickerAutocomplete } from "./TickerAutocomplete";

type PeriodChoice = "10y" | "ny" | "inception" | "custom";

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
  const [benchmark, setBenchmark] = useState<PerTickerOutcome | null>(null);
  const [benchmarkSymbol, setBenchmarkSymbol] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Per-ticker user override of auto-detected covered-call flag.
   *  undefined = "use auto", true/false = forced. */
  const [coveredCallOverrides, setCoveredCallOverrides] = useState<
    Record<string, boolean>
  >({});
  /** Tickers currently being re-fetched after a user toggled the override. */
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());

  function buildPayload(overrides?: Record<string, boolean>) {
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
      coveredCallOverrides: overrides ?? coveredCallOverrides,
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setOutcomes(null);
    setBenchmark(null);
    setBenchmarkSymbol(null);
    setCoveredCallOverrides({});

    const payload = buildPayload({});
    if (payload.tickers.length === 0) {
      setSubmitError("티커를 한 개 이상 입력해주세요.");
      return;
    }
    if (payload.tickers.length > 10) {
      setSubmitError("티커는 최대 10개까지 입력할 수 있어요.");
      return;
    }
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      setSubmitError("매수 금액은 0보다 큰 숫자여야 합니다.");
      return;
    }
    if (payload.mode === "custom" && payload.start && payload.end && payload.start >= payload.end) {
      setSubmitError("시작일이 종료일보다 빨라야 합니다.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as Partial<BacktestApiResponse> & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      setOutcomes((data.results ?? []) as PerTickerOutcome[]);
      setBenchmark(data.benchmark ?? null);
      setBenchmarkSymbol(data.benchmarkSymbol ?? null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const successOutcomes = (outcomes ?? []).filter(
    (o): o is PerTickerOutcome & { result: DcaResult } => o.ok && !!o.result,
  );
  const successResults = successOutcomes.map((o) => o.result);

  const failed = (outcomes ?? []).filter((o) => !o.ok);
  const benchmarkResult: DcaResult | null =
    benchmark && benchmark.ok && benchmark.result ? benchmark.result : null;
  const benchmarkErr =
    benchmark && !benchmark.ok ? benchmark.error ?? null : null;

  async function refetchTicker(ticker: string, applied: boolean) {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;

    const nextOverrides = { ...coveredCallOverrides, [sym]: applied };
    setCoveredCallOverrides(nextOverrides);
    setRefreshing((prev) => new Set(prev).add(sym));

    const fullPayload = buildPayload(nextOverrides);
    // Only re-run for this single ticker; benchmark is unchanged.
    const singlePayload = { ...fullPayload, tickers: [sym], benchmark: "" };
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(singlePayload),
      });
      const data = (await res.json()) as Partial<BacktestApiResponse> & {
        error?: string;
      };
      if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
      const updated = data.results?.[0];
      if (!updated) return;
      setOutcomes((prev) =>
        (prev ?? []).map((o) => (o.ticker === sym ? updated : o)),
      );
    } catch (err) {
      // Revert override on failure so the UI stays consistent with server state.
      setCoveredCallOverrides((prev) => {
        const c = { ...prev };
        delete c[sym];
        return c;
      });
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing((prev) => {
        const c = new Set(prev);
        c.delete(sym);
        return c;
      });
    }
  }

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

          <Field
            label="티커 (쉼표로 구분, 최대 10개)"
            hint="미국 종목은 그대로(예: AAPL, VOO, QQQ). 한국은 .KS(코스피) / .KQ(코스닥) 접미사 — 예: 005930.KS(삼성전자), 069500.KS(KODEX 200)."
          >
            <TickerAutocomplete
              mode="multi"
              value={tickersRaw}
              onChange={setTickersRaw}
              placeholder="AAPL, MSFT, SPY  또는  005930.KS, 069500.KS"
              inputClassName={`${inputCls} font-mono uppercase`}
              inputId="bt-tickers"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                { label: "AAPL", v: "AAPL" },
                { label: "VOO", v: "VOO" },
                { label: "QQQ", v: "QQQ" },
                { label: "삼성전자", v: "005930.KS" },
                { label: "KODEX 200", v: "069500.KS" },
                { label: "TIGER 美나스닥100", v: "133690.KS" },
              ].map((p) => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => {
                    const list = tickersRaw
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean);
                    if (list.includes(p.v.toUpperCase())) {
                      setTickersRaw(
                        list
                          .filter((t) => t.toUpperCase() !== p.v.toUpperCase())
                          .join(", "),
                      );
                    } else {
                      setTickersRaw([...list, p.v].join(", "));
                    }
                  }}
                  className={classNames(
                    "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                    tickersRaw
                      .split(",")
                      .map((t) => t.trim().toUpperCase())
                      .includes(p.v.toUpperCase())
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border bg-bg-subtle text-ink-muted hover:border-border-strong hover:text-ink",
                  )}
                  title={p.v}
                >
                  {p.label}
                </button>
              ))}
            </div>
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

          <Field
            label="매수 금액 (USD, 티커당)"
            hint="여러 티커 입력 시, 매 주기마다 각 티커에 동일하게 이 금액을 매수합니다."
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                $
              </span>
              <input
                type="number"
                min={1}
                step="any"
                inputMode="decimal"
                value={Number.isFinite(amount) ? amount : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") {
                    setAmount(NaN);
                    return;
                  }
                  const n = Number(v);
                  setAmount(Number.isFinite(n) ? n : NaN);
                }}
                className={classNames(inputCls, "pl-6")}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[100, 250, 500, 1000, 2000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(v)}
                  className={classNames(
                    "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                    amount === v
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border bg-bg-subtle text-ink-muted hover:border-border-strong hover:text-ink",
                  )}
                >
                  ${v.toLocaleString()}
                </button>
              ))}
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

          <MultiTickerHint
            tickerCount={tickersRaw
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean).length}
            amount={amount}
            frequency={frequency}
          />

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

        {benchmarkErr && successResults.length > 0 ? (
          <div className="rounded-md border border-accent-amber/40 bg-accent-amber/5 px-3 py-2 text-xs text-accent-amber">
            벤치마크({benchmarkSymbol ?? "VOO"}) 데이터를 불러오지 못했습니다: {benchmarkErr}
          </div>
        ) : null}

        {successOutcomes.map((o) => (
          <ResultPanel
            key={o.ticker}
            outcome={o}
            benchmark={
              // Don't compare a ticker against itself.
              benchmarkResult && benchmarkResult.ticker !== o.ticker
                ? benchmarkResult
                : null
            }
            benchmarkSymbol={benchmarkSymbol}
            refreshing={refreshing.has(o.ticker)}
            onToggleCoveredCall={(applied) => refetchTicker(o.ticker, applied)}
          />
        ))}
      </section>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-ink placeholder:text-ink-dim outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      {children}
      {hint ? (
        <div className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function MultiTickerHint({
  tickerCount,
  amount,
  frequency,
}: {
  tickerCount: number;
  amount: number;
  frequency: Frequency;
}) {
  if (tickerCount < 2 || !Number.isFinite(amount) || amount <= 0) return null;
  const total = amount * tickerCount;
  const perPeriod = `매 ${FREQ_LABEL[frequency]}`;
  return (
    <div className="mt-3 rounded-md border border-border bg-bg-subtle px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
      <span className="text-ink">{tickerCount}개 티커</span> × $
      {amount.toLocaleString()} ={" "}
      <span className="text-accent">${total.toLocaleString()}</span>
      <span className="text-ink-dim"> / {perPeriod}</span>
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
