// POST /api/merge
// Body: { parentA: {tokenId, dataHash}, parentB: {tokenId, dataHash}, childName: string }
// Returns childTokenId, childDataHash, txHash, explorer URL, child skill manifest.

import { NextResponse } from "next/server";
import { decodeEventLog } from "viem";

import { getRelayer } from "@/lib/relayer";
import { HelixSoulAbi } from "@/lib/abis";
import { prepareMerge } from "@/lib/oracle";
import { pubkey64For } from "@/lib/pubkey";
import type { Hex } from "@/lib/config";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      parentA?: { tokenId: number; dataHash: Hex };
      parentB?: { tokenId: number; dataHash: Hex };
      childName?: string;
    };
    if (
      !body.parentA?.dataHash ||
      !body.parentB?.dataHash ||
      typeof body.parentA.tokenId !== "number" ||
      typeof body.parentB.tokenId !== "number"
    ) {
      return NextResponse.json(
        { error: "parentA and parentB with {tokenId, dataHash} required" },
        { status: 400 }
      );
    }
    if (!body.childName) {
      return NextResponse.json({ error: "childName required" }, { status: 400 });
    }

    const relayer = getRelayer();
    const { publicClient, walletClient, account, chain, runtime } = relayer;
    const pk = process.env.RELAYER_PRIVATE_KEY as Hex;
    const pubkey64 = pubkey64For(pk);

    const prep = await prepareMerge({
      parentA: body.parentA,
      parentB: body.parentB,
      caller: { address: account.address, pubkey64 },
      recipient: { address: account.address, pubkey64 },
      childName: body.childName,
    });

    const hash = await walletClient.writeContract({
      address: runtime.deployment.soul,
      abi: HelixSoulAbi,
      functionName: "iMergeFrom",
      args: [
        BigInt(body.parentA.tokenId),
        BigInt(body.parentB.tokenId),
        account.address,
        prep.parentAProofs,
        prep.parentBProofs,
        prep.childProofs,
      ],
      chain,
      account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    let childTokenId: bigint | null = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: HelixSoulAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "Merged") {
          childTokenId = (decoded.args as { _childTokenId: bigint })._childTokenId;
          break;
        }
      } catch {}
    }

    return NextResponse.json({
      childTokenId: childTokenId ? childTokenId.toString() : null,
      childDataHash: prep.childDataHash,
      skills: prep.childSoulSummary.skills,
      mergeTxHash: hash,
      explorerUrl: `${runtime.explorerBase}/tx/${hash}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
