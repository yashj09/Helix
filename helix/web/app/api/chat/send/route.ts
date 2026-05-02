// POST /api/chat/send
// Body: { fromNode: "alice" | "bob", toLabel: string, fromTokenId: number, text: string }
//
// 1. Resolve the recipient's AXL pubkey from HelixNames.text(tokenId, "axl.pubkey").
// 2. POST a Helix message envelope to the chosen local AXL node's /send endpoint.
// 3. Return the envelope so the UI can render the chat bubble.
//
// Note: this assumes two AXL nodes are running locally (ports 9102, 9202). The "hosted" mode
// will either (a) proxy to a VPS where the nodes live, or (b) skip the real mesh and do a
// local-loopback chat simulation for judges who don't clone the repo.

import { NextResponse } from "next/server";

import { getRelayer } from "@/lib/relayer";
import { HelixNamesAbi } from "@/lib/abis";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      fromNode?: "alice" | "bob";
      toLabel?: string;
      fromTokenId?: number;
      text?: string;
    };
    if (!body.fromNode || !body.toLabel || typeof body.fromTokenId !== "number" || !body.text) {
      return NextResponse.json(
        { error: "fromNode, toLabel, fromTokenId, text required" },
        { status: 400 }
      );
    }

    const { publicClient, runtime } = getRelayer();

    // Resolve the label → tokenId → axl.pubkey.
    const [toTokenId] = (await publicClient.readContract({
      address: runtime.deployment.names,
      abi: HelixNamesAbi,
      functionName: "resolveFull",
      args: [body.toLabel],
    })) as [bigint, string];

    const rawPubkey = (await publicClient.readContract({
      address: runtime.deployment.names,
      abi: HelixNamesAbi,
      functionName: "text",
      args: [toTokenId, "axl.pubkey"],
    })) as string;
    const pubkey = rawPubkey.replace(/^0x/, "");
    if (!/^[0-9a-fA-F]{64}$/.test(pubkey)) {
      return NextResponse.json(
        { error: `label "${body.toLabel}" has no valid axl.pubkey text record` },
        { status: 400 }
      );
    }

    // Build Helix envelope.
    const envelope = {
      v: 1,
      kind: "greet",
      fromTokenId: body.fromTokenId,
      toTokenId: Number(toTokenId),
      text: body.text,
      nonce: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    };

    // Deliver via the chosen local AXL node.
    const axlUrl = body.fromNode === "alice" ? runtime.axlUrls.alice : runtime.axlUrls.bob;
    const r = await fetch(axlUrl + "/send", {
      method: "POST",
      headers: {
        "X-Destination-Peer-Id": pubkey,
        "Content-Type": "application/octet-stream",
      },
      body: JSON.stringify(envelope),
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: `AXL /send ${r.status}: ${await r.text()}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      envelope,
      deliveredVia: axlUrl,
      resolvedPubkey: pubkey,
      toTokenId: Number(toTokenId),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
