import type { DemoState, DemoAction } from "./types";

export const initialState: DemoState = { step: "idle" };

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.t) {
    case "reset":
      return initialState;

    case "mint-a-start":
      if (state.step === "idle") return { step: "minting-a", name: action.name };
      return state;

    case "mint-a-done":
      if (state.step === "minting-a") return { step: "ready-for-b", a: action.card };
      return state;

    case "mint-b-start":
      if (state.step === "ready-for-b")
        return { step: "minting-b", a: state.a, name: action.name };
      return state;

    case "mint-b-done":
      if (state.step === "minting-b")
        return { step: "ready-to-chat", a: state.a, b: action.card };
      return state;

    case "chat-start":
      if (state.step === "ready-to-chat")
        return { step: "chatting", a: state.a, b: state.b, messages: [] };
      return state;

    case "chat-add":
      if (state.step === "chatting" || state.step === "ready-to-merge") {
        return {
          ...state,
          messages: [...state.messages, action.msg],
        };
      }
      return state;

    case "chat-delivered":
      if (state.step === "chatting" || state.step === "ready-to-merge") {
        return {
          ...state,
          messages: state.messages.map((m) =>
            m.id === action.id ? { ...m, deliveredAt: Date.now(), resolvedPubkey: action.pubkey } : m
          ),
        };
      }
      return state;

    case "chat-end":
      if (state.step === "chatting")
        return {
          step: "ready-to-merge",
          a: state.a,
          b: state.b,
          messages: state.messages,
        };
      return state;

    case "merge-start":
      if (state.step === "ready-to-merge")
        return {
          step: "merging",
          a: state.a,
          b: state.b,
          messages: state.messages,
        };
      return state;

    case "merge-done":
      if (state.step === "merging")
        return {
          step: "ready-to-invoke",
          a: state.a,
          b: state.b,
          child: action.child,
          messages: state.messages,
          childMessages: [],
          sessionRemaining: null,
        };
      return state;

    case "child-chat-add":
      if (state.step === "ready-to-invoke")
        return { ...state, childMessages: [...state.childMessages, action.msg] };
      return state;

    case "session-started":
      if (state.step === "ready-to-invoke")
        return {
          ...state,
          a: action.updatedA,
          b: action.updatedB,
          child: action.updatedChild,
          sessionRemaining: action.messageCount,
          sessionRenter: action.renter,
          sessionAuthTx: action.authTxHash,
          sessionRentTx: action.rentTxHash,
          sessionRoyalties: action.royalties,
        };
      return state;

    case "session-message-consumed":
      if (state.step === "ready-to-invoke" && state.sessionRemaining !== null)
        return { ...state, sessionRemaining: Math.max(0, action.remaining) };
      return state;

    case "invoke-start":
      if (state.step === "ready-to-invoke")
        return {
          step: "invoking",
          a: state.a,
          b: state.b,
          child: state.child,
          messages: state.messages,
          childMessages: state.childMessages,
        };
      return state;

    case "invoke-done":
      if (state.step === "invoking")
        return {
          step: "done",
          a: action.updatedA,
          b: action.updatedB,
          child: action.updatedChild,
          messages: state.messages,
          childMessages: state.childMessages,
          royalties: action.royalties,
          invokeTx: action.txHash,
          invokeExplorer: action.explorer,
        };
      return state;

    default:
      return state;
  }
}
