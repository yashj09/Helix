// Soul storage — encrypted blob persistence.
//
// Two backends are supported:
//   - "memory" (default): in-process Map, for local dev + tests.
//   - "0g": real 0G Storage via @0gfoundation/0g-ts-sdk.
//
// Both backends expose the same put/get API keyed by `dataHash`. In both cases the oracle
// retains the plaintext symmetric key so it can decrypt/re-encrypt for new recipients.
// Symmetric keys are *always* kept locally (in-memory) — 0G Storage holds only ciphertext.
//
// In addition to the in-memory Map, a **sidecar on-disk cache** persists the key material
// across oracle restarts and multiple oracle processes running side by side. Without this,
// minting in one session and merging in another fails ("soul key not in oracle cache") —
// which is one of the most confusing surprises for a demo. The cache file is AES-256-GCM
// encrypted with a key derived from ORACLE_PRIVATE_KEY, so leaking the file without the
// signer key is useless.

import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import { gcm } from "@noble/ciphers/aes";
import { sha256 } from "@noble/hashes/sha2";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
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

// ─────────────────────────────────────────────────────────────────────────
//  Persistent key cache — the sidecar that survives restarts
// ─────────────────────────────────────────────────────────────────────────

/**
 * KeyCache persists `{dataHash → {symmetricKey, rootHash?}}` pairs on disk, encrypted with
 * an AES-256-GCM key derived from the oracle's signer private key. Writes are atomic (tmp
 * file + rename) so crashes don't corrupt the store. Reads happen once at startup.
 *
 * File format (after AES-GCM decrypt):
 *   JSON { version: 1, entries: [ {dataHash, symKeyHex, rootHash?}, ... ] }
 */
class KeyCache {
  private readonly path: string;
  private readonly encKey: Uint8Array;
  private readonly mem = new Map<string, { symmetricKey: Uint8Array; rootHash?: string }>();

  constructor(path: string, derivationSecret: string) {
    this.path = path;
    // Derive AES key: sha256(derivationSecret || "helix-key-cache/v1")
    this.encKey = sha256(
      new TextEncoder().encode(derivationSecret + "|helix-key-cache/v1")
    );
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path);
      const nonce = raw.subarray(0, 12);
      const body = raw.subarray(12);
      const cipher = gcm(this.encKey, nonce);
      const plaintext = cipher.decrypt(body);
      const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as {
        version: number;
        entries: Array<{ dataHash: string; symKeyHex: string; rootHash?: string }>;
      };
      if (parsed.version !== 1) return;
      for (const e of parsed.entries) {
        this.mem.set(e.dataHash.toLowerCase(), {
          symmetricKey: hexToBytes(e.symKeyHex),
          rootHash: e.rootHash,
        });
      }
      // eslint-disable-next-line no-console
      console.log(`[key-cache] loaded ${this.mem.size} keys from ${this.path}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[key-cache] could not decrypt ${this.path}: ${(err as Error).message}`);
    }
  }

  private flushToDisk(): void {
    const entries = Array.from(this.mem.entries()).map(([dataHash, v]) => ({
      dataHash,
      symKeyHex: bytesToHex(v.symmetricKey),
      rootHash: v.rootHash,
    }));
    const plaintext = new TextEncoder().encode(JSON.stringify({ version: 1, entries }));
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const cipher = gcm(this.encKey, nonce);
    const ciphertext = cipher.encrypt(plaintext);
    const out = new Uint8Array(12 + ciphertext.length);
    out.set(nonce, 0);
    out.set(ciphertext, 12);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, out);
    renameSync(tmp, this.path); // atomic on POSIX
  }

  set(dataHash: Hex, symmetricKey: Uint8Array, rootHash?: string): void {
    this.mem.set(dataHash.toLowerCase(), { symmetricKey, rootHash });
    // Reload from disk before flushing, in case another oracle wrote in between — gives
    // multi-process setups a best-effort merge. Not a substitute for a real lock, but
    // prevents simple "two oracles clobbering each other" while each sees the other's mints.
    this.reloadIntoMem();
    this.mem.set(dataHash.toLowerCase(), { symmetricKey, rootHash }); // our write wins for this key
    this.flushToDisk();
  }

  get(dataHash: Hex): { symmetricKey: Uint8Array; rootHash?: string } | null {
    // Refresh from disk on read to pick up entries written by sibling oracle processes.
    if (existsSync(this.path)) this.reloadIntoMem();
    return this.mem.get(dataHash.toLowerCase()) ?? null;
  }

  private reloadIntoMem(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path);
      const nonce = raw.subarray(0, 12);
      const body = raw.subarray(12);
      const cipher = gcm(this.encKey, nonce);
      const plaintext = cipher.decrypt(body);
      const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as {
        version: number;
        entries: Array<{ dataHash: string; symKeyHex: string; rootHash?: string }>;
      };
      for (const e of parsed.entries) {
        if (!this.mem.has(e.dataHash.toLowerCase())) {
          this.mem.set(e.dataHash.toLowerCase(), {
            symmetricKey: hexToBytes(e.symKeyHex),
            rootHash: e.rootHash,
          });
        }
      }
    } catch {
      // Corrupted / partial write — ignore this refresh and keep our in-memory view.
    }
  }

  size(): number {
    return this.mem.size;
  }
}

function hexToBytes(h: string): Uint8Array {
  const clean = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
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
  private readonly cache: KeyCache;

  constructor(opts: {
    rpcUrl: string;
    indexerUrl: string;
    privateKey: string;
    cachePath: string;
  }) {
    this.rpcUrl = opts.rpcUrl;
    const provider = new ethers.JsonRpcProvider(opts.rpcUrl);
    this.signer = new ethers.Wallet(opts.privateKey, provider);
    this.indexer = new Indexer(opts.indexerUrl);
    this.cache = new KeyCache(opts.cachePath, opts.privateKey);
  }

  async put(dataHash: Hex, rec: SoulRecord): Promise<SoulRecord> {
    const memData = new MemData(rec.ciphertext as unknown as Buffer);
    const [tx, err] = await this.indexer.upload(memData, this.rpcUrl, this.signer);
    if (err) throw new Error(`0G upload failed for ${dataHash}: ${String(err)}`);
    const rootHash =
      "rootHash" in (tx as object)
        ? (tx as { rootHash: string }).rootHash
        : (tx as { rootHashes: string[] }).rootHashes[0];

    this.cache.set(dataHash, rec.symmetricKey, rootHash);
    return { ...rec, rootHash };
  }

  async get(dataHash: Hex): Promise<SoulRecord | null> {
    const entry = this.cache.get(dataHash);
    if (!entry || !entry.rootHash) return null;
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
  cachePath?: string;
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
    cachePath: opts.cachePath ?? "./helix-oracle-keys.enc",
  });
}
