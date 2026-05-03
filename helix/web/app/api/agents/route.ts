// GET /api/agents
// Same-origin proxy to the indexer's HTTP endpoint. The indexer holds an in-memory registry
// of every minted/merged agent, populated from chain events (Transfer/Merged/NameRegistered
// /TextChanged/RoyaltyFlowed). Response shape: { agents: AgentSummary[], count, asOf }.
//
// Also enriches each agent with dataHash by calling HelixSoul.intelligentDatasOf — the
// indexer doesn't track dataHash (it's not in event args), but the marketplace modal needs
// it to send /api/reply calls. We read on-demand + cache in-process.

import { NextResponse } from "next/server";
import { createPublicClient, http, type Hex } from "viem";
import { loadRuntime } from "@/lib/config";

/** In-process cache of tokenId → dataHash. Mints don't change dataHash after creation. */
const dataHashCache = new Map<number, Hex>();

const HELIX_SOUL_READ_ABI = [
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

type IndexerAgent = {
  tokenId: number;
  label: string | null;
  addr: string | null;
  dataHash: string | null;
  skills: string[];
  lineage: { parentA: number; parentB: number } | null;
  mintTxHash: string | null;
  mintedAt: number;
  earned: number;
};

export async function GET(): Promise<Response> {
  const runtime = loadRuntime();
  const indexerHttp = process.env.HELIX_INDEXER_HTTP ?? "http://localhost:8789";
  try {
    const r = await fetch(indexerHttp + "/agents", { cache: "no-store" });
    if (!r.ok) {
      return NextResponse.json(
        { error: `indexer /agents ${r.status}` },
        { status: 502 }
      );
    }
    const body = (await r.json()) as {
      agents: IndexerAgent[];
      count: number;
      asOf: number;
    };

    // Enrich each agent with its dataHash so the marketplace modal can call /api/reply
    // without a second round-trip per open. Missing tokens resolve to null and the modal
    // treats them as "chat disabled" with a friendly message.
    const missing = body.agents.filter((a) => !dataHashCache.has(a.tokenId));
    if (missing.length > 0) {
      const client = createPublicClient({
        chain: {
          id: runtime.chainId,
          name: "0G Galileo",
          nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
          rpcUrls: { default: { http: [runtime.rpcUrl] } },
        },
        transport: http(runtime.rpcUrl),
      });
      // Read sequentially to keep the RPC gentle; small demo-sized inventory.
      for (const a of missing) {
        try {
          const datas = (await client.readContract({
            address: runtime.deployment.soul,
            abi: HELIX_SOUL_READ_ABI,
            functionName: "intelligentDatasOf",
            args: [BigInt(a.tokenId)],
          })) as { dataDescription: string; dataHash: Hex }[];
          if (datas.length > 0) {
            dataHashCache.set(a.tokenId, datas[0].dataHash);
          }
        } catch {
          // Token removed/invalid — skip; marketplace shows it without chat.
        }
      }
    }
    const agents = body.agents.map((a) => ({
      ...a,
      dataHash: dataHashCache.get(a.tokenId) ?? null,
    }));

    return NextResponse.json(
      { agents, count: body.count, asOf: body.asOf },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "indexer unreachable at " +
          indexerHttp +
          ": " +
          (err instanceof Error ? err.message : String(err)),
      },
      { status: 502 }
    );
  }
}
