import { classNames } from "@/lib/format";

export function Kpi({
  label,
  value,
  delta,
  tone = "default",
  hint,
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "default" | "good" | "bad" | "muted";
  hint?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-accent-green"
      : tone === "bad"
      ? "text-accent-red"
      : tone === "muted"
      ? "text-ink-muted"
      : "text-ink";

  return (
    <div className="rounded-lg border border-border bg-bg-subtle p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className={classNames("mt-1.5 num text-xl font-semibold", toneClass)}>
        {value}
      </div>
      {delta ? (
        <div
          className={classNames(
            "mt-1 num text-xs",
            tone === "good"
              ? "text-accent-green"
              : tone === "bad"
              ? "text-accent-red"
              : "text-ink-muted",
          )}
        >
          {delta}
        </div>
      ) : null}
      {hint ? (
        <div className="mt-1 text-[11px] text-ink-dim">{hint}</div>
      ) : null}
    </div>
  );
}
