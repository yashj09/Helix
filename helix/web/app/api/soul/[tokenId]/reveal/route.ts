// POST /api/soul/[tokenId]/reveal
// Owner-only: decrypts the soul and returns the plaintext JSON.
//
// In the hosted demo, the relayer is the owner of every minted token, so this effectively
// always succeeds for judges. Still gate on an on-chain owner check so behavior is correct
// if anyone ever transfers a token away from the relayer wallet.

import { NextResponse } from "next/server";

import { getRelayer } from "@/lib/relayer";
import { loadRuntime } from "@/lib/config";
import type { Hex } from "@/lib/config";

const ERC7857_TOKEN_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "intelligentDatasOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "dataDescription", type: "string" },
          { name: "dataHash", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  const { tokenId: tokenIdStr } = await params;
  const tokenId = BigInt(tokenIdStr);
  try {
    const runtime = loadRuntime();
    const { publicClient, account } = getRelayer();

    const owner = (await publicClient.readContract({
      address: runtime.deployment.soul,
      abi: ERC7857_TOKEN_ABI,
      functionName: "ownerOf",
      args: [tokenId],
    })) as Hex;

    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      return NextResponse.json(
        {
          error: "token is not owned by the relayer wallet",
          hint:
            "In the hosted demo, decrypt only works for relayer-owned tokens. " +
            "Mint a new agent to reveal its soul.",
          owner,
          relayer: account.address,
        },
        { status: 403 }
      );
    }

    const intelligentDatas = await publicClient.readContract({
      address: runtime.deployment.soul,
      abi: ERC7857_TOKEN_ABI,
      functionName: "intelligentDatasOf",
      args: [tokenId],
    });
    const dataHash = (intelligentDatas as unknown as Array<{ dataHash: Hex }>)[0]?.dataHash;
    if (!dataHash) {
      return NextResponse.json({ error: "no intelligent data for token" }, { status: 404 });
    }

    const oracleResp = await fetch(`${runtime.oracleUrl}/soul/${dataHash}/reveal`, {
      method: "POST",
    });
    const text = await oracleResp.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
    return NextResponse.json(body, { status: oracleResp.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
