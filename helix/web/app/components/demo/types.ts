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
  from: "alice" | "bob";
  text: string;
  at: number;
  /** present once delivered */
  deliveredAt?: number;
  resolvedPubkey?: string;
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
  | { step: "ready-to-invoke"; a: AgentCard; b: AgentCard; child: AgentCard; messages: ChatMessage[] }
  | { step: "invoking"; a: AgentCard; b: AgentCard; child: AgentCard; messages: ChatMessage[] }
  | {
      step: "done";
      a: AgentCard;
      b: AgentCard;
      child: AgentCard;
      messages: ChatMessage[];
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
