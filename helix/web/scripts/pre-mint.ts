#!/usr/bin/env node
// Pre-mint a small pool of template agents so the demo flow has instant first-paint.
//
// The first mint-of-the-day on 0G Storage can take 20–45s because the storage node cluster
// warms up. If that's what a judge sees as their first interaction, the demo is ruined.
// This script runs ahead of recording / before a demo window and warms the pipe.
//
// Writes the resulting pool to helix/web/.cache/premint.json so the demo UI could (future work)
// read from it as an "instant clone" option instead of hitting the oracle cold.
//
// Usage:
//   cd helix/web
//   RELAYER_PRIVATE_KEY=0x... ./node_modules/.bin/tsx scripts/pre-mint.ts [--count 3]

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

type MintResponse = {
  tokenId: string;
  dataHash: string;
  mintTxHash: string;
  mintExplorerUrl: string;
};

const TEMPLATES = [
  { name: "warmup-analyst", personality: "expert sentiment analyst", skills: ["sentiment-analysis", "news-parsing"] },
  { name: "warmup-trader", personality: "disciplined trader", skills: ["order-execution", "risk-management"] },
  { name: "warmup-writer", personality: "copywriter with taste", skills: ["copywriting", "editing"] },
  { name: "warmup-researcher", personality: "patient researcher", skills: ["summarization", "fact-checking"] },
];

async function post(url: string, body: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url} ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  const countArg = process.argv.indexOf("--count");
  const count =
    countArg >= 0 && process.argv[countArg + 1]
      ? Math.min(Number(process.argv[countArg + 1]), TEMPLATES.length)
      : 2;

  const webUrl = process.env.HELIX_WEB_URL ?? "http://localhost:3000";
  console.log(`[pre-mint] warming ${count} agent(s) via ${webUrl}/api/mint`);

  const pool: Array<{ template: (typeof TEMPLATES)[number]; result: MintResponse }> = [];

  for (let i = 0; i < count; i++) {
    const t = TEMPLATES[i];
    // Randomize the label so reruns don't collide with previous pool entries.
    const suffix = Math.random().toString(36).slice(2, 6);
    const label = `${t.name}-${suffix}`;
    const started = Date.now();
    try {
      const r = (await post(`${webUrl}/api/mint`, {
        name: label,
        personality: t.personality,
        skills: t.skills,
        registerLabel: false,
      })) as MintResponse;
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `[pre-mint] #${r.tokenId.padStart(4, " ")}  ${label.padEnd(28)}  (${elapsed}s)`
      );
      pool.push({ template: { ...t, name: label }, result: r });
    } catch (err) {
      console.error(`[pre-mint] failed for ${label}: ${(err as Error).message}`);
    }
  }

  const cacheDir = resolve(process.cwd(), ".cache");
  mkdirSync(cacheDir, { recursive: true });
  const outPath = resolve(cacheDir, "premint.json");
  writeFileSync(outPath, JSON.stringify({ generatedAt: Date.now(), pool }, null, 2));
  console.log(`[pre-mint] wrote ${pool.length} entries to ${outPath}`);
}

main().catch((err) => {
  console.error("[pre-mint] fatal:", err);
  process.exit(1);
});
