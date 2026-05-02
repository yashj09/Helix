"use client";

export function StepPanel({
  n,
  title,
  description,
  state,
  children,
}: {
  n: number;
  title: string;
  description: string;
  state: "idle" | "active" | "running" | "done";
  children: React.ReactNode;
}) {
  const tone =
    state === "idle"
      ? "opacity-50"
      : state === "running"
      ? "opacity-100"
      : state === "done"
      ? "opacity-80"
      : "opacity-100";
  const dotColor =
    state === "done" ? "bg-[var(--color-accent)]" : state === "running" ? "bg-[var(--color-ink)]" : "bg-[var(--color-rule)]";
  return (
    <div className={`transition-opacity duration-500 ${tone}`}>
      <div className="flex items-start gap-4">
        <div className="mt-1.5 flex flex-col items-center">
          <div className={`h-2 w-2 rounded-full ${dotColor}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
              Step {n.toString().padStart(2, "0")}
            </span>
            {state === "running" && (
              <span className="font-mono text-[11px] text-[var(--color-ink-soft)] animate-pulse">
                working...
              </span>
            )}
            {state === "done" && (
              <span className="font-mono text-[11px] text-[var(--color-accent)]">done</span>
            )}
          </div>
          <h3 className="mt-2 font-display text-2xl">{title}</h3>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{description}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
