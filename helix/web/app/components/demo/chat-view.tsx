"use client";

import { motion, AnimatePresence } from "motion/react";
import type { ChatMessage } from "./types";

export function ChatView({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-rule)] bg-[var(--color-paper)] p-4 text-sm text-[var(--color-ink-mute)]">
        No messages yet.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence initial={false}>
        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className={`flex ${m.from === "alice" ? "justify-start" : "justify-end"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                m.from === "alice"
                  ? "bg-[var(--color-paper)] border border-[var(--color-rule)] text-[var(--color-ink)]"
                  : "bg-[var(--color-ink)] text-[var(--color-paper)]"
              }`}
            >
              <div
                className={`mb-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${
                  m.from === "alice" ? "text-[var(--color-ink-mute)]" : "text-white/60"
                }`}
              >
                {m.from}
                {m.deliveredAt && (
                  <span className="ml-2 normal-case tracking-normal">
                    · delivered via AXL
                  </span>
                )}
              </div>
              {m.text}
              {m.resolvedPubkey && (
                <div
                  className={`mt-1.5 font-mono text-[10px] ${
                    m.from === "alice" ? "text-[var(--color-ink-mute)]" : "text-white/50"
                  }`}
                >
                  resolved pubkey · {m.resolvedPubkey.slice(0, 12)}…
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
