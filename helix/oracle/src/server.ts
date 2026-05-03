#!/usr/bin/env node
// Helix Oracle — HTTP service exposing /prepareMint, /prepareMerge.
//
// The oracle:
//   1. Owns a signer key (stand-in for a TEE-held key). The contract's verifier trusts
//      signatures from this signer address.
//   2. Holds encrypted souls + their symmetric keys.
//   3. On merge, decrypts both parents, blends them, re-encrypts for the child recipient,
//      and returns proofs ready to submit to HelixSoul.iMergeFrom.

import express from "express";
import type { Request, Response } from "express";

import { loadOracleIdentity, pubkey64For } from "./keys.js";
import { encryptSoul, decryptSoul, sealKeyFor } from "./encryption.js";
import { makeRootSoul, mergeSouls, type Soul } from "./soul.js";
import { buildProof, buildSignedProof } from "./proofs.js";
import { makeStore, type SoulStore } from "./storage.js";
import { replyFor, computeMode, type ChatTurn } from "./compute.js";
import { maybeMakeRentalFromEnv } from "./rental.js";
import type { Hex, TransferValidityProof, IntelligentData } from "./types.js";

const oracle = loadOracleIdentity();

// Storage backend: "memory" or "0g". When 0g, STORAGE_PRIVATE_KEY funds uploads.
const STORAGE_BACKEND = (process.env.STORAGE_BACKEND ?? "memory") as "memory" | "0g";
const store: SoulStore = makeStore({
  backend: STORAGE_BACKEND,
  rpcUrl: process.env.HELIX_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
  indexerUrl:
    process.env.HELIX_INDEXER_URL ?? "https://indexer-storage-testnet-turbo.0g.ai",
  privateKey: process.env.STORAGE_PRIVATE_KEY ?? process.env.ORACLE_PRIVATE_KEY,
  cachePath: process.env.HELIX_KEY_CACHE ?? "./helix-oracle-keys.enc",
});

// Verifier binding for on-chain proof verification. When both are set, the server produces
// signed `TransferValidityProof`s consumable by HelixVerifier on-chain; otherwise it falls back
// to the unsigned shape (only useful with MockVerifier in tests).
const VERIFIER_ADDRESS = process.env.HELIX_VERIFIER as Hex | undefined;
const CHAIN_ID = process.env.HELIX_CHAIN_ID ? BigInt(process.env.HELIX_CHAIN_ID) : undefined;
const useSignedProofs = Boolean(VERIFIER_ADDRESS && CHAIN_ID);

// Optional: session-rental gate for /reply. If HELIX_SESSION_RENTAL is set, /reply requires
// the caller to pass { tokenId, renter } and have an active session. Otherwise replies run
// unrestricted (open mode for local dev).
const rentalClient = maybeMakeRentalFromEnv();

