// POST /api/invoke
// Body: { tokenId: number, amount: string }  // amount in 0G (e.g. "0.01")
// Calls HelixLineage.distributeInvocationRevenue, which cascades royalties to ancestors.

import { NextResponse } from "next/server";
import { parseEther } from "viem";

import { getRelayer } from "@/lib/relayer";
import { HelixLineageAbi } from "@/lib/abis";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { tokenId?: number; amount?: string };
    if (typeof body.tokenId !== "number") {
      return NextResponse.json({ error: "tokenId (number) required" }, { status: 400 });
    }
    const amountStr = body.amount ?? "0.01";
    const wei = parseEther(amountStr);

    const { publicClient, walletClient, account, chain, runtime } = getRelayer();

    const hash = await walletClient.writeContract({
      address: runtime.deployment.lineage,
      abi: HelixLineageAbi,
      functionName: "distributeInvocationRevenue",
      args: [BigInt(body.tokenId)],
      value: wei,
      chain,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });

    return NextResponse.json({
      invokeTxHash: hash,
      amount: amountStr,
      explorerUrl: `${runtime.explorerBase}/tx/${hash}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
