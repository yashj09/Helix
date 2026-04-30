// Soul schema and merge logic.
//
// A "soul" is the encrypted payload that gives an iNFT its identity, skills, and memory pointers.
// Souls are stored encrypted on 0G Storage; the oracle briefly sees plaintext during merge.

import type { Hex } from "./types.js";

export interface Skill {
  name: string;
  weight: number; // 0..1
  sourceParent?: "A" | "B" | "root";
}

export interface Soul {
  version: 1;
  name: string;
  personality: string;
  skills: Skill[];
  memoryRefs: {
    kvNamespace: string;
    logStream: string;
  };
  toolManifest: string[];
  model: string; // e.g. "qwen3.6-plus"
  provenance: {
    kind: "root" | "merged";
    parentA?: number;
    parentB?: number;
    mergedAt?: number;
  };
}

export function makeRootSoul(input: {
  name: string;
  personality: string;
  skills: string[];
  tools?: string[];
  model?: string;
}): Soul {
  const slug = input.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  return {
    version: 1,
    name: input.name,
    personality: input.personality,
    skills: input.skills.map((s) => ({ name: s, weight: 1.0, sourceParent: "root" as const })),
    memoryRefs: {
      kvNamespace: `helix-${slug}-${Date.now()}`,
      logStream: `0x${randomHex(32)}`,
    },
    toolManifest: input.tools ?? [],
    model: input.model ?? "qwen3.6-plus",
    provenance: { kind: "root" },
  };
}

/**
 * Merge two souls into a child. Skills are inherited with weight/2 so repeated merges don't
 * blow up. Personalities are concatenated; a real impl would use an LLM to blend them.
 */
export function mergeSouls(a: Soul, b: Soul, opts: {
  parentATokenId: number;
  parentBTokenId: number;
  childName: string;
}): Soul {
  return {
    version: 1,
    name: opts.childName,
    personality: `Blended of "${a.name}" and "${b.name}". ${a.personality} / ${b.personality}`,
    skills: [
      ...a.skills.map((s) => ({ ...s, weight: s.weight * 0.5, sourceParent: "A" as const })),
      ...b.skills.map((s) => ({ ...s, weight: s.weight * 0.5, sourceParent: "B" as const })),
    ],
    memoryRefs: {
      kvNamespace: `helix-merged-${opts.parentATokenId}-${opts.parentBTokenId}-${Date.now()}`,
      logStream: `0x${randomHex(32)}`,
    },
    toolManifest: Array.from(new Set([...a.toolManifest, ...b.toolManifest])),
    model: a.model,
    provenance: {
      kind: "merged",
      parentA: opts.parentATokenId,
      parentB: opts.parentBTokenId,
      mergedAt: Math.floor(Date.now() / 1000),
    },
  };
}

function randomHex(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString("hex");
}

/** Stable dataHash used as IntelligentData.dataHash and on-chain reference. */
export function soulCiphertextHash(hash: Hex): Hex {
  return hash;
}