async function makeProof(params: {
  dataHash: Hex;
  recipientAddress: Hex;
  recipientPubkey64: Hex;
  sealedKey: Hex;
}): Promise<TransferValidityProof> {
  if (useSignedProofs && VERIFIER_ADDRESS && CHAIN_ID !== undefined) {
    return buildSignedProof({
      ...params,
      chainId: CHAIN_ID,
      verifier: VERIFIER_ADDRESS,
      signer: oracle.signer,
    });
  }
  return buildProof(params);
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    oracle: oracle.signer.address,
    oraclePubkey: oracle.signerPublicKey64,
    storage: store.backend(),
    signedProofs: useSignedProofs,
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  POST /prepareMint
//  Body: { name, personality, skills[], tools[]?, model?, recipient: { address, pubkey64 } }
//  Response: { intelligentData, proof, dataHash }
//
//  Caller then submits HelixSoul.mint([intelligentData], recipient.address) — the mint function
//  does not require a proof (root souls have no prior owner). The proof is returned for
//  symmetry with /prepareMerge and for callers that want a signed attestation of the mint.
// ─────────────────────────────────────────────────────────────────────────

app.post("/prepareMint", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      name: string;
      personality: string;
      skills: string[];
      tools?: string[];
      model?: string;
      recipient: { address: Hex; pubkey64: Hex };
    };

    if (!body?.recipient?.address || !body?.recipient?.pubkey64) {
      return res.status(400).json({ error: "recipient.address + recipient.pubkey64 required" });
    }

    const soul: Soul = makeRootSoul({
      name: body.name,
      personality: body.personality,
      skills: body.skills,
      tools: body.tools,
      model: body.model,
    });

    const enc = encryptSoul(soul);
    await store.put(enc.dataHash, { ciphertext: enc.ciphertext, symmetricKey: enc.symmetricKey });

    const sealedKey = sealKeyFor(body.recipient.pubkey64, enc.symmetricKey);
    const proof = await makeProof({
      dataHash: enc.dataHash,
      recipientAddress: body.recipient.address,
      recipientPubkey64: body.recipient.pubkey64,
      sealedKey,
    });

    const intelligentData: IntelligentData = {
      dataDescription: `helix-soul-v1:${body.name}`,
      dataHash: enc.dataHash,
    };

    res.json({
      intelligentData,
      proof,
      dataHash: enc.dataHash,
      soulSummary: {
        name: soul.name,
        skills: soul.skills.map((s) => s.name),
        provenance: soul.provenance,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────
//  POST /prepareMerge
//  Body: {
//    parentA: { dataHash, tokenId },
//    parentB: { dataHash, tokenId },
//    caller: { address, pubkey64 },  // who will call iMergeFrom (= merge assistant)
//    recipient: { address, pubkey64 }, // child token goes here
//    childName: string
//  }
//  Response: {
//    parentAProofs, parentBProofs, childProofs,
//    childIntelligentData, childDataHash, childSoulSummary
//  }
// ─────────────────────────────────────────────────────────────────────────

app.post("/prepareMerge", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      parentA: { dataHash: Hex; tokenId: number };
      parentB: { dataHash: Hex; tokenId: number };
      caller: { address: Hex; pubkey64: Hex };
      recipient: { address: Hex; pubkey64: Hex };
      childName: string;
    };

    const recA = await store.get(body.parentA.dataHash);
    const recB = await store.get(body.parentB.dataHash);
    if (!recA || !recB) {
      const missing = [
        !recA ? `parentA (dataHash=${body.parentA.dataHash}, tokenId=${body.parentA.tokenId})` : null,
        !recB ? `parentB (dataHash=${body.parentB.dataHash}, tokenId=${body.parentB.tokenId})` : null,
      ].filter(Boolean);
      return res.status(404).json({
        error: "soul key not in oracle cache",
        missing,
        hint:
          "This oracle process has no decryption key for the missing soul(s). Symmetric keys " +
          "are held in memory and are lost across oracle restarts. To merge, mint fresh parents " +
          "in the current oracle session and use their dataHash from the new mint output. " +
          "(In production, keys live in a TEE with stable identity across reboots.)",
      });
    }

    // TEE boundary: decrypt, blend, re-encrypt.
    const soulA = decryptSoul(recA.ciphertext, recA.symmetricKey) as Soul;
    const soulB = decryptSoul(recB.ciphertext, recB.symmetricKey) as Soul;

    const child: Soul = mergeSouls(soulA, soulB, {
      parentATokenId: body.parentA.tokenId,
      parentBTokenId: body.parentB.tokenId,
      childName: body.childName,
    });

    const encChild = encryptSoul(child);
    await store.put(encChild.dataHash, {
      ciphertext: encChild.ciphertext,
      symmetricKey: encChild.symmetricKey,
    });

    // Access proofs for each parent: re-seal the parent symmetric key to the CALLER so they
    // can "see" the parent. In real TEE flow this never leaves the enclave; we simulate it.
    const sealedKeyA = sealKeyFor(body.caller.pubkey64, recA.symmetricKey);
    const sealedKeyB = sealKeyFor(body.caller.pubkey64, recB.symmetricKey);

    const parentAProofs: TransferValidityProof[] = [
      await makeProof({
        dataHash: body.parentA.dataHash,
        recipientAddress: body.caller.address,
        recipientPubkey64: body.caller.pubkey64,
        sealedKey: sealedKeyA,
      }),
    ];
    const parentBProofs: TransferValidityProof[] = [
      await makeProof({
        dataHash: body.parentB.dataHash,
        recipientAddress: body.caller.address,
        recipientPubkey64: body.caller.pubkey64,
        sealedKey: sealedKeyB,
      }),
    ];

    // Child proof: the new encrypted blob sealed to the recipient.
    const sealedKeyChild = sealKeyFor(body.recipient.pubkey64, encChild.symmetricKey);
    const childProofs: TransferValidityProof[] = [
      await makeProof({
        dataHash: encChild.dataHash,
        recipientAddress: body.recipient.address,
        recipientPubkey64: body.recipient.pubkey64,
        sealedKey: sealedKeyChild,
      }),
    ];

    const childIntelligentData: IntelligentData = {
      dataDescription: `helix-soul-v1:${child.name}`,
      dataHash: encChild.dataHash,
    };

    res.json({
      parentAProofs,
      parentBProofs,
      childProofs,
      childIntelligentData,
      childDataHash: encChild.dataHash,
      childSoulSummary: {
        name: child.name,
        skills: child.skills.map((s) => ({ name: s.name, weight: s.weight, from: s.sourceParent })),
        provenance: child.provenance,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────
//  POST /reply — generate an agent's reply to a conversation
//  Body: { dataHash, history: [{role, content}, ...], maxTokens? }
//  Returns: { text, fallback, model, agent: { name, skills } }
//
//  Loads the soul from the persistent cache (via dataHash), decrypts it, builds a system
//  prompt from its personality, and calls 0G Compute (if OG_COMPUTE_KEY is set) or the
//  scripted fallback otherwise. Demo-ready without real compute credentials.
// ─────────────────────────────────────────────────────────────────────────

app.post("/reply", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      dataHash?: Hex;
      history?: ChatTurn[];
      maxTokens?: number;
      // Optional: session gate. Required when HELIX_SESSION_RENTAL is configured AND the
      // caller asks for gated=true. When omitted, caller gets "open mode" replies.
      tokenId?: number;
      renter?: Hex;
      gated?: boolean;
    };
    if (!body.dataHash || !Array.isArray(body.history)) {
      return res.status(400).json({ error: "dataHash + history[] required" });
    }

    // Session gate: if caller opts in (gated=true) AND rental is configured, check quota.
    // When gated=true but rental is unconfigured on the server, fail closed — the caller
    // explicitly asked for enforcement and we can't honor it.
    const shouldGate = body.gated === true;
    let remainingAfter: number | null = null;
    if (shouldGate) {
      if (!rentalClient) {
        return res.status(503).json({
          error: "session gating requested but HELIX_SESSION_RENTAL is not configured",
        });
      }
      if (typeof body.tokenId !== "number" || !body.renter) {
        return res.status(400).json({ error: "gated=true requires tokenId + renter" });
      }
      const remaining = await rentalClient.activeSessionOf(BigInt(body.tokenId), body.renter);
      if (remaining === 0n) {
        return res.status(402).json({
          error: "no active session",
          hint: "call POST /api/session/start on the web layer to rent messages first",
          tokenId: body.tokenId,
          renter: body.renter,
        });
      }
      remainingAfter = Number(remaining) - 1; // what it'll be after consume succeeds
    }

    const rec = await store.get(body.dataHash);
    if (!rec) {
      return res.status(404).json({
        error: "soul key not in oracle cache",
        hint:
          "The oracle has no decryption key for this dataHash — mint in the same oracle " +
          "session (or after loading from persistent cache) before calling /reply.",
      });
    }

    const soul = decryptSoul(rec.ciphertext, rec.symmetricKey) as Soul;

    // Consume BEFORE generating so a generation failure doesn't waste a message slot.
    // (Trade-off: a consume tx that reverts after generation would leave the user confused;
    // this way the gate is atomic from the user's perspective — either quota decrements, or
    // nothing happens.)
    let consumeTxHash: Hex | null = null;
    if (shouldGate && rentalClient && typeof body.tokenId === "number" && body.renter) {
      try {
        consumeTxHash = await rentalClient.consumeMessage(BigInt(body.tokenId), body.renter);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[reply] consumeMessage failed, continuing open: " + String((err as Error).message));
        remainingAfter = null; // we don't actually know remaining if consume failed
      }
    }

    const reply = await replyFor({
      soul,
      history: body.history,
      maxTokens: body.maxTokens,
    });

    res.json({
      text: reply.text,
      fallback: reply.fallback,
      model: reply.model,
      agent: { name: soul.name, skills: soul.skills.map((s) => s.name) },
      session: shouldGate
        ? { remainingAfter, consumeTxHash }
        : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────
//  GET /soul/:dataHash/proof
//    Returns a sanitized "proof" object the web UI can render in its View-proof panel.
//    Contains: rootHash (0G Storage), ciphertext byte length, dataHash (echo).
//    Does NOT expose the symmetric key.
//
//  GET /soul/:dataHash/ciphertext
//    Streams the raw encrypted ciphertext for download. Opening the file shows gibberish.
//
//  POST /soul/:dataHash/reveal
//    Decrypts the soul and returns JSON. Intended for the demo owner reveal flow.
//    In hosted-relayer mode the relayer owns the iNFT, so this is "owner-only" by design.
// ─────────────────────────────────────────────────────────────────────────

app.get("/soul/:dataHash/proof", async (req: Request, res: Response) => {
  try {
    const dataHash = req.params.dataHash as Hex;
    const rec = await store.get(dataHash);
    if (!rec) return res.status(404).json({ error: "soul not in cache" });
    res.json({
      dataHash,
      rootHash: rec.rootHash ?? null,
      ciphertextBytes: rec.ciphertext?.length ?? 0,
      storage: store.backend(),
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message) });
  }
});

app.get("/soul/:dataHash/ciphertext", async (req: Request, res: Response) => {
  try {
    const dataHash = req.params.dataHash as Hex;
    const rec = await store.get(dataHash);
    if (!rec) return res.status(404).json({ error: "soul not in cache" });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="soul-${dataHash.slice(0, 10)}.enc"`
    );
    res.send(Buffer.from(rec.ciphertext));
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message) });
  }
});

app.post("/soul/:dataHash/reveal", async (req: Request, res: Response) => {
  try {
    const dataHash = req.params.dataHash as Hex;
    const rec = await store.get(dataHash);
    if (!rec) return res.status(404).json({ error: "soul not in cache" });
    const plaintext = decryptSoul(rec.ciphertext, rec.symmetricKey);
    res.json({
      dataHash,
      rootHash: rec.rootHash ?? null,
      ciphertextBytes: rec.ciphertext?.length ?? 0,
      soul: plaintext,
    });
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message) });
  }
});

// ─────────────────────────────────────────────────────────────────────────
//  POST /testSoulRoundtrip — dev helper, mint + immediately decrypt to confirm soul integrity.
// ─────────────────────────────────────────────────────────────────────────

app.post("/testSoulRoundtrip", async (req: Request, res: Response) => {
  try {
    const body = req.body as { name?: string };
    const soul = makeRootSoul({
      name: body.name ?? "test",
      personality: "debug",
      skills: ["ping"],
    });
    const enc = encryptSoul(soul);
    const decoded = decryptSoul(enc.ciphertext, enc.symmetricKey) as Soul;
    res.json({ ok: decoded.name === soul.name, dataHash: enc.dataHash });
  } catch (err) {
    res.status(500).json({ error: String((err as Error).message) });
  }
});

const PORT = Number(process.env.PORT ?? 8787);

app.listen(PORT, () => {
  const proofMode = useSignedProofs
    ? `SIGNED (verifier=${VERIFIER_ADDRESS}, chainId=${CHAIN_ID})`
    : "UNSIGNED (mock mode)";
  // eslint-disable-next-line no-console
  const rentalMode = rentalClient ? `rental=${rentalClient.address}` : "rental=disabled";
  console.log(
    `[helix-oracle] listening on :${PORT}  signer=${oracle.signer.address}  ` +
      `storage=${store.backend()}  proofs=${proofMode}  compute=${computeMode()}  ${rentalMode}`
  );
});

// Export for tests / CLI embedding
export { app };

// Helper for callers who want a pubkey for their own private key
export { pubkey64For };
