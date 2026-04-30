// GET /api/axl/alice, GET /api/axl/bob
// Returns the AXL node's /topology so the browser can get the pubkey to write into iNFT records.

import { NextResponse } from "next/server";
import { loadRuntime } from "@/lib/config";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ which: string }> }
) {
  const { which } = await params;
  if (which !== "alice" && which !== "bob") {
    return NextResponse.json({ ok: false, error: "which must be alice or bob" }, { status: 400 });
  }
  const runtime = loadRuntime();
  const base = which === "alice" ? runtime.axlUrls.alice : runtime.axlUrls.bob;
  try {
    const r = await fetch(base + "/topology");
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: `axl/${which} /topology ${r.status}` },
        { status: 502 }
      );
    }
    const body = (await r.json()) as Record<string, unknown>;
    return NextResponse.json({ ok: true, which, baseUrl: base, ...body });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `axl node '${which}' unreachable at ${base}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 }
    );
  }
}
