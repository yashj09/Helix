// viem client factory + contract helpers.

import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
  parseAbi,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { HelixConfig, UserConfig } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadAbi(name: string): unknown[] {
  const abiPath = resolve(here, "abi", `${name}.json`);
  return JSON.parse(readFileSync(abiPath, "utf8")) as unknown[];
}

export const HelixSoulAbi = loadAbi("HelixSoul") as readonly unknown[];
export const HelixLineageAbi = loadAbi("HelixLineage") as readonly unknown[];
export const HelixNamesAbi = loadAbi("HelixNames") as readonly unknown[];

export function zgChain(id: number, rpc: string) {
  return defineChain({
    id,
    name: "0G Galileo",
    nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: {
      default: { name: "ChainScan", url: "https://chainscan-galileo.0g.ai" },
    },
  });
}

export interface ConnectedClients {
  chain: ReturnType<typeof zgChain>;
  account: ReturnType<typeof privateKeyToAccount>;
  publicClient: PublicClient;
  walletClient: WalletClient;
}

export function connect(cfg: HelixConfig, user: UserConfig): ConnectedClients {
  const chain = zgChain(cfg.chainId, cfg.rpcUrl);
  const account = privateKeyToAccount(user.privateKey);
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  return { chain, account, publicClient, walletClient };
}

export { parseAbi };
export type { Hex };
