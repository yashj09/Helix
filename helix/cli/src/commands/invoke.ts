import kleur from "kleur";
import { parseEther } from "viem";
import { loadConfig, loadUser } from "../config.js";
import { connect, HelixLineageAbi } from "../client.js";

export async function invokeCommand(opts: { token: bigint; pay: string }) {
  const cfg = loadConfig();
  const user = loadUser();
  const { publicClient, walletClient, account, chain } = connect(cfg, user);

  const amount = parseEther(opts.pay);

  console.log(kleur.bold().cyan("\n◆ helix invoke (simulated payment)"));
  console.log(`  token:    #${opts.token}`);
  console.log(`  paying:   ${opts.pay} 0G`);
  console.log(`  from:     ${account.address}`);

  const hash = await walletClient.writeContract({
    address: cfg.contracts.lineage,
    abi: HelixLineageAbi as any,
    functionName: "distributeInvocationRevenue",
    args: [opts.token],
    value: amount,
    chain,
    account,
  });
  console.log(kleur.dim(`  tx: ${hash}`));

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log(kleur.bold().green("\n✓ distributed"));
  console.log(`  tx:       ${hash}`);
  console.log(`  explorer: ${cfg.explorerBase}/tx/${hash}`);
  console.log(kleur.dim(`  logs:     ${receipt.logs.length} events emitted (RoyaltyFlowed)`));
  console.log();
}
