"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { EarningsEvent, EarningsRegion, EarningsResponse } from "@/lib/earnings";

interface EarningsApiResponse extends EarningsResponse {
  windowDays: number;
  backDays: number;
  error?: string;
}

const REFRESH_FOREGROUND_MS = 30 * 60 * 1000; // 30 min
const REFRESH_BACKGROUND_MS = 60 * 60 * 1000; // 60 min

function todayUtcKey(): string {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
}

function fmtMcap(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "-";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return v.toLocaleString();
}

function fmtNum(v: number | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return v.toFixed(digits);
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${wd})`;
}

function regionLabel(r: EarningsRegion): string {
  if (r === "US") return "🇺🇸";
  if (r === "KR") return "🇰🇷";
  return "🌏";
}

function timingLabel(t: EarningsEvent["timing"]): string {
  if (t === "BMO") return "장 시작 전";
  if (t === "AMC") return "장 마감 후";
  if (t === "TAS") return "장중";
  if (t === "TNS") return "시간 미정";
  return "시간 미정";
}

function timingClasses(t: EarningsEvent["timing"]): string {
  if (t === "BMO") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (t === "AMC") return "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
  if (t === "TAS") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  return "bg-bg-subtle text-ink-dim border-border";
}

export function EarningsBar() {
  const [data, setData] = useState<EarningsApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await fetch("/api/earnings?days=7", { cache: "no-store" });
        const json = (await res.json()) as EarningsApiResponse;
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? `HTTP ${res.status}`);
        } else {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        inFlight.current = false;
        if (!cancelled) {
          const interval = document.hidden
            ? REFRESH_BACKGROUND_MS
            : REFRESH_FOREGROUND_MS;
          timerId = setTimeout(load, interval);
        }
      }
    }

    function onVis() {
      if (!document.hidden) load();
    }

    load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const todayKey = todayUtcKey();
  const events = data?.events ?? [];
  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => a.startUtcMs - b.startUtcMs);
  }, [events]);

  const todayEvents = useMemo(
    () => sortedEvents.filter((e) => e.date === todayKey),
    [sortedEvents, todayKey],
  );
  const upcomingEvents = useMemo(
    () => sortedEvents.filter((e) => e.date >= todayKey),
    [sortedEvents, todayKey],
  );

  const todayTopSymbols = useMemo(() => {
    return [...todayEvents]
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .slice(0, 4)
      .map((e) => e.symbol);
  }, [todayEvents]);

  if (error && !data) {
    return (
      <div className="border-b border-border bg-bg-subtle px-3 py-1 text-[11px] text-ink-dim">
        실적 캘린더 불러오기 실패: {error}
      </div>
    );
  }

  const hasUpcoming = upcomingEvents.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-3 border-b border-border bg-bg-subtle/40 px-3 py-1.5 text-left text-[11px] text-ink-muted transition hover:bg-bg-subtle"
      >
        <span className="font-medium text-ink-dim">📅 실적</span>
        {todayEvents.length > 0 ? (
          <span className="flex items-center gap-1 rounded-full border border-accent-red/40 bg-accent-red/10 px-2 py-0.5 text-[10px] font-semibold text-accent-red">
            오늘 {todayEvents.length}건
            {todayTopSymbols.length > 0 ? (
              <span className="ml-1 hidden font-normal text-ink-muted sm:inline">
                · {todayTopSymbols.join(" · ")}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-ink-dim">오늘 발표 없음</span>
        )}
        <span className="hidden text-ink-dim sm:inline">·</span>
        <span className="text-ink-dim">
          7일 <span className="font-semibold text-ink-muted">{upcomingEvents.length}</span>건
        </span>
        <span className="ml-auto rounded-md border border-border bg-bg px-2 py-0.5 text-[10px] text-ink-muted transition group-hover:border-border-strong group-hover:text-ink">
          자세히 ▾
        </span>
      </button>

      {open ? (
        <EarningsModal
          events={sortedEvents}
          todayKey={todayKey}
          totalCount={hasUpcoming ? upcomingEvents.length : 0}
          fetchedAt={data?.fetchedAt ?? null}
          cached={data?.cached ?? false}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function EarningsModal({
  events,
  todayKey,
  totalCount,
  fetchedAt,
  cached,
  onClose,
}: {
  events: EarningsEvent[];
  todayKey: string;
  totalCount: number;
  fetchedAt: number | null;
  cached: boolean;
  onClose: () => void;
}) {
  const [region, setRegion] = useState<"ALL" | EarningsRegion>("ALL");
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return events.filter((e) => {
      if (region !== "ALL" && e.region !== region) return false;
      if (e.date < todayKey) return false;
      if (q.length > 0) {
        if (!e.symbol.toUpperCase().includes(q) &&
            !(e.name?.toUpperCase().includes(q) ?? false)) {
          return false;
        }
      }
      return true;
    });
  }, [events, region, query, todayKey]);

  const grouped = useMemo(() => {
    const map = new Map<string, EarningsEvent[]>();
    for (const e of filtered) {
      const arr = map.get(e.date) ?? [];
      arr.push(e);
      map.set(e.date, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const counts = useMemo(() => {
    let us = 0;
    let kr = 0;
    let other = 0;
    for (const e of events) {
      if (e.date < todayKey) continue;
      if (e.region === "US") us++;
      else if (e.region === "KR") kr++;
      else other++;
    }
    return { us, kr, other, total: us + kr + other };
  }, [events, todayKey]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-ink">실적 발표 일정 (다음 7일)</h2>
            <div className="mt-0.5 text-[11px] text-ink-dim">
              총 {totalCount}건 · 미장 {counts.us} · 국장 {counts.kr} · 기타 {counts.other}
              {fetchedAt ? (
                <>
                  <span className="px-1">·</span>
                  업데이트 {new Date(fetchedAt).toLocaleString()}
                  {cached ? <span className="ml-1 text-ink-dim">(캐시)</span> : null}
                </>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-bg-subtle px-2 py-1 text-xs text-ink-muted transition hover:border-border-strong hover:text-ink"
          >
            닫기 ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <div className="flex rounded-md border border-border bg-bg-subtle p-0.5 text-[11px]">
            {(["ALL", "US", "KR", "OTHER"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRegion(r)}
                className={`rounded px-2.5 py-0.5 transition ${
                  region === r
                    ? "bg-bg text-ink shadow"
                    : "text-ink-dim hover:text-ink-muted"
                }`}
              >
                {r === "ALL"
                  ? "전체"
                  : r === "US"
                  ? "🇺🇸 미장"
                  : r === "KR"
                  ? "🇰🇷 국장"
                  : "🌏 기타"}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="심볼 또는 회사명 검색"
            className="ml-auto w-full max-w-[260px] rounded-md border border-border bg-bg px-2 py-1 text-[12px] text-ink placeholder:text-ink-dim focus:border-border-strong focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-auto px-4 py-3">
          {grouped.length === 0 ? (
            <div className="rounded-md border border-border bg-bg-subtle px-3 py-8 text-center text-sm text-ink-muted">
              조건에 맞는 발표 일정이 없습니다.
            </div>
          ) : (
            grouped.map(([date, items]) => (
              <DayGroup key={date} date={date} todayKey={todayKey} items={items} />
            ))
          )}
        </div>

        <div className="border-t border-border bg-bg-subtle/60 px-4 py-2 text-[10px] text-ink-dim">
          데이터: Yahoo Finance Calendar (비공식 API). 시각은 회사 표기 시간이며 종목 거래소 현지 시간대 기준입니다.
        </div>
      </div>
    </div>
  );
}

function DayGroup({
  date,
  todayKey,
  items,
}: {
  date: string;
  todayKey: string;
  items: EarningsEvent[];
}) {
  const isToday = date === todayKey;
  return (
    <div className="mb-4">
      <div
        className={`mb-2 flex items-center gap-2 text-xs font-semibold ${
          isToday ? "text-accent-red" : "text-ink-muted"
        }`}
      >
        <span>{fmtDate(date)}</span>
        {isToday ? (
          <span className="rounded-full border border-accent-red/40 bg-accent-red/10 px-2 py-0.5 text-[10px]">
            오늘
          </span>
        ) : null}
        <span className="text-[10px] font-normal text-ink-dim">{items.length}건</span>
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full border-collapse text-[12px]">
          <thead className="bg-bg-subtle text-[10px] uppercase tracking-wide text-ink-dim">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">종목</th>
              <th className="px-2 py-1.5 text-left font-medium">시간</th>
              <th className="px-2 py-1.5 text-right font-medium">EPS 추정</th>
              <th className="px-2 py-1.5 text-right font-medium">EPS 실제</th>
              <th className="px-2 py-1.5 text-right font-medium">서프 %</th>
              <th className="px-2 py-1.5 text-right font-medium">시총</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr
                key={`${e.symbol}-${e.startUtcMs}`}
                className={`border-t border-border ${isToday ? "bg-accent-red/[0.04]" : ""}`}
              >
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span aria-label={e.region} title={e.region}>
                      {regionLabel(e.region)}
                    </span>
                    <span className="font-mono font-semibold text-ink">{e.symbol}</span>
                    <span className="truncate text-ink-dim" title={e.name ?? undefined}>
                      {e.name ?? ""}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <span
                    className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] ${timingClasses(e.timing)}`}
                  >
                    {timingLabel(e.timing)}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-ink-muted">
                  {fmtNum(e.epsEstimate)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-ink-muted">
                  {fmtNum(e.epsActual)}
                </td>
                <td
                  className={`px-2 py-1.5 text-right font-mono ${
                    e.surprisePct == null
                      ? "text-ink-dim"
                      : e.surprisePct >= 0
                      ? "text-accent-green"
                      : "text-accent-red"
                  }`}
                >
                  {e.surprisePct == null
                    ? "-"
                    : `${e.surprisePct >= 0 ? "+" : ""}${e.surprisePct.toFixed(1)}`}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-ink-muted">
                  {fmtMcap(e.marketCap)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
