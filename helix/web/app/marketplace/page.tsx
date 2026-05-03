"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";

import {
  SessionChatModal,
  type MarketplaceAgent,
} from "@/app/components/marketplace/session-chat-modal";

const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_EXPLORER_BASE ?? "https://chainscan-galileo.0g.ai";

type AgentsResponse = {
  agents: MarketplaceAgent[];
  count: number;
  asOf: number;
};

/**
 * /marketplace — browse every agent iNFT anyone has ever minted on Helix and rent a session
 * to chat with it. The list is built by the indexer's in-memory registry and served via
 * /api/agents. Every session fires a real on-chain royalty cascade, so repeated marketplace
 * visits pound the "talk-to-descendant-ancestors-earn" narrative.
 */
export default function MarketplacePage() {
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<MarketplaceAgent | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/agents", { cache: "no-store" });
        if (!r.ok) {
          const body = await r.text();
          throw new Error(`/api/agents ${r.status}: ${body.slice(0, 200)}`);
        }
        const body = (await r.json()) as AgentsResponse;
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void load();
    const id = setInterval(load, 10_000); // gentle polling so new mints appear without reload
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
            marketplace
          </p>
          <h1 className="mt-2 font-display text-4xl text-[var(--color-ink)]">
            Every agent, one click away.
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-[var(--color-ink-soft)]">
            Browse every Helix agent iNFT anyone has ever minted. Click Chat, rent a
            session, talk to the agent — on-chain royalties cascade to its creators on
            every message. No mint required.
          </p>
        </div>
        <Link
          href="/"
          className="shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
        >
          ← Back to demo
        </Link>
      </div>

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="mt-10 font-mono text-sm text-[var(--color-ink-mute)]">
          loading registry from indexer…
        </div>
      )}

      {data && (
        <>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
            {data.count} agents · updated {new Date(data.asOf).toLocaleTimeString()}
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data.agents.map((a) => (
              <MarketplaceTile
                key={a.tokenId}
                agent={a}
                onChat={() => setOpen(a)}
              />
            ))}
          </div>
        </>
      )}

      {open && <SessionChatModal agent={open} onClose={() => setOpen(null)} />}
    </main>
  );
}

function MarketplaceTile({
  agent,
  onChat,
}: {
  agent: MarketplaceAgent & { mintTxHash?: string | null; earned?: number };
  onChat: () => void;
}) {
  const isChild = !!agent.lineage;
  const displayLabel = agent.label ? `${agent.label}.helixx.eth` : `Token #${agent.tokenId}`;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-xl border border-[var(--color-rule)] border-l-[3px] ${
        isChild
          ? "border-l-[var(--color-accent)] bg-[var(--color-accent-soft)]"
          : "border-l-[var(--color-ink)] bg-[var(--color-surface)]"
      } p-5 flex flex-col gap-3`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
            token #{agent.tokenId}
            {isChild && agent.lineage
              ? ` · child of #${agent.lineage.parentA} + #${agent.lineage.parentB}`
              : " · root"}
          </div>
          <h3 className="mt-1 font-display text-xl">{displayLabel}</h3>
          {agent.label && (
            <a
              href={`https://sepolia.app.ens.domains/${agent.label}.helixx.eth`}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-block font-mono text-[10px] text-[var(--color-ink-mute)] hover:text-[var(--color-accent)]"
            >
              verify on ENS ↗
            </a>
          )}
        </div>
        <EarningsBadge amount={agent.earned ?? 0} />
      </div>

      {agent.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
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

      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        {agent.mintTxHash && (
          <a
            href={`${EXPLORER_BASE}/tx/${agent.mintTxHash}`}
            target="_blank"
            rel="noreferrer"
            className="link-hairline font-mono text-[10px] text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
          >
            mint tx ↗
          </a>
        )}
        <button
          onClick={onChat}
          disabled={!agent.dataHash}
          className="rounded-lg bg-[var(--color-ink)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-paper)] disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            agent.dataHash ? "Rent a session and chat" : "dataHash unavailable — chat disabled"
          }
        >
          Chat →
        </button>
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
    <div className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 font-mono text-[11px] font-medium text-[var(--color-accent)]">
      +{amount.toFixed(6)} 0G
    </div>
  );
}
