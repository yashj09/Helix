import kleur from "kleur";
import { loadConfig, loadUser } from "../config.js";
import { pubkey64For } from "../pubkey.js";
import { OracleClient } from "../oracle.js";
import { connect, HelixSoulAbi } from "../client.js";

export async function mintCommand(opts: {
  name: string;
  personality: string;
  skills: string;
  tools?: string;
  model?: string;
}) {
  const cfg = loadConfig();
  const user = loadUser();
  const oracle = new OracleClient(cfg.oracleUrl);
  const { publicClient, walletClient, account, chain } = connect(cfg, user);

  console.log(kleur.bold().cyan("\n◆ helix mint"));
  console.log(`  recipient: ${kleur.yellow(account.address)}`);
  console.log(`  oracle:    ${cfg.oracleUrl}`);
  console.log(`  soul:      ${cfg.contracts.soul}`);

  // 1. Ask oracle to encrypt + prepare mint data
  const pubkey64 = pubkey64For(user.privateKey);
  const skills = opts.skills.split(",").map((s) => s.trim()).filter(Boolean);
  const tools = opts.tools?.split(",").map((s) => s.trim()).filter(Boolean);

  console.log(kleur.dim("\n→ asking oracle to encrypt soul..."));
  const prep = await oracle.prepareMint({
    name: opts.name,
    personality: opts.personality,
    skills,
    tools,
    model: opts.model,
    recipient: { address: account.address, pubkey64 },
  });
  console.log(kleur.dim(`  dataHash: ${prep.dataHash}`));

  // 2. Submit on-chain mint([iData], to)
  console.log(kleur.dim("→ submitting mint tx..."));
  const hash = await walletClient.writeContract({
    address: cfg.contracts.soul,
    abi: HelixSoulAbi as any,
    functionName: "mint",
    args: [[prep.intelligentData], account.address],
    chain,
    account,
  });
  console.log(kleur.dim(`  tx: ${hash}`));

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // 3. Decode tokenId from Transfer event
  const tokenId = decodeMintedTokenId(receipt.logs, account.address);

  console.log(kleur.bold().green("\n✓ minted"));
  console.log(`  tokenId:   ${kleur.yellow(String(tokenId))}`);
  console.log(`  owner:     ${account.address}`);
  console.log(`  name:      ${prep.soulSummary.name}`);
  console.log(`  skills:    ${prep.soulSummary.skills.join(", ")}`);
  console.log(`  explorer:  ${cfg.explorerBase}/tx/${hash}`);
  console.log(kleur.dim(`  dataHash:  ${prep.dataHash}`));
  console.log();
}

function decodeMintedTokenId(logs: readonly { topics: readonly string[] }[], to: string): bigint {
  // ERC721 Transfer(from=0, to, tokenId) — topic0 = keccak256("Transfer(address,address,uint256)")
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  for (const log of logs) {
    if (log.topics[0] !== TRANSFER) continue;
    if (!log.topics[1] || !log.topics[2] || !log.topics[3]) continue;
    // topic1 = from padded, topic2 = to padded, topic3 = tokenId
    const fromHex = log.topics[1].toLowerCase();
    const toHex = log.topics[2].toLowerCase();
    if (!fromHex.endsWith("0000000000000000000000000000000000000000")) continue;
    if (!toHex.endsWith(to.slice(2).toLowerCase())) continue;
    return BigInt(log.topics[3]);
  }
  throw new Error("mint: Transfer event not found");
}
