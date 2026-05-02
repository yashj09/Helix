"use client";

import { useReducer, useState, useMemo, useEffect } from "react";
import { motion } from "motion/react";

import { demoReducer, initialState } from "./reducer";
import { StepPanel } from "./step-panel";
import { AgentCard } from "./agent-card";
import { ChatView } from "./chat-view";
import { RoyaltySplit } from "./royalty-split";
import type { AgentCard as AgentCardT, ChatMessage, RoyaltyEntry } from "./types";

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
   * Start a chat from bob → alice. We look up bob + alice on state directly because React's
   * `state` closure is stale during the same-tick dispatch+call we do on step-3 entry.
   * Caller must guarantee both cards exist.
   */
  async function doChat(a: AgentCardT, b: AgentCardT) {
    const id = Math.random().toString(36).slice(2, 10);

    // Local echo first — optimistic UI.
    const msg: ChatMessage = {
      id,
      from: "bob",
      text: chatText,
      at: Date.now(),
    };
    dispatch({ t: "chat-add", msg });

    try {
      const resp = await apiPost<{ resolvedPubkey: string; envelope: { toTokenId: number } }>(
        "/api/chat/send",
        {
          fromNode: "bob",
          toLabel: a.label, // e.g. "alice-xk3p" — registered at mint time
          fromTokenId: b.tokenId,
          text: chatText,
        }
      );
      dispatch({ t: "chat-delivered", id, pubkey: resp.resolvedPubkey });

      // Fake alice reply for the demo visual — the real reply would require a listener
      // loop; out of scope here. The sidebar shows the real on-chain events regardless.
      await new Promise((r) => setTimeout(r, 900));
      dispatch({
        t: "chat-add",
        msg: {
          id: id + "-reply",
          from: "alice",
          text: "yes — let's merge into something bigger",
          at: Date.now(),
          deliveredAt: Date.now(),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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

  async function doInvoke() {
    if (state.step !== "ready-to-invoke") return;
    const { a, b, child } = state;
    dispatch({ t: "invoke-start" });
    try {
      const amount = 0.01;
      const resp = await apiPost<{ invokeTxHash: string; explorerUrl: string; amount: string }>(
        "/api/invoke",
        { tokenId: child.tokenId, amount: amount.toString() }
      );
      // Canonical split (matches contracts): 55% operator, 15% parent A, 15% parent B, 5% protocol, 10% dust → treasury
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
        {
          recipientLabel: "protocol",
          recipientAddr: "(5%)",
          amount: amount * 0.05,
          role: "protocol",
        },
        {
          recipientLabel: "treasury",
          recipientAddr: "(10% dust)",
          amount: amount * 0.1,
          role: "dust",
        },
      ];
      dispatch({
        t: "invoke-done",
        royalties,
        txHash: resp.invokeTxHash,
        explorer: resp.explorerUrl,
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
          description="Bob looks up alice.helix.eth on-chain, pulls her axl.pubkey, and sends a message over the AXL mesh."
          state={stepStates[2]}
        >
          {stepStates[2] === "active" && state.step === "ready-to-chat" && (
            <button
              onClick={() => {
                const a = state.a;
                const b = state.b;
                dispatch({ t: "chat-start" });
                // kick off the send immediately — pass a/b explicitly so the stale-closure
                // state.step !== "chatting" check doesn't fire inside doChat.
                void doChat(a, b);
              }}
              className="rounded-lg bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-paper)]"
            >
              Send message
            </button>
          )}
          {(state.step === "chatting" || state.step === "ready-to-merge") && (
            <div className="mt-4">
              <ChatView messages={state.messages} />
              {state.step === "chatting" && (
                <div className="mt-3 flex gap-2">
                  <input
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
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
                  <button
                    onClick={() => dispatch({ t: "chat-end" })}
                    className="rounded-lg bg-[var(--color-ink)] px-3 py-2 text-sm text-[var(--color-paper)]"
                  >
                    Continue
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

      {/* Step 5 — Invoke */}
      {stepStates[4] !== "idle" && (
        <StepPanel
          n={5}
          title="Invoke the child"
          description="Someone talks to the child. 0.01 0G flows in. Watch royalties cascade back to the ancestors — live."
          state={stepStates[4]}
        >
          {stepStates[4] === "active" && (
            <button
              onClick={() => doInvoke()}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-paper)]"
            >
              Pay 0.01 0G
            </button>
          )}
          {stepStates[4] === "running" && (
            <div className="text-sm text-[var(--color-ink-soft)]">
              Submitting distributeInvocationRevenue…
            </div>
          )}
          {state.step === "done" && (
            <div className="mt-4 flex flex-col gap-4">
              <RoyaltySplit entries={state.royalties} />
              <div className="grid gap-3 md:grid-cols-3">
                <AgentCard card={state.a} tone="parent-a" />
                <AgentCard card={state.b} tone="parent-b" />
                <AgentCard card={state.child} tone="child" highlighted />
              </div>
              <a
                href={state.invokeExplorer}
                target="_blank"
                rel="noreferrer"
                className="link-hairline self-start text-sm text-[var(--color-ink-soft)]"
              >
                View invoke tx ↗
              </a>
            </div>
          )}
        </StepPanel>
      )}

      {state.step === "done" && (
        <div className="pt-6 border-t border-[var(--color-rule)]">
          <button
            onClick={() => dispatch({ t: "reset" })}
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
          >
            ⟲ Run demo again
          </button>
        </div>
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
