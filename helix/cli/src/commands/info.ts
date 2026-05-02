import kleur from "kleur";
import { loadConfig, loadUser } from "../config.js";
import { connect, HelixSoulAbi, HelixLineageAbi } from "../client.js";
import { OracleClient } from "../oracle.js";

export async function infoCommand(opts: { token?: bigint }) {
  const cfg = loadConfig();
  const user = loadUser();
  const { publicClient, account } = connect(cfg, user);
  const oracle = new OracleClient(cfg.oracleUrl);

  console.log(kleur.bold().cyan("\n◆ helix info"));
  console.log(`  chain:        ${cfg.chainId}  (${cfg.rpcUrl})`);
  console.log(`  oracle URL:   ${cfg.oracleUrl}`);
  console.log(`  your wallet:  ${account.address}`);
  console.log();
  console.log(`  ${kleur.dim("contracts:")}`);
  console.log(`    verifier:   ${cfg.contracts.verifier}`);
  console.log(`    soul:       ${cfg.contracts.soul}`);
  console.log(`    lineage:    ${cfg.contracts.lineage}`);
  console.log(`    oracleKey:  ${cfg.contracts.oracleSigner}`);

  try {
    const health = await oracle.health();
    console.log(`  ${kleur.green("●")} oracle online  (signer=${health.oracle})`);
    if (health.oracle.toLowerCase() !== cfg.contracts.oracleSigner.toLowerCase()) {
      console.log(
        kleur.yellow(
          `    ⚠ oracle signer mismatch: verifier trusts ${cfg.contracts.oracleSigner}`
        )
      );
    }
  } catch (e) {
    console.log(`  ${kleur.red("●")} oracle unreachable: ${(e as Error).message}`);
  }

  if (opts.token !== undefined) {
    const tokenId = opts.token;
    console.log(kleur.bold("\n◆ token #" + tokenId));
    const owner = (await publicClient.readContract({
      address: cfg.contracts.soul,
      abi: HelixSoulAbi as any,
      functionName: "ownerOf",
      args: [tokenId],
    })) as `0x${string}`;
    const creator = (await publicClient.readContract({
      address: cfg.contracts.soul,
      abi: HelixSoulAbi as any,
      functionName: "creatorOf",
      args: [tokenId],
    })) as `0x${string}`;
    console.log(`  owner:   ${owner}`);
    console.log(`  creator: ${creator}`);

    const ancestors = (await publicClient.readContract({
      address: cfg.contracts.lineage,
      abi: HelixLineageAbi as any,
      functionName: "ancestorsOf",
      args: [tokenId],
    })) as { tokenId: bigint; shareBps: number }[];
    if (ancestors.length === 0) {
      console.log(kleur.dim("  lineage: root soul (no ancestors)"));
    } else {
      console.log(`  lineage:`);
      for (const a of ancestors) {
        console.log(`    ↳ parent #${a.tokenId}  (${(a.shareBps / 100).toFixed(2)}% royalty)`);
      }
    }
  }
  console.log();
}
