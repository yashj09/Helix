"use client";

import { motion } from "motion/react";
import type { RoyaltyEntry } from "./types";

const roleLabels: Record<RoyaltyEntry["role"], string> = {
  operator: "child operator",
  "parent-a": "parent A creator",
  "parent-b": "parent B creator",
  protocol: "protocol",
  dust: "treasury (dust)",
};

const rolePercents: Record<RoyaltyEntry["role"], string> = {
  operator: "55%",
  "parent-a": "15%",
  "parent-b": "15%",
  protocol: "5%",
  dust: "10%",
};

export function RoyaltySplit({ entries }: { entries: RoyaltyEntry[] }) {
  if (entries.length === 0) return null;
  const total = entries.reduce((s, e) => s + e.amount, 0);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-5"
    >
      <div className="flex items-baseline justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
            Royalty cascade
          </p>
          <p className="mt-1 font-display text-xl">
            {total.toFixed(6)} 0G split across {entries.length} recipients
          </p>
        </div>
        <span className="font-mono text-[10px] text-[var(--color-accent)]">on-chain</span>
      </div>
      <div className="mt-4 divide-y divide-[var(--color-rule)]">
        {entries.map((e, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.06 * i, duration: 0.3 }}
            className="flex items-center justify-between py-2.5 text-sm"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px] text-[var(--color-ink-mute)] w-9">
                {rolePercents[e.role]}
              </span>
              <span className="text-[var(--color-ink)]">{roleLabels[e.role]}</span>
              <span className="font-mono text-[11px] text-[var(--color-ink-mute)]">
                {e.recipientLabel}
              </span>
            </div>
            <span className="font-mono text-sm font-medium text-[var(--color-accent)]">
              +{e.amount.toFixed(6)}
            </span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
