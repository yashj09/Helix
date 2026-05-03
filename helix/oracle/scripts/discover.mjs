import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0gfoundation/0g-compute-ts-sdk";

const pk = process.env.ORACLE_PRIVATE_KEY;
if (!pk) { console.error("ORACLE_PRIVATE_KEY not set"); process.exit(1); }
const provider = new ethers.JsonRpcProvider("https://evmrpc-testnet.0g.ai");
const wallet = new ethers.Wallet(pk, provider);
console.log("wallet:", wallet.address);

const broker = await createZGComputeNetworkBroker(wallet);
console.log("broker ready");

try {
  const ledger = await broker.ledger.getLedger();
  console.log("ledger:", JSON.stringify(ledger, (_, v) => typeof v === "bigint" ? v.toString() : v, 2));
} catch (e) { console.log("ledger missing:", e.message); }

const services = await broker.inference.listService();
console.log("services count:", services.length);
for (const s of services.slice(0, 10)) {
  console.log("  provider=%s type=%s model=%s name=%s url=%s", s.provider, s.serviceType, s.model ?? "", s.name ?? "", s.url ?? "");
}
