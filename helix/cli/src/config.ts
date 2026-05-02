// Runtime configuration: reads addresses from the deployment JSON written by the Foundry script,
// plus user secrets from env. No interactive prompts in this phase — keep it scriptable.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Hex = `0x${string}`;

export interface HelixConfig {
  chainId: number;
  rpcUrl: string;
  oracleUrl: string;
  explorerBase: string;
  contracts: {
    verifier: Hex;
    soul: Hex;
    lineage: Hex;
    names?: Hex;
    oracleSigner: Hex;
    treasury: Hex;
  };
}

export interface UserConfig {
  privateKey: Hex;
}

function helixRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // cli/src → cli → helix
  return resolve(here, "..", "..");
}

export function loadConfig(): HelixConfig {
  const chainId = Number(process.env.HELIX_CHAIN_ID ?? 16602);
  const rpcUrl = process.env.HELIX_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
  const oracleUrl = process.env.HELIX_ORACLE_URL ?? "http://localhost:8787";
  const explorerBase =
    process.env.HELIX_EXPLORER ?? "https://chainscan-galileo.0g.ai";

  const deploymentPath = resolve(
    helixRoot(),
    "contracts",
    "deployments",
    `${chainId}.json`
  );
  if (!existsSync(deploymentPath)) {
    throw new Error(
      `No deployment file at ${deploymentPath}. Run \`forge script script/Deploy.s.sol\` first, ` +
        `or override HELIX_CONTRACTS_JSON.`
    );
  }

  const overridePath = process.env.HELIX_CONTRACTS_JSON;
  const dep = JSON.parse(
    readFileSync(overridePath ?? deploymentPath, "utf8")
  ) as {
    chainId: number;
    verifier: Hex;
    soul: Hex;
    lineage: Hex;
    names?: Hex;
    oracle: Hex;
    treasury: Hex;
  };

  return {
    chainId,
    rpcUrl,
    oracleUrl,
    explorerBase,
    contracts: {
      verifier: dep.verifier,
      soul: dep.soul,
      lineage: dep.lineage,
      names: dep.names,
      oracleSigner: dep.oracle,
      treasury: dep.treasury,
    },
  };
}

export function loadUser(): UserConfig {
  const pk = process.env.HELIX_PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      "HELIX_PRIVATE_KEY is required (your user wallet — separate from the oracle)."
    );
  }
  if (!pk.startsWith("0x") || pk.length !== 66) {
    throw new Error("HELIX_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.");
  }
  return { privateKey: pk as Hex };
}
