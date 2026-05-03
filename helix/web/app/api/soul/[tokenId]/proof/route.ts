// GET /api/soul/[tokenId]/proof
// Returns the full ERC-7857 "proof trail" for a token:
//   - On-chain commitment: dataHash + dataDescription from HelixSoul.intelligentDatasOf
//   - 0G Storage rootHash + ciphertextBytes from the oracle
//   - Owner address (for the "decrypt" button gate on the client side)
//
// This backs the foldable "View ERC-7857 proof" panel on each AgentCard.

import { NextResponse } from "next/server";

import { getRelayer } from "@/lib/relayer";
import { HelixSoulAbi } from "@/lib/abis";
import { loadRuntime } from "@/lib/config";
import type { Hex } from "@/lib/config";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  const { tokenId: tokenIdStr } = await params;
  const tokenId = BigInt(tokenIdStr);
  try {
    const runtime = loadRuntime();
    const { publicClient } = getRelayer();

    // On-chain commitment.
    const iDatas = (await publicClient.readContract({
      address: runtime.deployment.soul,
      abi: HelixSoulAbi,
      functionName: "ownerOf",
      args: [tokenId],
    })) as Hex;
    const owner = iDatas;

    // Read intelligentDatasOf — returns IntelligentData[] with {dataDescription, dataHash}.
    // The ABI exposes this via the ERC7857Metadata interface — we need to add it if missing.
    const intelligentDatas = await publicClient.readContract({
      address: runtime.deployment.soul,
      abi: [
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
      ] as const,
      functionName: "intelligentDatasOf",
      args: [tokenId],
    });
    const data = (intelligentDatas as Array<{ dataDescription: string; dataHash: Hex }>)[0];
    if (!data) {
      return NextResponse.json({ error: "no intelligent data for token" }, { status: 404 });
    }

    // Oracle-side artifacts.
    const oracleUrl = loadRuntime().oracleUrl;
    let storageProof: {
      rootHash: string | null;
      ciphertextBytes: number;
      storage: string;
    } = { rootHash: null, ciphertextBytes: 0, storage: "unknown" };
    try {
      const r = await fetch(`${oracleUrl}/soul/${data.dataHash}/proof`);
      if (r.ok) {
        const body = (await r.json()) as typeof storageProof;
        storageProof = body;
      }
    } catch {
      // Best-effort: on-chain proof still renders even if the oracle is down.
    }

    return NextResponse.json({
      tokenId: tokenId.toString(),
      owner,
      onchain: {
        dataHash: data.dataHash,
        dataDescription: data.dataDescription,
      },
      storage: storageProof,
      explorerTokenUrl: `${runtime.explorerBase}/address/${runtime.deployment.soul}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
