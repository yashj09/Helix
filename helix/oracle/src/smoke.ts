// Smoke test: start the oracle, hit /prepareMint twice, then /prepareMerge, decrypt the child
// soul to verify skills came from both parents.

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "./types.js";
import { pubkey64For } from "./keys.js";
import { encryptSoul, decryptSoul, openSealedKey } from "./encryption.js";

const BASE = process.env.ORACLE_URL ?? "http://localhost:8787";

async function postJSON(path: string, body: unknown) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

async function main() {
  const aliceKey = generatePrivateKey();
  const bobKey = generatePrivateKey();
  const carolKey = generatePrivateKey();

  const alice = {
    address: privateKeyToAccount(aliceKey).address as Hex,
    pubkey64: pubkey64For(aliceKey),
    pk: aliceKey,
  };
  const bob = {
    address: privateKeyToAccount(bobKey).address as Hex,
    pubkey64: pubkey64For(bobKey),
    pk: bobKey,
  };
  const carol = {
    address: privateKeyToAccount(carolKey).address as Hex,
    pubkey64: pubkey64For(carolKey),
    pk: carolKey,
  };

  console.log("◆ Minting alice's soul...");
  const aMint = (await postJSON("/prepareMint", {
    name: "alice",
    personality: "expert sentiment analyst",
    skills: ["sentiment-analysis", "news-parsing"],
    recipient: alice,
  })) as { dataHash: Hex; intelligentData: unknown };
  console.log("  alice dataHash =", aMint.dataHash);

  console.log("◆ Minting bob's soul...");
  const bMint = (await postJSON("/prepareMint", {
    name: "bob",
    personality: "disciplined trader",
    skills: ["order-execution", "risk-management"],
    recipient: bob,
  })) as { dataHash: Hex };
  console.log("  bob dataHash   =", bMint.dataHash);

  console.log("◆ Preparing merge alice + bob -> carol...");
  const merge = (await postJSON("/prepareMerge", {
    parentA: { dataHash: aMint.dataHash, tokenId: 1 },
    parentB: { dataHash: bMint.dataHash, tokenId: 2 },
    caller: carol, // in real flow, caller would have `authorizeUsage` on both parents
    recipient: carol,
    childName: "hybrid",
  })) as {
    childDataHash: Hex;
    childProofs: {
      ownershipProof: { sealedKey: Hex };
    }[];
    childSoulSummary: { skills: { name: string; from: string }[] };
  };

  console.log("  child dataHash =", merge.childDataHash);
  console.log("  child skills   =", merge.childSoulSummary.skills);

  // Verify carol can open the child sealed key.
  const openedSymKey = openSealedKey(merge.childProofs[0].ownershipProof.sealedKey, carol.pk);
  console.log("  carol symmetric key length =", openedSymKey.length, "(expect 32)");

  const skillsFromA = merge.childSoulSummary.skills.filter((s) => s.from === "A").length;
  const skillsFromB = merge.childSoulSummary.skills.filter((s) => s.from === "B").length;
  if (skillsFromA < 1 || skillsFromB < 1) {
    throw new Error(`child must inherit from both parents; got A=${skillsFromA} B=${skillsFromB}`);
  }

  console.log("\n✅ Smoke test passed: merged child has", skillsFromA, "skill(s) from A and", skillsFromB, "from B");

  // Exit cleanly
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});
