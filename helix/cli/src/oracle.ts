import type { Hex } from "./config.js";

export interface PrepareMintResp {
  intelligentData: { dataDescription: string; dataHash: Hex };
  proof: ProofEnvelope;
  dataHash: Hex;
  soulSummary: { name: string; skills: string[]; provenance: unknown };
}

export interface PrepareMergeResp {
  parentAProofs: ProofEnvelope[];
  parentBProofs: ProofEnvelope[];
  childProofs: ProofEnvelope[];
  childIntelligentData: { dataDescription: string; dataHash: Hex };
  childDataHash: Hex;
  childSoulSummary: {
    name: string;
    skills: { name: string; weight: number; from: string }[];
    provenance: unknown;
  };
}

export interface ProofEnvelope {
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
}

export class OracleClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<{ ok: boolean; oracle: Hex; oraclePubkey: Hex }> {
    const r = await fetch(this.baseUrl + "/health");
    if (!r.ok) throw new Error(`oracle /health ${r.status}`);
    return (await r.json()) as { ok: boolean; oracle: Hex; oraclePubkey: Hex };
  }

  async prepareMint(input: {
    name: string;
    personality: string;
    skills: string[];
    tools?: string[];
    model?: string;
    recipient: { address: Hex; pubkey64: Hex };
  }): Promise<PrepareMintResp> {
    return this.postJSON<PrepareMintResp>("/prepareMint", input);
  }

  async prepareMerge(input: {
    parentA: { dataHash: Hex; tokenId: number };
    parentB: { dataHash: Hex; tokenId: number };
    caller: { address: Hex; pubkey64: Hex };
    recipient: { address: Hex; pubkey64: Hex };
    childName: string;
  }): Promise<PrepareMergeResp> {
    return this.postJSON<PrepareMergeResp>("/prepareMerge", input);
  }

  private async postJSON<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(this.baseUrl + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const text = await r.text();
      // Try to pretty-print structured errors (`{error, hint, missing}`) so the user sees the
      // actionable hint, not the raw JSON blob.
      try {
        const parsed = JSON.parse(text) as { error?: string; hint?: string; missing?: unknown };
        if (parsed.error) {
          const parts: string[] = [`oracle ${path} ${r.status}: ${parsed.error}`];
          if (parsed.missing) parts.push(`  missing: ${JSON.stringify(parsed.missing)}`);
          if (parsed.hint) parts.push(`  hint: ${parsed.hint}`);
          throw new Error(parts.join("\n"));
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("oracle ")) throw e;
        // fall through to raw text
      }
      throw new Error(`oracle ${path} ${r.status}: ${text}`);
    }
    return (await r.json()) as T;
  }
}
