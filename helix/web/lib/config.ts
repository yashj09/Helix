// Shared runtime config for the web app.
// Reads contract addresses from helix/contracts/deployments/16602.json — single source of truth.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type Hex = `0x${string}`;

export interface HelixDeployment {
  chainId: number;
  verifier: Hex;
  soul: Hex;
  lineage: Hex;
  names: Hex;
  oracle: Hex;
  treasury: Hex;
  admin: Hex;
}

export interface HelixRuntime {
  chainId: number;
  rpcUrl: string;
  explorerBase: string;
  oracleUrl: string;
  indexerWsUrl: string;
  relayerMode: boolean;
  axlUrls: { alice: string; bob: string };
  deployment: HelixDeployment;
}

/** Server-side only — reads deployment JSON from disk. */
export function loadRuntime(): HelixRuntime {
  const chainId = Number(process.env.HELIX_CHAIN_ID ?? 16602);
  const depPath =
    process.env.HELIX_DEPLOYMENT_PATH ??
    resolve(process.cwd(), "..", "contracts", "deployments", `${chainId}.json`);
  const deployment = JSON.parse(readFileSync(depPath, "utf8")) as HelixDeployment;

  return {
    chainId,
    rpcUrl: process.env.HELIX_RPC_URL ?? "https://evmrpc-testnet.0g.ai",
    explorerBase: process.env.HELIX_EXPLORER ?? "https://chainscan-galileo.0g.ai",
    oracleUrl: process.env.HELIX_ORACLE_URL ?? "http://localhost:8787",
    indexerWsUrl: process.env.NEXT_PUBLIC_INDEXER_WS ?? "ws://localhost:8788",
    relayerMode: (process.env.HELIX_RELAYER_MODE ?? "true") === "true",
    axlUrls: {
      alice: process.env.HELIX_AXL_ALICE ?? "http://localhost:9102",
      bob: process.env.HELIX_AXL_BOB ?? "http://localhost:9202",
    },
    deployment,
  };
}

/** Client-safe subset. */
export function publicRuntime(): {
  chainId: number;
  rpcUrl: string;
  explorerBase: string;
  indexerWsUrl: string;
  deployment: HelixDeployment;
} {
  const r = loadRuntime();
  return {
    chainId: r.chainId,
    rpcUrl: r.rpcUrl,
    explorerBase: r.explorerBase,
    indexerWsUrl: r.indexerWsUrl,
    deployment: r.deployment,
  };
}
