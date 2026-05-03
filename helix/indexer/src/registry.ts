// In-memory registry of every minted (and merged) Helix iNFT.
//
// Populated incrementally by the same event handlers that emit IndexerEvent frames to the
// WebSocket sidebar. No persistence — rebuilds on indexer restart. That's fine for the
// hackathon demo (pre-mint before recording, optionally backfill N blocks on boot).
//
// Exposed as `GET /agents` on the indexer's HTTP port so the /marketplace page can fetch
// the current inventory without scanning the chain itself.

import type { AgentSummary, Hex } from "./types.js";

const registry = new Map<number, AgentSummary>();

/** Lazy upsert helper — fills in defaults for fields we haven't seen yet. */
function touch(tokenId: number): AgentSummary {
  let cur = registry.get(tokenId);
  if (!cur) {
    cur = {
      tokenId,
      label: null,
      addr: null,
      dataHash: null,
      skills: [],
      lineage: null,
      mintTxHash: null,
      mintedAt: 0,
      earned: 0,
    };
    registry.set(tokenId, cur);
  }
  return cur;
}

// ─────────────────────────────────────────────────────────────────────────
//  Event sinks — called alongside the existing WebSocket emit() calls.
// ─────────────────────────────────────────────────────────────────────────

export function onMint(opts: {
  tokenId: number;
  to: Hex;
  txHash: Hex;
  at?: number;
}): void {
  const a = touch(opts.tokenId);
  a.addr = opts.to;
  a.mintTxHash = opts.txHash;
  a.mintedAt = opts.at ?? Date.now();
}

export function onTransfer(opts: { tokenId: number; to: Hex }): void {
  // Non-mint transfers just update the owner address (rare in our demo but worth tracking).
  const a = touch(opts.tokenId);
  a.addr = opts.to;
}

export function onMerged(opts: {
  childTokenId: number;
  parentA: number;
  parentB: number;
}): void {
  const a = touch(opts.childTokenId);
  a.lineage = { parentA: opts.parentA, parentB: opts.parentB };
}

export function onNameRegistered(opts: { tokenId: number; label: string }): void {
  const a = touch(opts.tokenId);
  a.label = opts.label;
}

export function onTextChanged(opts: {
  tokenId: number;
  key: string;
  value: string;
}): void {
  const a = touch(opts.tokenId);
  // We derive skills from the `description` text record's personality string by splitting on
  // commas / common separators, keeping the first 3 non-empty words. Primitive but good
  // enough to render skill chips in the marketplace without a second RPC call.
  if (opts.key === "description" && opts.value) {
    // The description is a personality string like "expert sentiment analyst" — use keywords
    // as surrogate skills until /api/soul/:id/proof is hydrated client-side for exact values.
    const words = opts.value
      .toLowerCase()
      .split(/[,;\s]+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w));
    a.skills = words.slice(0, 3);
  }
  // Stash a few well-known keys verbatim for the marketplace card if useful later.
  // For MVP we only render skills; leaving the raw text indexed lets us extend without schema change.
}

const STOPWORDS = new Set([
  "with", "that", "this", "from", "into", "over", "when", "what", "have",
  "will", "your", "their", "them", "they", "been", "were", "just", "only",
  "very", "like", "some", "more", "most", "then", "than", "also",
]);

export function onRoyaltyFlowed(opts: { toToken: number; amount: bigint }): void {
  const a = touch(opts.toToken);
  // earned is surfaced in 0G (human-readable), matching how the frontend renders amounts.
  a.earned += Number(opts.amount) / 1e18;
}

// ─────────────────────────────────────────────────────────────────────────
//  Snapshot — called by the HTTP handler on GET /agents.
// ─────────────────────────────────────────────────────────────────────────

export function snapshot(): AgentSummary[] {
  return Array.from(registry.values()).sort((a, b) => b.mintedAt - a.mintedAt);
}

export function registrySize(): number {
  return registry.size;
}
