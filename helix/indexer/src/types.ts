export type Hex = `0x${string}`;

/** The flat event shape the web sidebar renders. */
export interface IndexerEvent {
  /** ms timestamp */
  t: number;
  /** short tag: "mint" | "name" | "text" | "merge" | "royalty" | "init" */
  kind: string;
  /** one-line display string */
  line: string;
  /** optional enrichment */
  txHash?: Hex;
  tokenId?: number;
  explorerUrl?: string;
}

/** Marketplace-facing summary for a single agent iNFT. */
export interface AgentSummary {
  tokenId: number;
  /** null until NameRegistered fires for this token. */
  label: string | null;
  /** current owner, tracked via Transfer events. null before first Transfer. */
  addr: string | null;
  /** ERC-7857 dataHash; surfaced lazily via /api/soul/:id/proof — not set by indexer. */
  dataHash: string | null;
  /** Derived from the `description` text record's keywords. Best-effort. */
  skills: string[];
  /** Populated for merged children (Merged event). null for roots. */
  lineage: { parentA: number; parentB: number } | null;
  /** Mint tx hash (Transfer from 0x0). */
  mintTxHash: string | null;
  /** ms timestamp when the indexer saw the mint — used for sort-by-recent. */
  mintedAt: number;
  /** Running sum of RoyaltyFlowed.amount where toToken == tokenId, in 0G (not wei). */
  earned: number;
}
