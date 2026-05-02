import kleur from "kleur";
import { loadConfig, loadUser } from "../config.js";
import { connect, HelixNamesAbi } from "../client.js";

function requireNames(cfg: ReturnType<typeof loadConfig>) {
  if (!cfg.contracts.names) {
    throw new Error(
      "HelixNames is not deployed on this chain (missing 'names' in deployment JSON)."
    );
  }
  return cfg.contracts.names;
}

export async function nameRegister(opts: { token: bigint; label: string }) {
  const cfg = loadConfig();
  const user = loadUser();
  const names = requireNames(cfg);
  const { publicClient, walletClient, account, chain } = connect(cfg, user);

  console.log(kleur.bold().cyan("\n◆ helix name register"));
  console.log(`  token:     #${opts.token}`);
  console.log(`  label:     ${kleur.yellow(opts.label)}`);
  console.log(`  owner:     ${account.address}`);
  console.log(`  registrar: ${names}`);

  const hash = await walletClient.writeContract({
    address: names,
    abi: HelixNamesAbi as any,
    functionName: "register",
    args: [opts.label, opts.token],
    chain,
    account,
  });
  console.log(kleur.dim(`  tx: ${hash}`));
  await publicClient.waitForTransactionReceipt({ hash });

  console.log(kleur.bold().green("\n✓ registered"));
  console.log(`  ${kleur.yellow(opts.label + ".helix.eth")} → token #${opts.token}`);
  console.log(`  explorer:  ${cfg.explorerBase}/tx/${hash}`);
  console.log();
}

export async function nameSet(opts: {
  token: bigint;
  key: string;
  value: string;
}) {
  const cfg = loadConfig();
  const user = loadUser();
  const names = requireNames(cfg);
  const { publicClient, walletClient, account, chain } = connect(cfg, user);

  console.log(kleur.bold().magenta("\n◆ helix name set"));
  console.log(`  token: #${opts.token}`);
  console.log(`  key:   ${opts.key}`);
  console.log(`  value: ${opts.value}`);

  const hash = await walletClient.writeContract({
    address: names,
    abi: HelixNamesAbi as any,
    functionName: "setText",
    args: [opts.token, opts.key, opts.value],
    chain,
    account,
  });
  console.log(kleur.dim(`  tx: ${hash}`));
  await publicClient.waitForTransactionReceipt({ hash });

  console.log(kleur.bold().green("\n✓ text record set"));
  console.log();
}

export async function nameSetBatch(opts: {
  token: bigint;
  pairs: Array<{ key: string; value: string }>;
}) {
  const cfg = loadConfig();
  const user = loadUser();
  const names = requireNames(cfg);
  const { publicClient, walletClient, account, chain } = connect(cfg, user);

  const keys = opts.pairs.map((p) => p.key);
  const values = opts.pairs.map((p) => p.value);

  console.log(kleur.bold().magenta("\n◆ helix name set-batch"));
  console.log(`  token: #${opts.token}`);
  for (const p of opts.pairs) {
    console.log(`    ${kleur.dim(p.key.padEnd(20))} ${p.value}`);
  }

  const hash = await walletClient.writeContract({
    address: names,
    abi: HelixNamesAbi as any,
    functionName: "setTextBatch",
    args: [opts.token, keys, values],
    chain,
    account,
  });
  console.log(kleur.dim(`  tx: ${hash}`));
  await publicClient.waitForTransactionReceipt({ hash });

  console.log(kleur.bold().green(`\n✓ ${opts.pairs.length} records set`));
  console.log();
}

export async function nameResolve(opts: { label: string; keys?: string[] }) {
  const cfg = loadConfig();
  const user = loadUser();
  const names = requireNames(cfg);
  const { publicClient } = connect(cfg, user);

  console.log(kleur.bold().cyan(`\n◆ helix name resolve "${opts.label}"`));

  const [tokenId, owner] = (await publicClient.readContract({
    address: names,
    abi: HelixNamesAbi as any,
    functionName: "resolveFull",
    args: [opts.label],
  })) as [bigint, `0x${string}`];

  console.log(`  token:   #${tokenId}`);
  console.log(`  owner:   ${owner}`);

  const defaultKeys = [
    "axl.pubkey",
    "inft.token",
    "helix.parents",
    "avatar",
    "description",
  ];
  const keys = opts.keys && opts.keys.length > 0 ? opts.keys : defaultKeys;

  console.log(`  records:`);
  for (const key of keys) {
    const value = (await publicClient.readContract({
      address: names,
      abi: HelixNamesAbi as any,
      functionName: "text",
      args: [tokenId, key],
    })) as string;
    if (value && value.length > 0) {
      console.log(`    ${kleur.yellow(key.padEnd(20))} ${value}`);
    } else {
      console.log(`    ${kleur.dim(key.padEnd(20) + " (empty)")}`);
    }
  }
  console.log();
}
