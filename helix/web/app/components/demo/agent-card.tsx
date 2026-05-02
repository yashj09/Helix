"use client";

import { motion } from "motion/react";
import type { AgentCard as AgentCardT } from "./types";

export function AgentCard({
  card,
  tone = "default",
  highlighted = false,
}: {
  card: AgentCardT;
  tone?: "default" | "parent-a" | "parent-b" | "child";
  highlighted?: boolean;
}) {
  const accent =
    tone === "parent-a"
      ? "border-l-[var(--color-accent)]"
      : tone === "parent-b"
      ? "border-l-[var(--color-ink)]"
      : tone === "child"
      ? "border-l-[var(--color-accent)] bg-[var(--color-accent-soft)]"
      : "border-l-[var(--color-rule)]";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-xl border border-[var(--color-rule)] border-l-[3px] ${accent} bg-[var(--color-surface)] p-5 ${
        highlighted ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-surface)]" : ""
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
            token #{card.tokenId}
          </div>
          <h3 className="mt-1 font-display text-2xl">{card.label}.helix.eth</h3>
        </div>
        <EarningsBadge amount={card.earned} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {card.skills.map((s) => (
          <span
            key={s}
            className="inline-flex items-center rounded-full border border-[var(--color-rule)] bg-[var(--color-paper)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-ink-soft)]"
          >
            {s}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-[var(--color-ink-mute)]">
        {card.mintExplorer && (
          <a className="link-hairline hover:text-[var(--color-ink)]" href={card.mintExplorer} target="_blank" rel="noreferrer">
            mint tx ↗
          </a>
        )}
      </div>
    </motion.div>
  );
}

function EarningsBadge({ amount }: { amount: number }) {
  if (amount <= 0) {
    return (
      <div className="font-mono text-[10px] text-[var(--color-ink-mute)]">0.000000 0G</div>
    );
  }
  return (
    <motion.div
      key={amount} // re-animate whenever the number changes
      initial={{ scale: 0.92, opacity: 0.7 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 20 }}
      className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 font-mono text-[11px] font-medium text-[var(--color-accent)]"
    >
      +{amount.toFixed(6)} 0G
    </motion.div>
  );
}
