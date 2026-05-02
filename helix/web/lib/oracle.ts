// Tiny client for the local oracle HTTP API (helix/oracle/src/server.ts).
// The oracle owns encryption + proof signing; the web app only sends shapes over HTTP.

import { loadRuntime } from "./config";
import type { Hex } from "./config";

export type ProofEnvelope = {
  accessProof: {
    dataHash: Hex;
    targetPubkey: Hex;
    nonce: Hex;
    proof: Hex;
  };
  ownershipProof: {
    oracleType: number;
    dataHash: Hex;
    sealedKey: Hex;
    targetPubkey: Hex;
    nonce: Hex;
    proof: Hex;
  };
};

export interface PrepareMintResult {
  intelligentData: { dataDescription: string; dataHash: Hex };
  proof: ProofEnvelope;
  dataHash: Hex;
}

export interface PrepareMergeResult {
  parentAProofs: ProofEnvelope[];
  parentBProofs: ProofEnvelope[];
  childProofs: ProofEnvelope[];
  childIntelligentData: { dataDescription: string; dataHash: Hex };
  childDataHash: Hex;
  childSoulSummary: {
    name: string;
    skills: Array<{ name: string; weight: number; from: string }>;
  };
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(loadRuntime().oracleUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`oracle ${path} ${r.status}: ${text}`);
  }
  return (await r.json()) as T;
}

export async function oracleHealth(): Promise<{
  ok: boolean;
  oracle: Hex;
  oraclePubkey: Hex;
  storage: string;
  signedProofs: boolean;
}> {
  const r = await fetch(loadRuntime().oracleUrl + "/health");
  if (!r.ok) throw new Error(`oracle /health ${r.status}`);
  return (await r.json()) as {
    ok: boolean;
    oracle: Hex;
    oraclePubkey: Hex;
    storage: string;
    signedProofs: boolean;
  };
}

export function prepareMint(input: {
  name: string;
  personality: string;
  skills: string[];
  tools?: string[];
  model?: string;
  recipient: { address: Hex; pubkey64: Hex };
}): Promise<PrepareMintResult> {
  return postJSON("/prepareMint", input);
}

export function prepareMerge(input: {
  parentA: { dataHash: Hex; tokenId: number };
  parentB: { dataHash: Hex; tokenId: number };
  caller: { address: Hex; pubkey64: Hex };
  recipient: { address: Hex; pubkey64: Hex };
  childName: string;
}): Promise<PrepareMergeResult> {
  return postJSON("/prepareMerge", input);
}
