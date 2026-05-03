// Shared session + gated-chat helpers used by both Step 5 of the 5-step demo (flow.tsx) and
// the marketplace's <SessionChatModal /> (components/marketplace/). Pure async functions —
// no React state or dispatch — so callers keep their own UI wiring.

export interface StartSessionResult {
  tokenId: number;
  renter: string;
  messageCount: number;
  amountPaid: string;
  authTxHash: string | null;
  authAlreadyGranted: boolean;
  rentTxHash: string;
  authExplorerUrl: string | null;
  rentExplorerUrl: string;
}

export interface GatedReplyResult {
  text: string;
  fallback: boolean;
  model: string;
  session?: {
    remainingAfter: number | null;
    consumeTxHash: string | null;
  };
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Rent a session on an iNFT. Fires both txs (authorizeUsage + rentSession) through the
 * relayer; skips authorizeUsage when the relayer was already authorized on this tokenId
 * (idempotent behavior added to /api/session/start after the v3 ERC7857AlreadyAuthorized fix).
 */
export async function startSession(
  tokenId: number,
  messageCount: number
): Promise<StartSessionResult> {
  const r = await fetch("/api/session/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokenId, messageCount }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`/api/session/start ${r.status}: ${body}`);
  }
  return (await r.json()) as StartSessionResult;
}

/**
 * Send one gated message to an agent. The oracle checks the renter's on-chain quota,
 * consumes one slot, calls real 0G Compute (or scripted fallback), and returns the reply
 * plus the new remaining quota.
 */
export async function sendGatedReply(opts: {
  dataHash: string;
  tokenId: number;
  renter: string;
  history: ChatTurn[];
  maxTokens?: number;
}): Promise<GatedReplyResult> {
  const r = await fetch("/api/reply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dataHash: opts.dataHash,
      tokenId: opts.tokenId,
      renter: opts.renter,
      history: opts.history,
      maxTokens: opts.maxTokens ?? 120,
      gated: true,
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`/api/reply ${r.status}: ${body}`);
  }
  return (await r.json()) as GatedReplyResult;
}

/**
 * Derive the royalty split table from a session-rent amount. The contract enforces
 * 55/15/15/5/10 exactly; we reproduce the split locally so the UI can render numbers
 * the moment /api/session/start returns, without waiting for an indexer round-trip.
 */
export interface RoyaltyRow {
  role: "operator" | "parent-a" | "parent-b" | "protocol" | "dust";
  amount: number;
}

export function royaltySplit(amount: number): RoyaltyRow[] {
  return [
    { role: "operator", amount: amount * 0.55 },
    { role: "parent-a", amount: amount * 0.15 },
    { role: "parent-b", amount: amount * 0.15 },
    { role: "protocol", amount: amount * 0.05 },
    { role: "dust", amount: amount * 0.1 },
  ];
}
