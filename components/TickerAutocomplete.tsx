"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { classNames } from "@/lib/format";
import type { SearchHit } from "@/lib/searchApi";

interface BaseProps {
  value: string;
  onChange: (next: string) => void;
  /**
   * In multi mode, the input value is a comma-separated list. The component
   * isolates the *active token* (after the last comma) for searching, and
   * inserts the picked symbol as a new token while preserving the others.
   */
  mode?: "single" | "multi";
  placeholder?: string;
  className?: string;
  /** Called when the user explicitly commits a selection (Enter / pick). */
  onSubmit?: (value: string) => void;
  /** Called when a search hit is committed, with the picked symbol. */
  onPickSymbol?: (symbol: string) => void;
  /** Disable input. */
  disabled?: boolean;
  inputClassName?: string;
  inputId?: string;
  /** Yahoo region/lang hints (auto-detected from token suffix when missing). */
  region?: string;
  lang?: string;
}

const DEBOUNCE_MS = 220;
const MIN_CHARS = 1;

// Public, lenient regex; we just want to skip clearly empty/garbage tokens.
const TOKEN_RE = /[A-Za-z0-9.\-_]+$/;

export function TickerAutocomplete({
  value,
  onChange,
  mode = "single",
  placeholder,
  className,
  onSubmit,
  onPickSymbol,
  disabled,
  inputClassName,
  inputId,
  region,
  lang,
}: BaseProps) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reqIdRef = useRef(0);

  // The "active token" is whatever the user is currently typing.
  const activeToken = useMemo(() => extractActiveToken(value, mode), [value, mode]);
  const showableQuery = activeToken.replace(/^\.+/, "").trim();

  // Debounced search.
  useEffect(() => {
    if (!isOpen) return;
    if (showableQuery.length < MIN_CHARS) {
      setHits([]);
      setLoading(false);
      return;
    }
    const myReq = ++reqIdRef.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: showableQuery, limit: "10" });
        if (region) params.set("region", region);
        if (lang) params.set("lang", lang);
        const res = await fetch(`/api/search?${params.toString()}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as { hits?: SearchHit[] };
        if (myReq !== reqIdRef.current) return;
        setHits(Array.isArray(json.hits) ? json.hits : []);
        setActiveIdx(0);
      } catch {
        if (myReq !== reqIdRef.current) return;
        setHits([]);
      } finally {
        if (myReq === reqIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [showableQuery, isOpen, region, lang]);

  // Outside-click closes the dropdown.
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const commit = useCallback(
    (symbol: string) => {
      const sym = symbol.toUpperCase();
      let nextValue: string;
      if (mode === "multi") {
        nextValue = replaceActiveToken(value, sym, /* trailingSeparator */ true);
      } else {
        nextValue = sym;
      }
      onChange(nextValue);
      onPickSymbol?.(sym);
      // In multi mode the user is still composing a list, so don't trigger
      // form-style submission. Single mode is the "pick this and go" case.
      if (mode === "single") onSubmit?.(nextValue);
      setOpen(false);
      setHits([]);
    },
    [mode, onChange, onPickSymbol, onSubmit, value],
  );

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(hits.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter") {
      if (isOpen && hits[activeIdx]) {
        e.preventDefault();
        commit(hits[activeIdx].symbol);
        return;
      }
      if (mode === "single") {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed) onSubmit?.(trimmed.toUpperCase());
        setOpen(false);
        return;
      }
      // multi: let Enter fall through (form submit) only when no dropdown.
      if (!isOpen) {
        // Allow form submit
        return;
      }
    }
    if (e.key === "," && mode === "multi") {
      // User is moving on to the next token; if a hit is highlighted, take it.
      if (isOpen && hits[activeIdx]) {
        e.preventDefault();
        commit(hits[activeIdx].symbol);
      }
    }
  }

  function handleFormishSubmit(e: FormEvent) {
    // No-op shell so callers can wrap with a <form> if desired; we use
    // onKeyDown for Enter handling instead.
    e.preventDefault();
  }

  return (
    <div ref={containerRef} className={classNames("relative", className)} onSubmit={handleFormishSubmit}>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (showableQuery.length >= MIN_CHARS) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        aria-controls={`${inputId ?? "ticker-ac"}-list`}
        className={inputClassName}
      />
      {isOpen && showableQuery.length >= MIN_CHARS ? (
        <div
          id={`${inputId ?? "ticker-ac"}-list`}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-bg-panel shadow-2xl"
        >
          {loading && hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-dim">검색 중…</div>
          ) : null}
          {!loading && hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-dim">
              일치하는 종목이 없습니다.
            </div>
          ) : null}
          {hits.map((h, i) => (
            <button
              key={`${h.symbol}-${i}`}
              type="button"
              role="option"
              aria-selected={i === activeIdx}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={(e) => {
                // Use mousedown so the click happens before the input loses
                // focus and triggers the outside-click close.
                e.preventDefault();
                commit(h.symbol);
              }}
              className={classNames(
                "flex w-full items-baseline gap-2 px-3 py-2 text-left text-xs transition",
                i === activeIdx
                  ? "bg-accent/15 text-ink"
                  : "text-ink-muted hover:bg-bg-subtle",
              )}
            >
              <span className="num min-w-[80px] font-mono text-sm font-semibold tabular-nums text-ink">
                {h.symbol}
              </span>
              <span className="flex-1 truncate">
                {h.shortname || h.longname || ""}
              </span>
              <span className="ml-auto text-[10px] text-ink-dim">
                {h.exchDisp || h.exchange || ""}
                {h.typeDisp ? ` · ${h.typeDisp}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────── helpers ─────────────────────── */

function extractActiveToken(value: string, mode: "single" | "multi"): string {
  if (mode === "single") return value.trim();
  // Take whatever follows the last comma — that's the token the cursor is on.
  const idx = value.lastIndexOf(",");
  const tail = idx === -1 ? value : value.slice(idx + 1);
  // Trim leading whitespace; preserve token chars only.
  const m = tail.match(TOKEN_RE);
  return m ? m[0] : tail.trim();
}

function replaceActiveToken(
  value: string,
  symbol: string,
  trailingSeparator: boolean,
): string {
  const idx = value.lastIndexOf(",");
  const head = idx === -1 ? "" : value.slice(0, idx + 1);
  const sep = trailingSeparator ? ", " : "";
  // Drop leading whitespace from the original tail before replacing.
  const next = `${head}${head ? " " : ""}${symbol}${sep}`;
  // Collapse stray double-commas/whitespace artifacts.
  return next.replace(/,\s*,/g, ", ").replace(/\s+/g, " ").replace(/^,\s*/, "");
}
