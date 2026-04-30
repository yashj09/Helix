// Soul storage — encrypted blob persistence.
//
// Two backends are supported:
//   - "memory" (default): in-process Map, for local dev + tests.
//   - "0g": real 0G Storage via @0gfoundation/0g-ts-sdk.
//
// Both backends expose the same put/get API keyed by `dataHash`. In both cases the oracle
// retains the plaintext symmetric key so it can decrypt/re-encrypt for new recipients.
// Symmetric keys are *always* kept locally (in-memory) — 0G Storage holds only ciphertext.

import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import type { Hex } from "./types.js";

export interface SoulRecord {
  ciphertext: Uint8Array;
  symmetricKey: Uint8Array;
  /** Optional: 0G Storage merkle root hash (set when backend = 0G). */
  rootHash?: string;
}

export interface SoulStore {
  put(dataHash: Hex, rec: SoulRecord): Promise<SoulRecord>;
  get(dataHash: Hex): Promise<SoulRecord | null>;
  backend(): string;
}

export class InMemorySoulStore implements SoulStore {
  private readonly map = new Map<string, SoulRecord>();

  async put(dataHash: Hex, rec: SoulRecord): Promise<SoulRecord> {
    this.map.set(dataHash.toLowerCase(), rec);
    return rec;
  }

  async get(dataHash: Hex): Promise<SoulRecord | null> {
    return this.map.get(dataHash.toLowerCase()) ?? null;
  }

  backend(): string {
    return "memory";
  }
}

/**
 * 0G Storage backend.
 *
 * On `put`: uploads ciphertext to 0G, receives a merkle rootHash, retains the symmetric key
 * locally under `dataHash`. The on-chain `IntelligentData.dataHash` we use in ERC-7857 is the
 * keccak256 of the ciphertext we produced — the 0G rootHash is a separate pointer used to
 * locate the blob, and we keep the two wired together in our local `rootHashByDataHash` map.
 *
 * On `get`: looks up the rootHash, downloads from 0G, returns ciphertext + local sym key.
 *
 * Why not derive rootHash deterministically from dataHash? Because the SDK's merkle scheme
 * ingests the raw bytes, and our dataHash is keccak256 of those same bytes — different hash
 * functions. The cleanest design is: dataHash = on-chain identity; rootHash = 0G retrieval key.
 */
export class ZeroGSoulStore implements SoulStore {
  private readonly indexer: Indexer;
  private readonly signer: ethers.Wallet;
  private readonly rpcUrl: string;
  /** local cache: dataHash → (sym key + rootHash). The oracle restarts lose this — production would persist. */
  private readonly local = new Map<
    string,
    { symmetricKey: Uint8Array; rootHash: string }
  >();

  constructor(opts: {
    rpcUrl: string;
    indexerUrl: string;
    privateKey: string;
  }) {
    this.rpcUrl = opts.rpcUrl;
    const provider = new ethers.JsonRpcProvider(opts.rpcUrl);
    this.signer = new ethers.Wallet(opts.privateKey, provider);
    this.indexer = new Indexer(opts.indexerUrl);
  }

  async put(dataHash: Hex, rec: SoulRecord): Promise<SoulRecord> {
    const memData = new MemData(rec.ciphertext as unknown as Buffer);
    const [tx, err] = await this.indexer.upload(memData, this.rpcUrl, this.signer);
    if (err) throw new Error(`0G upload failed for ${dataHash}: ${String(err)}`);
    const rootHash =
      "rootHash" in (tx as object)
        ? (tx as { rootHash: string }).rootHash
        : (tx as { rootHashes: string[] }).rootHashes[0];

    this.local.set(dataHash.toLowerCase(), { symmetricKey: rec.symmetricKey, rootHash });
    return { ...rec, rootHash };
  }

  async get(dataHash: Hex): Promise<SoulRecord | null> {
    const entry = this.local.get(dataHash.toLowerCase());
    if (!entry) return null;
    const [blob, err] = await this.indexer.downloadToBlob(entry.rootHash, { proof: true });
    if (err) throw new Error(`0G download failed for ${dataHash}: ${String(err)}`);
    if (!blob) return null;
    const buffer = await (blob as unknown as Blob).arrayBuffer();
    return {
      ciphertext: new Uint8Array(buffer),
      symmetricKey: entry.symmetricKey,
      rootHash: entry.rootHash,
    };
  }

  backend(): string {
    return "0g";
  }
}

export function makeStore(opts?: {
  backend?: "memory" | "0g";
  rpcUrl?: string;
  indexerUrl?: string;
  privateKey?: string;
}): SoulStore {
  const choice = opts?.backend ?? "memory";
  if (choice === "memory") return new InMemorySoulStore();
  if (!opts?.privateKey || !opts.rpcUrl || !opts.indexerUrl) {
    throw new Error(
      "ZeroGSoulStore requires rpcUrl, indexerUrl, and privateKey (backend=0g)"
    );
  }
  return new ZeroGSoulStore({
    rpcUrl: opts.rpcUrl,
    indexerUrl: opts.indexerUrl,
    privateKey: opts.privateKey,
  });
}
