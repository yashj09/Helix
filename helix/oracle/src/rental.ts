// Thin viem client wrapping HelixSessionRental — the oracle reads `activeSessionOf` and
// calls `consumeMessage` when gating replies.
//
// Design:
//   - Reads are free and fast (just RPC view calls)
//   - consumeMessage costs ~0.0001 0G gas per call; we sign with the oracle's own key
//   - A rental is never mandatory: if HELIX_SESSION_RENTAL env var is unset, the oracle
//     runs "open mode" (replies always succeed — for local dev / demo without session gate)

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type PublicClient,
  type WalletClient,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RENTAL_ABI = [
  {
    type: "function",
    name: "activeSessionOf",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "renter", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "consumeMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "renter", type: "address" },
    ],
    outputs: [],
  },
] as const;

export interface RentalClient {
  address: Hex;
  activeSessionOf(tokenId: bigint, renter: Hex): Promise<bigint>;
  consumeMessage(tokenId: bigint, renter: Hex): Promise<Hex>;
}

export function makeRentalClient(opts: {
  address: Hex;
  rpcUrl: string;
  chainId: number;
  signerPrivateKey: Hex;
}): RentalClient {
  const chain = defineChain({
    id: opts.chainId,
    name: "0G",
    nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
    rpcUrls: { default: { http: [opts.rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(opts.rpcUrl) });
  const account = privateKeyToAccount(opts.signerPrivateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(opts.rpcUrl),
  });

  return {
    address: opts.address,
    async activeSessionOf(tokenId, renter) {
      return (await (publicClient as PublicClient).readContract({
        address: opts.address,
        abi: RENTAL_ABI,
        functionName: "activeSessionOf",
        args: [tokenId, renter],
      })) as bigint;
    },
    async consumeMessage(tokenId, renter) {
      const hash = await (walletClient as WalletClient).writeContract({
        address: opts.address,
        abi: RENTAL_ABI,
        functionName: "consumeMessage",
        args: [tokenId, renter],
        account,
        chain,
      });
      return hash;
    },
  };
}

/** Load a rental client from env — returns null if env is incomplete (open mode). */
export function maybeMakeRentalFromEnv(): RentalClient | null {
  const address = process.env.HELIX_SESSION_RENTAL as Hex | undefined;
  const rpcUrl = process.env.HELIX_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
  const chainId = Number(process.env.HELIX_CHAIN_ID ?? 16602);
  const pk = (process.env.ORACLE_PRIVATE_KEY ?? process.env.STORAGE_PRIVATE_KEY) as Hex | undefined;
  if (!address || !pk) return null;
  return makeRentalClient({ address, rpcUrl, chainId, signerPrivateKey: pk });
}
