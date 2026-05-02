import kleur from "kleur";
import { decodeEventLog } from "viem";
import { loadConfig, loadUser } from "../config.js";
import { pubkey64For } from "../pubkey.js";
import { OracleClient } from "../oracle.js";
import { connect, HelixSoulAbi } from "../client.js";
import type { Hex } from "../config.js";

export async function mergeCommand(opts: {
  parentA: bigint;
  parentB: bigint;
  parentADataHash: Hex;
  parentBDataHash: Hex;
  to?: Hex;
  childName: string;
}) {
  const cfg = loadConfig();
  const user = loadUser();
  const oracle = new OracleClient(cfg.oracleUrl);
  const { publicClient, walletClient, account, chain } = connect(cfg, user);

  const caller = account.address;
  const recipient = opts.to ?? caller;
  const pubkey64 = pubkey64For(user.privateKey);

  console.log(kleur.bold().magenta("\n◆ helix merge"));
  console.log(`  parent A:  #${opts.parentA}  ${kleur.dim(opts.parentADataHash)}`);
  console.log(`  parent B:  #${opts.parentB}  ${kleur.dim(opts.parentBDataHash)}`);
  console.log(`  caller:    ${caller}`);
  console.log(`  recipient: ${kleur.yellow(recipient)}`);
  console.log(`  child:     "${opts.childName}"`);

  console.log(kleur.dim("\n→ asking oracle to blend souls in TEE..."));
  const prep = await oracle.prepareMerge({
    parentA: { dataHash: opts.parentADataHash, tokenId: Number(opts.parentA) },
    parentB: { dataHash: opts.parentBDataHash, tokenId: Number(opts.parentB) },
    caller: { address: caller, pubkey64 },
    recipient: { address: recipient, pubkey64: pubkey64For(user.privateKey) },
    childName: opts.childName,
  });

  console.log(kleur.dim(`  child dataHash: ${prep.childDataHash}`));
  console.log(kleur.dim(`  child inherits:`));
  for (const s of prep.childSoulSummary.skills) {
    console.log(kleur.dim(`    - ${s.name}  (×${s.weight}  from parent ${s.from})`));
  }

  console.log(kleur.dim("\n→ submitting iMergeFrom tx..."));
  const hash = await walletClient.writeContract({
    address: cfg.contracts.soul,
    abi: HelixSoulAbi as any,
    functionName: "iMergeFrom",
    args: [
      opts.parentA,
      opts.parentB,
      recipient,
      prep.parentAProofs,
      prep.parentBProofs,
      prep.childProofs,
    ],
    chain,
    account,
  });
  console.log(kleur.dim(`  tx: ${hash}`));

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Decode Merged event
  let childTokenId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: HelixSoulAbi as any,
        data: log.data,
        topics: log.topics,
      }) as { eventName: string; args: Record<string, unknown> };
      if (decoded.eventName === "Merged") {
        childTokenId = decoded.args._childTokenId as bigint;
        break;
      }
    } catch {
      // skip logs that don't belong to HelixSoul
    }
  }

  console.log(kleur.bold().green("\n✓ merged"));
  if (childTokenId !== null) {
    console.log(`  child tokenId: ${kleur.yellow(String(childTokenId))}`);
  }
  console.log(`  owner:         ${recipient}`);
  console.log(`  explorer:      ${cfg.explorerBase}/tx/${hash}`);
  console.log(kleur.dim(`  child dataHash: ${prep.childDataHash}`));
  console.log();
}
