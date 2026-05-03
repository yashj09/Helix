// GET /api/soul/[tokenId]/ciphertext
// Streams the encrypted soul blob for direct download.
// The user can try to open it — it's AES-GCM gibberish without the symmetric key.
// That *is* the proof the intelligence is there but private.

import { NextResponse } from "next/server";

import { getRelayer } from "@/lib/relayer";
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

    // Resolve tokenId → dataHash.
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
    const dataHash = (intelligentDatas as unknown as Array<{ dataHash: Hex }>)[0]?.dataHash;
    if (!dataHash) {
      return NextResponse.json({ error: "no intelligent data for token" }, { status: 404 });
    }

    // Stream ciphertext from the oracle.
    const oracleResp = await fetch(`${runtime.oracleUrl}/soul/${dataHash}/ciphertext`);
    if (!oracleResp.ok) {
      return NextResponse.json(
        { error: `oracle /ciphertext ${oracleResp.status}: ${await oracleResp.text()}` },
        { status: 502 }
      );
    }
    const buf = Buffer.from(await oracleResp.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="soul-${tokenId.toString()}.enc"`,
        "X-Soul-DataHash": dataHash,
        "X-Soul-Bytes": String(buf.length),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
