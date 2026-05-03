"use client";

import { useReducer, useState, useMemo, useEffect } from "react";
import { motion } from "motion/react";

import { demoReducer, initialState } from "./reducer";
import { StepPanel } from "./step-panel";
import { AgentCard } from "./agent-card";
import { ChatView } from "./chat-view";
import { RoyaltySplit } from "./royalty-split";
import type { AgentCard as AgentCardT, ChatMessage, RoyaltyEntry } from "./types";

const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_EXPLORER_BASE ?? "https://chainscan-galileo.0g.ai";

/** Helper: default skill manifest for a given personality archetype. */
function defaultSkills(personality: string): string[] {
  const p = personality.toLowerCase();
  if (p.includes("trader")) return ["order-execution", "risk-management"];
  if (p.includes("analyst") || p.includes("sentiment")) return ["sentiment-analysis", "news-parsing"];
  if (p.includes("writer")) return ["copywriting", "editing"];
  return ["conversation", "assistance"];
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${path} ${r.status}: ${text}`);
  }
  return (await r.json()) as T;
}

export function DemoFlow() {
  const [state, dispatch] = useReducer(demoReducer, initialState);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // Sanity-check the oracle's health on mount via our same-origin /api/health proxy.
  // (Direct fetch to :8787 would be blocked by CORS — the oracle isn't CORS-enabled.)
  useEffect(() => {
    fetch("/api/health")
      .then((r) =>
        r.json() as Promise<{
          ok?: boolean;
          error?: string;
          storage?: string;
          signedProofs?: boolean;
          oracleUrl?: string;
        }>
      )
      .then((h) => {
        if (!h || h.ok === false || h.error) {
          setWarning(
            h?.error ?? `Oracle unreachable${h?.oracleUrl ? " at " + h.oracleUrl : ""}.`
          );
          return;
        }
        if (h.storage !== "0g" || !h.signedProofs) {
          setWarning(
            `Oracle is in the wrong mode (storage=${h.storage}, signedProofs=${h.signedProofs}). ` +
              "Restart the oracle with STORAGE_BACKEND=0g and HELIX_VERIFIER set."
          );
        }
      })
      .catch((e) =>
        setWarning("Oracle check failed: " + (e instanceof Error ? e.message : String(e)))
      );
  }, []);

  const [nameA, setNameA] = useState("alice");
  const [personalityA, setPersonalityA] = useState("expert sentiment analyst");
  const [nameB, setNameB] = useState("bob");
  const [personalityB, setPersonalityB] = useState("disciplined trader");
  const [chatText, setChatText] = useState("hi alice, bob here — want to team up?");
  const [childChatText, setChildChatText] = useState("");

  // Starter-message seeds so Step 3 doesn't feel empty. Picked randomly on step entry.
  const STEP3_STARTERS = [
    "hi alice, bob here — want to team up?",
    "alice, what's your read on the market right now?",
    "hey alice, can I borrow your analysis for my next trade?",
  ];

  // Step 5: starter messages the visitor "types" to the newborn child agent.
  const STEP5_STARTERS = [
    "hybrid, what's your take on ETH right now?",
    "new agent — give me your best trade idea for the week.",
    "hello hybrid, introduce yourself.",
  ];

  // Auto-enter chat on Step 3 reveal. Same-tick dispatch + doChat pattern from the earlier fix.
  const autoStartedRef = useState<{ done: boolean }>({ done: false })[0];
  const childAutoStartedRef = useState<{ done: boolean }>({ done: false })[0];
  useEffect(() => {
    if (state.step === "ready-to-chat" && !autoStartedRef.done) {
      autoStartedRef.done = true;
      const a = state.a;
      const b = state.b;
      const pick = STEP3_STARTERS[Math.floor(Math.random() * STEP3_STARTERS.length)];
      setChatText(pick);
      dispatch({ t: "chat-start" });
      // Delay a tick so the seed shows in the input before send
      setTimeout(() => void doChat(a, b, pick), 60);
    }
    // Auto-send a starter message to the child AFTER session is rented (v3). In v2 this ran
    // on step entry; v3 gates chat on a live session so we wait for `sessionRemaining != null`.
    if (
      state.step === "ready-to-invoke" &&
      state.sessionRemaining !== null &&
      state.sessionRemaining > 0 &&
      state.sessionRenter &&
      !childAutoStartedRef.done &&
      state.childMessages.length === 0
    ) {
      childAutoStartedRef.done = true;
      const child = state.child;
      const renter = state.sessionRenter;
      const pick =
        STEP5_STARTERS[Math.floor(Math.random() * STEP5_STARTERS.length)];
      setTimeout(() => void doChildChat(child, [], renter, pick), 80);
    }
    if (state.step === "idle") {
      autoStartedRef.done = false;
      childAutoStartedRef.done = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step]);

  // Cache AXL pubkeys (64 hex) fetched from local nodes on mount.
  // These get written into the freshly-minted iNFTs' `axl.pubkey` text records so the chat
  // step can resolve label → tokenId → pubkey → AXL delivery end-to-end.
  const [axlKeys, setAxlKeys] = useState<{ alice?: string; bob?: string }>({});
  useEffect(() => {
    Promise.all([
      fetch("/api/axl/alice")
        .then((r) => r.json() as Promise<{ ok?: boolean; our_public_key?: string }>)
        .catch(() => null),
      fetch("/api/axl/bob")
        .then((r) => r.json() as Promise<{ ok?: boolean; our_public_key?: string }>)
        .catch(() => null),
    ]).then(([a, b]) => {
      const next: { alice?: string; bob?: string } = {};
      if (a?.ok && a.our_public_key) next.alice = a.our_public_key;
      if (b?.ok && b.our_public_key) next.bob = b.our_public_key;
      setAxlKeys(next);
      if (!next.alice || !next.bob) {
        setWarning(
          "AXL nodes not reachable. Start `helix/axl-smoke/alice/node -config node-config.json` and bob's in a terminal."
        );
      }
    });
  }, []);

  const stepStates = useMemo(() => computeStepStates(state), [state]);

  async function doMint(
    name: string,
    personality: string,
    axlPubkey: string,
    onDone: (card: AgentCardT) => void
  ) {
    setError(null);
    try {
      // Append a per-session suffix so labels don't collide with previous runs on the
      // same testnet (the registrar requires globally-unique labels).
      const uniqueLabel =
        name + "-" + Math.random().toString(36).slice(2, 6);
      const resp = await apiPost<{
        tokenId: string;
        dataHash: string;
        mintTxHash: string;
        mintExplorerUrl: string;
      }>("/api/mint", {
        name: uniqueLabel,
        personality,
        skills: defaultSkills(personality),
        registerLabel: true,
        axlPubkey,
      });
      onDone({
        tokenId: Number(resp.tokenId),
        label: uniqueLabel,
        dataHash: resp.dataHash,
        skills: defaultSkills(personality),
        mintTxHash: resp.mintTxHash,
        mintExplorer: resp.mintExplorerUrl,
        earned: 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Start/continue a chat from bob → alice. Caller passes `a` + `b` explicitly because
   * React state is stale when we dispatch+call in the same tick (step-3 auto-start).
   *
   * @param textOverride  explicit text to send; if omitted falls back to chatText state.
   *                      Also used to bypass stale state in the auto-start path.
   */
  async function doChat(a: AgentCardT, b: AgentCardT, textOverride?: string) {
    const id = Math.random().toString(36).slice(2, 10);
    const text = textOverride ?? chatText;
    if (!text.trim()) return;

    // Local echo first — optimistic UI.
    const msg: ChatMessage = {
      id,
      from: "self",
      fromLabel: b.label,
      text,
      at: Date.now(),
    };
    dispatch({ t: "chat-add", msg });
    // Clear the composer so follow-ups start blank.
    setChatText("");

    try {
      const resp = await apiPost<{ resolvedPubkey: string; envelope: { toTokenId: number } }>(
        "/api/chat/send",
        {
          fromNode: "bob",
          toLabel: a.label, // e.g. "alice-xk3p" — registered at mint time
          fromTokenId: b.tokenId,
          text,
        }
      );
      dispatch({ t: "chat-delivered", id, pubkey: resp.resolvedPubkey });

      // Alice's reply via /api/reply → oracle → compute (real or scripted).
      // Peer = alice (the one whose soul replies). Self = bob.
      const priorMsgs = state.step === "chatting" ? state.messages : [];
      const justSent: ChatMessage = { id, from: "self", fromLabel: b.label, text, at: Date.now() };
      const history = buildHistoryForPeer(priorMsgs, justSent);
      try {
        const r = await apiPost<{ text: string; fallback: boolean; model: string }>(
          "/api/reply",
          { dataHash: a.dataHash, history, maxTokens: 120 }
        );
        dispatch({
          t: "chat-add",
          msg: {
            id: id + "-reply",
            from: "peer",
            fromLabel: a.label,
            text: r.text,
            at: Date.now(),
            deliveredAt: Date.now(),
            fallback: r.fallback,
          },
        });
      } catch (replyErr) {
        // Hard fallback so the demo never deadlocks.
        dispatch({
          t: "chat-add",
          msg: {
            id: id + "-reply",
            from: "peer",
            fromLabel: a.label,
            text:
              "(reply unavailable — " +
              (replyErr instanceof Error ? replyErr.message : String(replyErr)) +
              ")",
            at: Date.now(),
            deliveredAt: Date.now(),
          },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Shape the chat history from the *peer's* point of view for the /api/reply call.
   * The peer is the one whose soul will generate the reply, so their previous messages
   * are "assistant" turns and everyone else is "user".
   */
  function buildHistoryForPeer(
    prior: ChatMessage[],
    justSent: ChatMessage
  ): Array<{ role: "user" | "assistant"; content: string }> {
    const all = [...prior, justSent];
    return all.map((m) => ({
      role: m.from === "peer" ? ("assistant" as const) : ("user" as const),
      content: m.text,
    }));
  }

  async function doMerge() {
    if (state.step !== "ready-to-merge") return;
    const { a, b } = state;
    dispatch({ t: "merge-start" });
    try {
      const resp = await apiPost<{
        childTokenId: string;
        childDataHash: string;
        skills: { name: string; weight: number; from: string }[];
        mergeTxHash: string;
        explorerUrl: string;
      }>("/api/merge", {
        parentA: { tokenId: a.tokenId, dataHash: a.dataHash },
        parentB: { tokenId: b.tokenId, dataHash: b.dataHash },
        childName: `${a.label}-${b.label}`,
      });
      const child: AgentCardT = {
        tokenId: Number(resp.childTokenId),
        label: `${a.label}×${b.label}`,
        dataHash: resp.childDataHash,
        skills: resp.skills.map((s) => s.name),
        mintTxHash: resp.mergeTxHash,
        mintExplorer: resp.explorerUrl,
        earned: 0,
      };
      dispatch({ t: "merge-done", child });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Step 5 (v3): send a gated message to the child. Oracle checks the renter's active
   * session (recorded on-chain by HelixSessionRental), consumes one message, then generates
   * the reply. The UI trusts the `session.remainingAfter` number from the response to keep
   * the local counter in sync with the chain's view.
   */
  async function doChildChat(
    child: AgentCardT,
    prior: ChatMessage[],
    renter: string,
    textOverride?: string
  ): Promise<void> {
    const id = Math.random().toString(36).slice(2, 10);
    const text = textOverride ?? childChatText;
    if (!text.trim()) return;

    const msg: ChatMessage = {
      id,
      from: "self",
      fromLabel: "you",
      text,
      at: Date.now(),
    };
    dispatch({ t: "child-chat-add", msg });
    setChildChatText("");

    try {
      const history = buildHistoryForPeer(prior, msg);
      const r = await apiPost<{
        text: string;
        fallback: boolean;
        model: string;
        session?: { remainingAfter: number | null; consumeTxHash: string | null };
      }>("/api/reply", {
        dataHash: child.dataHash,
        history,
        maxTokens: 120,
        gated: true,
        tokenId: child.tokenId,
        renter,
      });
      dispatch({
        t: "child-chat-add",
        msg: {
          id: id + "-reply",
          from: "peer",
          fromLabel: child.label,
          text: r.text,
          at: Date.now(),
          deliveredAt: Date.now(),
          fallback: r.fallback,
        },
      });
      if (r.session && typeof r.session.remainingAfter === "number") {
        dispatch({ t: "session-message-consumed", remaining: r.session.remainingAfter });
      }
    } catch (replyErr) {
      dispatch({
        t: "child-chat-add",
        msg: {
          id: id + "-reply",
          from: "peer",
          fromLabel: child.label,
          text:
            "(reply unavailable — " +
            (replyErr instanceof Error ? replyErr.message : String(replyErr)) +
            ")",
          at: Date.now(),
          deliveredAt: Date.now(),
        },
      });
    }
  }

  /**
   * v3 Step 5: rent a session (1 cascade up-front, then N free messages). The relayer
   * subsidizes the visitor by signing both txs itself: authorizeUsage + rentSession{value}.
   * On success we immediately render the royalty panel — the emotional payoff lands *before*
   * chat, not after.
   */
  async function doStartSession(messageCount: number) {
    if (state.step !== "ready-to-invoke") return;
    // Guard against double-rent while mid-flight or when a session is already active.
    if (state.sessionRemaining !== null) return;
    const { a, b, child } = state;
    setError(null);
    try {
      const resp = await apiPost<{
        tokenId: number;
        renter: string;
        messageCount: number;
        amountPaid: string;
        /** null when relayer was already authorized — no authorizeUsage tx was needed. */
        authTxHash: string | null;
        authAlreadyGranted: boolean;
        rentTxHash: string;
      }>("/api/session/start", { tokenId: child.tokenId, messageCount });
      const amount = Number(resp.amountPaid);
      const royalties: RoyaltyEntry[] = [
        {
          recipientLabel: child.label,
          recipientAddr: "(operator)",
          amount: amount * 0.55,
          role: "operator",
        },
        {
          recipientLabel: a.label,
          recipientAddr: "(parent A creator)",
          amount: amount * 0.15,
          role: "parent-a",
        },
        {
          recipientLabel: b.label,
          recipientAddr: "(parent B creator)",
          amount: amount * 0.15,
          role: "parent-b",
        },
        { recipientLabel: "protocol", recipientAddr: "(5%)", amount: amount * 0.05, role: "protocol" },
        { recipientLabel: "treasury", recipientAddr: "(10% dust)", amount: amount * 0.1, role: "dust" },
      ];
      dispatch({
        t: "session-started",
        messageCount: resp.messageCount,
        renter: resp.renter,
        authTxHash: resp.authTxHash,
        rentTxHash: resp.rentTxHash,
        royalties,
        updatedA: { ...a, earned: a.earned + amount * 0.15 },
        updatedB: { ...b, earned: b.earned + amount * 0.15 },
        updatedChild: { ...child, earned: child.earned + amount * 0.55 },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {warning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="font-medium">Oracle check failed:</span> {warning}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {/* Step 1 — Mint A */}
      <StepPanel
        n={1}
        title="Mint your first agent"
        description="Name it. Give it a personality. Helix encrypts its soul and issues an ERC-7857 iNFT."
        state={stepStates[0]}
      >
        {stepStates[0] === "active" || stepStates[0] === "running" ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={nameA}
              onChange={(e) => setNameA(e.target.value.toLowerCase())}
              placeholder="alice"
              className="flex-1 rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-ink)]"
              disabled={stepStates[0] === "running"}
            />
            <input
              value={personalityA}
              onChange={(e) => setPersonalityA(e.target.value)}
              placeholder="expert sentiment analyst"
              className="flex-[2] rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-ink)]"
              disabled={stepStates[0] === "running"}
            />
            <button
              onClick={() => {
                if (!axlKeys.alice) {
                  setError("AXL alice node not reachable. Start it before minting.");
                  return;
                }
                dispatch({ t: "mint-a-start", name: nameA });
                doMint(nameA, personalityA, axlKeys.alice, (card) =>
                  dispatch({ t: "mint-a-done", card })
                );
              }}
              disabled={stepStates[0] === "running" || !axlKeys.alice}
              className="rounded-lg bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-paper)] disabled:opacity-50"
            >
              {stepStates[0] === "running" ? "Minting…" : "Mint"}
            </button>
          </div>
        ) : null}
        {"a" in state && state.a && (
          <div className="mt-4">
            <AgentCard card={state.a} tone="parent-a" />
          </div>
        )}
      </StepPanel>

      {/* Step 2 — Mint B */}
      {stepStates[1] !== "idle" && (
        <StepPanel
          n={2}
          title="Invite a friend"
          description="Mint a second agent to have someone to talk to."
          state={stepStates[1]}
        >
          {stepStates[1] === "active" || stepStates[1] === "running" ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={nameB}
                onChange={(e) => setNameB(e.target.value.toLowerCase())}
                placeholder="bob"
                className="flex-1 rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-ink)]"
                disabled={stepStates[1] === "running"}
              />
              <input
                value={personalityB}
                onChange={(e) => setPersonalityB(e.target.value)}
                placeholder="disciplined trader"
                className="flex-[2] rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-ink)]"
                disabled={stepStates[1] === "running"}
              />
              <button
                onClick={() => {
                  if (!axlKeys.bob) {
                    setError("AXL bob node not reachable. Start it before minting.");
                    return;
                  }
                  dispatch({ t: "mint-b-start", name: nameB });
                  doMint(nameB, personalityB, axlKeys.bob, (card) =>
                    dispatch({ t: "mint-b-done", card })
                  );
                }}
                disabled={stepStates[1] === "running" || !axlKeys.bob}
                className="rounded-lg bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-paper)] disabled:opacity-50"
              >
                {stepStates[1] === "running" ? "Minting…" : "Mint"}
              </button>
            </div>
          ) : null}
          {"b" in state && state.b && (
            <div className="mt-4">
              <AgentCard card={state.b} tone="parent-b" />
            </div>
          )}
        </StepPanel>
      )}

      {/* Step 3 — Chat */}
      {stepStates[2] !== "idle" && (
        <StepPanel
          n={3}
          title="Let them talk"
          description="Bob looks up alice.helixx.eth — a real ENS name on Sepolia that resolves, via CCIP-Read, to her on-chain pubkey stored in the 0G registrar. Messages deliver over the AXL mesh. Talk as much as you want — the mesh is free."
          state={stepStates[2]}
        >
          {(state.step === "ready-to-chat" ||
            state.step === "chatting" ||
            state.step === "ready-to-merge") && (
            <div>
              <ChatView
                messages={state.step !== "ready-to-chat" ? state.messages : []}
              />

              {state.step === "chatting" && (
                <div className="mt-4 flex gap-2">
                  <input
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && state.step === "chatting") {
                        e.preventDefault();
                        void doChat(state.a, state.b);
                      }
                    }}
                    placeholder="say something to alice…"
                    className="flex-1 rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-ink)]"
                  />
                  <button
                    onClick={() => {
                      if (state.step === "chatting") void doChat(state.a, state.b);
                    }}
                    className="rounded-lg border border-[var(--color-rule)] px-3 py-2 text-sm hover:bg-[var(--color-paper)]"
                  >
                    Send
                  </button>
                </div>
              )}

              {state.step === "chatting" && state.messages.length >= 2 && (
                <div className="mt-6 flex flex-col items-start gap-2">
                  <p className="text-sm text-[var(--color-ink-soft)]">
                    Seen enough? Merging combines their souls into a child agent.
                  </p>
                  <button
                    onClick={() => dispatch({ t: "chat-end" })}
                    className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-[var(--color-paper)] hover:opacity-90"
                  >
                    Done talking — let&apos;s merge them →
                  </button>
                </div>
              )}
            </div>
          )}
        </StepPanel>
      )}

      {/* Step 4 — Merge */}
      {stepStates[3] !== "idle" && (
        <StepPanel
          n={4}
          title="Breed them"
          description="Merge the two souls into a child. TEE-signed proofs, new iNFT on-chain, skills inherited from both parents."
          state={stepStates[3]}
        >
          {stepStates[3] === "active" && (
            <button
              onClick={() => doMerge()}
              className="rounded-lg bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-paper)]"
            >
              Merge
            </button>
          )}
          {stepStates[3] === "running" && (
            <div className="text-sm text-[var(--color-ink-soft)]">
              Oracle decrypting both souls in TEE, blending skills, re-encrypting for child… ~15s
            </div>
          )}
          {"child" in state && state.child && (
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 22 }}
              className="mt-4"
            >
              <AgentCard card={state.child} tone="child" highlighted />
            </motion.div>
          )}
        </StepPanel>
      )}

      {/* Step 5 — Rent a session, then chat. v3 rewrite: royalty cascade fires UPFRONT on
          session rental, chat runs until quota is consumed. Spec-aligned: uses ERC-7857
          authorizeUsage + HelixSessionRental on-chain. */}
      {stepStates[4] !== "idle" && (
        <StepPanel
          n={5}
          title="Rent a session — every message pays its ancestors"
          description="Pay once up front: the relayer calls authorizeUsage (ERC-7857) and rentSession{value}. The royalty cascade fires on-chain immediately, and you get N free messages with the child until the quota runs out."
          state={stepStates[4]}
        >
          {state.step === "ready-to-invoke" && (() => {
            const sessionActive = state.sessionRemaining !== null;
            const sessionExhausted = state.sessionRemaining === 0;
            const DEFAULT_MESSAGES = 10;
            const price = (DEFAULT_MESSAGES * 0.01).toFixed(2);
            const renter = state.sessionRenter;
            return (
              <div className="flex flex-col gap-4">
                {!sessionActive && (
                  <div className="rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] p-4 flex flex-col gap-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <div>
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
                          Start a session
                        </p>
                        <p className="mt-1 text-sm text-[var(--color-ink)]">
                          Pay {price} 0G · talk to {state.child.label} for {DEFAULT_MESSAGES} messages.
                        </p>
                      </div>
                      <button
                        onClick={() => void doStartSession(DEFAULT_MESSAGES)}
                        className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-[var(--color-paper)] hover:opacity-90"
                      >
                        Start session ({price} 0G) →
                      </button>
                    </div>
                    <p className="text-xs text-[var(--color-ink-soft)]">
                      Two txs, one click: <code>authorizeUsage(tokenId, relayer)</code> + <code>rentSession&#123;value&#125;</code>.
                      Royalties cascade on tx #2: 55% to {state.child.label}, 15% each to {state.a.label} &amp; {state.b.label}&#39;s creators,
                      5% protocol, 10% treasury dust. All on-chain.
                    </p>
                  </div>
                )}

                {sessionActive && (
                  <>
                    <RoyaltySplit entries={state.sessionRoyalties ?? []} />

                    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--color-rule)] bg-[var(--color-paper)] p-3">
                      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
                        Session
                      </span>
                      <span className="font-mono text-sm text-[var(--color-ink)]">
                        {state.sessionRemaining} / {DEFAULT_MESSAGES} messages remaining
                      </span>
                      {state.sessionAuthTx && (
                        <a
                          href={`${EXPLORER_BASE}/tx/${state.sessionAuthTx}`}
                          target="_blank"
                          rel="noreferrer"
                          className="link-hairline text-xs text-[var(--color-ink-soft)]"
                        >
                          authorizeUsage ↗
                        </a>
                      )}
                      {state.sessionRentTx && (
                        <a
                          href={`${EXPLORER_BASE}/tx/${state.sessionRentTx}`}
                          target="_blank"
                          rel="noreferrer"
                          className="link-hairline text-xs text-[var(--color-ink-soft)]"
                        >
                          rentSession ↗
                        </a>
                      )}
                    </div>

                    <ChatView
                      messages={state.childMessages}
                      emptyLabel="Starter message on its way…"
                    />

                    {!sessionExhausted && (
                      <div className="flex gap-2">
                        <input
                          value={childChatText}
                          onChange={(e) => setChildChatText(e.target.value)}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Enter" &&
                              state.step === "ready-to-invoke" &&
                              renter
                            ) {
                              e.preventDefault();
                              void doChildChat(state.child, state.childMessages, renter);
                            }
                          }}
                          placeholder={`say something to ${state.child.label}…`}
                          className="flex-1 rounded-lg border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-ink)]"
                          disabled={!renter}
                        />
                        <button
                          onClick={() => {
                            if (state.step === "ready-to-invoke" && renter) {
                              void doChildChat(state.child, state.childMessages, renter);
                            }
                          }}
                          className="rounded-lg border border-[var(--color-rule)] px-3 py-2 text-sm hover:bg-[var(--color-paper)] disabled:opacity-50"
                          disabled={!renter}
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
                            Quota exhausted. Rent another session to keep chatting.
                          </p>
                        </div>
                        <button
                          onClick={() => dispatch({ t: "reset" })}
                          className="rounded-lg border border-[var(--color-rule)] px-4 py-2 text-sm hover:bg-[var(--color-paper)]"
                        >
                          ⟲ Run demo again
                        </button>
                      </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-3">
                      <AgentCard card={state.a} tone="parent-a" />
                      <AgentCard card={state.b} tone="parent-b" />
                      <AgentCard card={state.child} tone="child" highlighted />
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </StepPanel>
      )}

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Per-step status inference (idle | active | running | done)
// ─────────────────────────────────────────────────────────────────────────

function computeStepStates(state: ReturnType<typeof demoReducer>): Array<
  "idle" | "active" | "running" | "done"
> {
  const out: Array<"idle" | "active" | "running" | "done"> = [
    "active",
    "idle",
    "idle",
    "idle",
    "idle",
  ];
  switch (state.step) {
    case "idle":
      return out;
    case "minting-a":
      out[0] = "running";
      return out;
    case "ready-for-b":
      out[0] = "done";
      out[1] = "active";
      return out;
    case "minting-b":
      out[0] = "done";
      out[1] = "running";
      return out;
    case "ready-to-chat":
      out[0] = "done";
      out[1] = "done";
      out[2] = "active";
      return out;
    case "chatting":
      out[0] = "done";
      out[1] = "done";
      out[2] = "running";
      return out;
    case "ready-to-merge":
      out[0] = "done";
      out[1] = "done";
      out[2] = "done";
      out[3] = "active";
      return out;
    case "merging":
      out[0] = "done";
      out[1] = "done";
      out[2] = "done";
      out[3] = "running";
      return out;
    case "ready-to-invoke":
      out[0] = "done";
      out[1] = "done";
      out[2] = "done";
      out[3] = "done";
      out[4] = "active";
      return out;
    case "invoking":
      out[0] = "done";
      out[1] = "done";
      out[2] = "done";
      out[3] = "done";
      out[4] = "running";
      return out;
    case "done":
      return ["done", "done", "done", "done", "done"];
    default:
      return out;
  }
}
