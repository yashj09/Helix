// GET /api/health
// Same-origin proxy to the oracle's /health endpoint so browser code doesn't hit CORS.
// Returns the oracle's JSON verbatim, plus a note about the web server's view of config.

import { NextResponse } from "next/server";
import { loadRuntime } from "@/lib/config";

export async function GET() {
  const runtime = loadRuntime();
  try {
    const r = await fetch(runtime.oracleUrl + "/health");
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: `oracle /health ${r.status}` },
        { status: 502 }
      );
    }
    const body = (await r.json()) as Record<string, unknown>;
    return NextResponse.json({ ...body, oracleUrl: runtime.oracleUrl });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `oracle unreachable at ${runtime.oracleUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 502 }
    );
  }
}
