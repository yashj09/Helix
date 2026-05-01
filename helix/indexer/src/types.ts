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
