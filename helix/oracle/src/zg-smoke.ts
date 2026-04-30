// Smoke test: upload an encrypted byte blob to 0G Storage, read its rootHash, download it back.
//
// Run with:
//   HELIX_RPC_URL=https://evmrpc-testnet.0g.ai \
//   HELIX_INDEXER_URL=https://indexer-storage-testnet-turbo.0g.ai \
//   STORAGE_PRIVATE_KEY=0x... (funded 0G testnet wallet) \
//   tsx src/zg-smoke.ts
//
// Exits 0 if upload + download roundtrip succeeds, non-zero otherwise.

import { Blob as ZgBlob, Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import { encryptSoul, decryptSoul } from "./encryption.js";
import { makeRootSoul } from "./soul.js";

const RPC_URL = process.env.HELIX_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const INDEXER_URL =
  process.env.HELIX_INDEXER_URL ?? "https://indexer-storage-testnet-turbo.0g.ai";
const PRIV = process.env.STORAGE_PRIVATE_KEY;

async function main() {
  if (!PRIV) throw new Error("STORAGE_PRIVATE_KEY env var required (funded 0G testnet wallet)");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIV, provider);
  const indexer = new Indexer(INDEXER_URL);

  console.log("◆ 0G Storage smoke test");
  console.log("  RPC:       ", RPC_URL);
  console.log("  Indexer:   ", INDEXER_URL);
  console.log("  Signer:    ", signer.address);
  const bal = await provider.getBalance(signer.address);
  console.log("  Balance:   ", ethers.formatEther(bal), "0G");
  if (bal === 0n) throw new Error("wallet is empty — go to https://faucet.0g.ai first");

  // Encrypt a soul to get a realistic payload
  const soul = makeRootSoul({
    name: "smoke-test",
    personality: "just a test",
    skills: ["ping", "pong"],
  });
  const enc = encryptSoul(soul);
  console.log("\n→ encrypted soul:", enc.ciphertext.length, "bytes, dataHash", enc.dataHash);

  // Upload — MemData wraps the byte buffer
  const memData = new MemData(enc.ciphertext as unknown as Buffer);
  const [tree, treeErr] = await memData.merkleTree();
  if (treeErr) throw new Error("merkleTree failed: " + String(treeErr));
  console.log("  merkle root:", tree?.rootHash());

  console.log("\n→ uploading to 0G Storage...");
  const [tx, uploadErr] = await indexer.upload(memData, RPC_URL, signer);
  if (uploadErr) throw new Error("upload failed: " + String(uploadErr));
  // The SDK returns either a single-tx or batch-tx shape. We uploaded one blob so we expect single.
  const rootHash =
    "rootHash" in (tx as object)
      ? (tx as { rootHash: string }).rootHash
      : (tx as { rootHashes: string[] }).rootHashes[0];
  const txHash =
    "txHash" in (tx as object)
      ? (tx as { txHash: string }).txHash
      : (tx as { txHashes: string[] }).txHashes[0];
  console.log("  tx rootHash:", rootHash);
  console.log("  tx txHash:  ", txHash);

  // Download
  console.log("\n→ downloading via", rootHash);
  const [dlBlob, dlErr] = await indexer.downloadToBlob(rootHash, { proof: true });
  if (dlErr) throw new Error("download failed: " + String(dlErr));
  if (!dlBlob) throw new Error("download returned null blob");

  const buffer = await (dlBlob as unknown as Blob).arrayBuffer();
  const downloaded = new Uint8Array(buffer);
  console.log("  downloaded:", downloaded.length, "bytes");

  // Verify roundtrip
  const sameLength = downloaded.length === enc.ciphertext.length;
  let sameBytes = sameLength;
  if (sameLength) {
    for (let i = 0; i < downloaded.length; i++) {
      if (downloaded[i] !== enc.ciphertext[i]) {
        sameBytes = false;
        break;
      }
    }
  }

  // Decrypt it (verifies the uploaded ciphertext is still valid AEAD)
  const recovered = decryptSoul(downloaded, enc.symmetricKey) as { name: string };
  if (recovered.name !== soul.name) throw new Error("decrypted soul name mismatch");

  console.log("\n✅ roundtrip success");
  console.log(
    `   length match: ${sameLength ? "yes" : "no"}, bytes match: ${sameBytes ? "yes" : "no"}, decrypt ok: yes`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ smoke failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
