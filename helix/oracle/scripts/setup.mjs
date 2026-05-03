import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

const pk = process.env.ORACLE_PRIVATE_KEY;
const provider = new ethers.JsonRpcProvider("https://evmrpc-testnet.0g.ai");
const wallet = new ethers.Wallet(pk, provider);
console.log("wallet:", wallet.address);

const bal = await provider.getBalance(wallet.address);
console.log("balance:", ethers.formatEther(bal), "OG");

const broker = await createZGComputeNetworkBroker(wallet);

// Create ledger with initial 3 OG (2.5 minimum recommended). This will deposit OG into the ledger contract.
console.log("creating ledger with 3 OG deposit…");
try {
  await broker.ledger.addLedger(3);  // 3 OG for the ledger itself
  console.log("ledger created");
} catch (e) {
  console.log("ledger creation error:", e.message);
  // try getting it instead
  const l = await broker.ledger.getLedger();
  console.log("existing ledger:", JSON.stringify(l, (_, v) => typeof v === "bigint" ? v.toString() : v));
}

// Fund the chatbot provider sub-account with 1 OG
const CHATBOT = "0xa48f01287233509FD694a22Bf840225062E67836";
try {
  console.log("transferring 1 OG to provider sub-account for inference…");
  await broker.ledger.transferFund(CHATBOT, "inference", BigInt("1000000000000000000"));
  console.log("done");
} catch (e) {
  console.log("transfer err:", e.message);
}

// Acknowledge the provider's TEE signer (required before requests)
try {
  console.log("acknowledging provider TEE signer…");
  await broker.inference.acknowledgeProviderSigner(CHATBOT);
  console.log("ack done");
} catch (e) {
  console.log("ack err:", e.message);
}

// Try a test inference
const { endpoint, model } = await broker.inference.getServiceMetadata(CHATBOT);
console.log("endpoint:", endpoint, "model:", model);
const headers = await broker.inference.getRequestHeaders(CHATBOT);
console.log("headers:", Object.keys(headers));

const r = await fetch(endpoint + "/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify({
    model,
    max_tokens: 40,
    messages: [{ role: "user", content: "say hi in 5 words" }],
  }),
});
console.log("status:", r.status);
const body = await r.text();
console.log("body:", body.slice(0, 500));
