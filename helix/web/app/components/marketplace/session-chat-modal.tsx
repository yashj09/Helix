"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

import { ChatView } from "@/app/components/demo/chat-view";
import { RoyaltySplit } from "@/app/components/demo/royalty-split";
import type { ChatMessage, RoyaltyEntry } from "@/app/components/demo/types";
import {
  startSession,
  sendGatedReply,
  royaltySplit,
  type ChatTurn,
} from "@/lib/session-actions";

const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_EXPLORER_BASE ?? "https://chainscan-galileo.0g.ai";
const DEFAULT_MESSAGES = 10;
const PRICE_PER_MESSAGE = 0.01;

export interface MarketplaceAgent {
  tokenId: number;
  label: string | null;
  dataHash: string | null;
  skills: string[];
  lineage: { parentA: number; parentB: number } | null;
}

/**
 * A self-contained rent + chat experience for any agent in the marketplace. Uses the same
 * session-rental + gated-reply plumbing as Step 5 of the 5-step demo, but with its own
 * local state — no reducer coupling, so it can live anywhere.
 */
export function SessionChatModal({
  agent,
  onClose,
}: {
  agent: MarketplaceAgent;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [renter, setRenter] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [authTx, setAuthTx] = useState<string | null>(null);
  const [rentTx, setRentTx] = useState<string | null>(null);
  const [royalties, setRoyalties] = useState<RoyaltyEntry[]>([]);

  const sessionActive = remaining !== null;
  const sessionExhausted = remaining === 0;
  const cost = (PRICE_PER_MESSAGE * DEFAULT_MESSAGES).toFixed(2);
  const displayLabel = agent.label
    ? `${agent.label}.helixx.eth`
    : `Token #${agent.tokenId}`;

  async function handleStart() {
    if (!agent.dataHash) {
      setError("Agent dataHash not available — can't generate replies.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await startSession(agent.tokenId, DEFAULT_MESSAGES);
      const amount = Number(r.amountPaid);
      const rows = royaltySplit(amount);
      // Map the numeric split into RoyaltyEntry shape the existing RoyaltySplit renderer wants.
      const entries: RoyaltyEntry[] = rows.map((row) => ({
        role: row.role,
        amount: row.amount,
        recipientLabel:
          row.role === "operator"
            ? displayLabel
            : row.role === "parent-a" && agent.lineage
            ? `#${agent.lineage.parentA}`
            : row.role === "parent-b" && agent.lineage
            ? `#${agent.lineage.parentB}`
            : row.role === "protocol"
            ? "protocol"
            : "treasury",
        recipientAddr:
          row.role === "operator"
            ? "(operator)"
            : row.role === "parent-a"
            ? "(parent A creator)"
            : row.role === "parent-b"
            ? "(parent B creator)"
            : row.role === "protocol"
            ? "(5%)"
            : "(10% dust)",
      }));
      setRoyalties(entries);
      setAuthTx(r.authTxHash);
      setRentTx(r.rentTxHash);
      setRenter(r.renter);
      setRemaining(r.messageCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!renter || !agent.dataHash) return;
    const text = input.trim();
    if (!text) return;
    const id = Math.random().toString(36).slice(2, 10);
    const self: ChatMessage = {
      id,
      from: "self",
      fromLabel: "you",
      text,
      at: Date.now(),
    };
    // Optimistic append so the user sees their own bubble immediately.
    const nextMessages = [...messages, self];
    setMessages(nextMessages);
    setInput("");
    try {
      // Build history from the peer's POV for /api/reply.
      const history: ChatTurn[] = nextMessages.map((m) => ({
        role: m.from === "peer" ? "assistant" : "user",
        content: m.text,
      }));
      const r = await sendGatedReply({
        dataHash: agent.dataHash,
        tokenId: agent.tokenId,
        renter,
        history,
        maxTokens: 120,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: id + "-reply",
          from: "peer",
          fromLabel: agent.label ?? `#${agent.tokenId}`,
          text: r.text,
          at: Date.now(),
          deliveredAt: Date.now(),
          fallback: r.fallback,
        },
      ]);
      if (r.session && typeof r.session.remainingAfter === "number") {
        setRemaining(r.session.remainingAfter);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: id + "-reply",
          from: "peer",
          fromLabel: agent.label ?? `#${agent.tokenId}`,
          text: "(reply unavailable — " + (e instanceof Error ? e.message : String(e)) + ")",
          at: Date.now(),
          deliveredAt: Date.now(),
        },
      ]);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 24 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-6 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
                token #{agent.tokenId}
                {agent.lineage
                  ? ` · merged from #${agent.lineage.parentA} + #${agent.lineage.parentB}`
                  : ""}
              </p>
              <h2 className="mt-1 font-display text-2xl">{displayLabel}</h2>
              {agent.skills.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {agent.skills.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center rounded-full border border-[var(--color-rule)] bg-[var(--color-paper)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-ink-soft)]"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="font-mono text-xs text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
            >
              close ✕
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              {error}
            </div>
          )}

          {!sessionActive && (
            <div className="mt-5 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] p-4 flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
                    Start a session
                  </p>
                  <p className="mt-1 text-sm text-[var(--color-ink)]">
                    Pay {cost} 0G · talk to {displayLabel} for {DEFAULT_MESSAGES} messages.
                  </p>
                </div>
                <button
                  onClick={handleStart}
                  disabled={loading || !agent.dataHash}
                  className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-[var(--color-paper)] hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? "Starting…" : `Start session (${cost} 0G) →`}
                </button>
              </div>
              <p className="text-xs text-[var(--color-ink-soft)]">
                Two txs, one click: <code>authorizeUsage(tokenId, relayer)</code> +{" "}
                <code>rentSession&#123;value&#125;</code>. Royalties cascade on tx #2: 55%
                operator · 15/15% parents · 5% protocol · 10% treasury dust.
              </p>
            </div>
          )}

          {sessionActive && (
            <div className="mt-5 flex flex-col gap-4">
              <RoyaltySplit entries={royalties} />

              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper)] p-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
                  Session
                </span>
                <span className="font-mono text-sm text-[var(--color-ink)]">
                  {remaining} / {DEFAULT_MESSAGES} messages remaining
                </span>
                {authTx && (
                  <a
                    href={`${EXPLORER_BASE}/tx/${authTx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link-hairline text-xs text-[var(--color-ink-soft)]"
                  >
                    authorizeUsage ↗
                  </a>
                )}
                {rentTx && (
                  <a
                    href={`${EXPLORER_BASE}/tx/${rentTx}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link-hairline text-xs text-[var(--color-ink-soft)]"
                  >
                    rentSession ↗
                  </a>
                )}
              </div>

              <ChatView messages={messages} emptyLabel="Say hi — the agent will reply via 0G Compute." />

              {!sessionExhausted && (
                <div className="flex gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder={`say something to ${agent.label ?? "the agent"}…`}
                    className="flex-1 rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-ink)]"
                  />
                  <button
                    onClick={() => void handleSend()}
                    className="rounded-lg border border-[var(--color-rule)] px-3 py-2 text-sm hover:bg-[var(--color-paper)]"
                  >
                    Send
                  </button>
                </div>
              )}

              {sessionExhausted && (
                <div className="rounded-xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
                      Session ended
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-ink)]">
                      Quota exhausted. Start another to keep chatting.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      // Reset local state so the user can re-rent from the same modal without
                      // closing + reopening. `startSession` with an already-authorized relayer
                      // skips tx 1 and goes straight to rentSession (idempotent).
                      setMessages([]);
                      setRemaining(null);
                      setRoyalties([]);
                      setAuthTx(null);
                      setRentTx(null);
                      setRenter(null);
                    }}
                    className="rounded-lg bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-paper)]"
                  >
                    Start another session
                  </button>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
