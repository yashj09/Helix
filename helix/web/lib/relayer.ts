// Server-only relayer that signs txs against the deployed Helix contracts.
// Reads RELAYER_PRIVATE_KEY from env; no key ever touches the client.

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadRuntime, type HelixRuntime } from "./config";

let cached: {
  runtime: HelixRuntime;
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: ReturnType<typeof privateKeyToAccount>;
  chain: ReturnType<typeof defineChain>;
} | null = null;

export function getRelayer(): NonNullable<typeof cached> {
  if (cached) return cached;

  const runtime = loadRuntime();
  const pk = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
  if (!pk) {
    throw new Error(
      "RELAYER_PRIVATE_KEY is not set. Set it in helix/web/.env.local to enable relayer-signed txs."
    );
  }
  const chain = defineChain({
    id: runtime.chainId,
    name: "0G Galileo",
    nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
    rpcUrls: { default: { http: [runtime.rpcUrl] } },
    blockExplorers: {
      default: { name: "ChainScan", url: runtime.explorerBase },
    },
  });
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain, transport: http(runtime.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(runtime.rpcUrl),
  });

  cached = { runtime, publicClient, walletClient, account, chain };
  return cached;
}
