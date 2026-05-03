export type AgentCard = {
  tokenId: number;
  label: string;
  dataHash: string;
  skills: string[];
  mintTxHash?: string;
  mintExplorer?: string;
  registerTxHash?: string;
  textTxHash?: string;
  /** Royalty earnings accumulated over the session (0G, human-readable). */
  earned: number;
};

export type ChatMessage = {
  id: string;
  /**
   * "self" = the user side of the conversation (bob in step 3; the visitor in step 5).
   * "peer" = the reply side (alice in step 3; hybrid in step 5).
   */
  from: "self" | "peer";
  /** Display label — e.g. "bob", "alice", "hybrid". Lets the bubble render the agent name. */
  fromLabel?: string;
  text: string;
  at: number;
  /** present once delivered */
  deliveredAt?: number;
  resolvedPubkey?: string;
  /** v2-audit fix: oracle returned a scripted reply. Render a subtle "(simulated)" badge. */
  fallback?: boolean;
};

export type RoyaltyEntry = {
  recipientLabel: string; // display label
  recipientAddr: string;
  amount: number; // 0G
  role: "operator" | "parent-a" | "parent-b" | "protocol" | "dust";
};

export type DemoState =
  | { step: "idle" }
  | { step: "minting-a"; name: string }
  | { step: "ready-for-b"; a: AgentCard }
  | { step: "minting-b"; a: AgentCard; name: string }
  | { step: "ready-to-chat"; a: AgentCard; b: AgentCard }
  | { step: "chatting"; a: AgentCard; b: AgentCard; messages: ChatMessage[] }
  | { step: "ready-to-merge"; a: AgentCard; b: AgentCard; messages: ChatMessage[] }
  | { step: "merging"; a: AgentCard; b: AgentCard; messages: ChatMessage[] }
  | {
      step: "ready-to-invoke";
      a: AgentCard;
      b: AgentCard;
      child: AgentCard;
      messages: ChatMessage[];
      /** Chat-with-hybrid transcript. Built up in step 5. */
      childMessages: ChatMessage[];
      /** v3: remaining messages in the active session. null until session is rented. */
      sessionRemaining: number | null;
      /** v3: address the session is rented to — oracle gates /reply against this renter. */
      sessionRenter?: string;
      /** v3: tx hash from the session-start authorizeUsage call (null if already authorized). */
      sessionAuthTx?: string | null;
      sessionRentTx?: string;
      /** v3: cascade breakdown from the session rental (replaces the v2 end-of-chat invoke). */
      sessionRoyalties?: RoyaltyEntry[];
    }
  | {
      step: "invoking";
      a: AgentCard;
      b: AgentCard;
      child: AgentCard;
      messages: ChatMessage[];
      childMessages: ChatMessage[];
    }
  | {
      step: "done";
      a: AgentCard;
      b: AgentCard;
      child: AgentCard;
      messages: ChatMessage[];
      childMessages: ChatMessage[];
      royalties: RoyaltyEntry[];
      invokeTx: string;
      invokeExplorer: string;
    };

export type DemoAction =
  | { t: "mint-a-start"; name: string }
  | { t: "mint-a-done"; card: AgentCard }
  | { t: "mint-b-start"; name: string }
  | { t: "mint-b-done"; card: AgentCard }
  | { t: "chat-start" }
  | { t: "chat-add"; msg: ChatMessage }
  | { t: "chat-delivered"; id: string; pubkey: string }
  | { t: "chat-end" }
  | { t: "merge-start" }
  | { t: "merge-done"; child: AgentCard }
  /** Step 5: append a message to the child-chat transcript (no on-chain effect yet). */
  | { t: "child-chat-add"; msg: ChatMessage }
  /** v3: session rental start succeeded on-chain; cascade already fired. */
  | {
      t: "session-started";
      messageCount: number;
      renter: string;
      /** null when the relayer was already authorized on this tokenId (no tx needed). */
      authTxHash: string | null;
      rentTxHash: string;
      royalties: RoyaltyEntry[];
      updatedA: AgentCard;
      updatedB: AgentCard;
      updatedChild: AgentCard;
    }
  /** v3: oracle just consumed a message (post-reply). */
  | { t: "session-message-consumed"; remaining: number }
  | { t: "invoke-start" }
  | {
      t: "invoke-done";
      royalties: RoyaltyEntry[];
      txHash: string;
      explorer: string;
      updatedA: AgentCard;
      updatedB: AgentCard;
      updatedChild: AgentCard;
    }
  | { t: "reset" };
