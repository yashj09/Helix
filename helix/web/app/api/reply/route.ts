// POST /api/reply
// Same-origin proxy to the oracle's /reply endpoint.
//
// Body: { dataHash, history: [{role, content}, ...], maxTokens? }
// Returns: { text, fallback, model, agent: {name, skills} }

import { NextResponse } from "next/server";
import { loadRuntime } from "@/lib/config";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const r = await fetch(loadRuntime().oracleUrl + "/reply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text };
    }
    return NextResponse.json(json, { status: r.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
