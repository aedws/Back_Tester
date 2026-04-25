import { classNames } from "@/lib/format";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={classNames(
        "rounded-xl border border-border bg-bg-panel shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  right,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div>
        <div className="text-[15px] font-semibold tracking-tight">{title}</div>
        {subtitle ? (
          <div className="mt-0.5 text-xs text-ink-muted">{subtitle}</div>
        ) : null}
      </div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={classNames("p-5", className)}>{children}</div>;
}
