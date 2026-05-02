#!/usr/bin/env node
import { Command } from "commander";
import kleur from "kleur";

import { mintCommand } from "./commands/mint.js";
import { mergeCommand } from "./commands/merge.js";
import { infoCommand } from "./commands/info.js";
import { invokeCommand } from "./commands/invoke.js";
import { chatListen, chatSend, chatTopology } from "./commands/chat.js";
import { chatSendTo } from "./commands/chat-resolve.js";
import { nameRegister, nameResolve, nameSet, nameSetBatch } from "./commands/name.js";
import type { Hex } from "./config.js";

const program = new Command();

program
  .name("helix")
  .description(kleur.bold("Helix") + " — composable intelligence for ERC-7857 iNFTs")
  .version("0.1.0");

program
  .command("mint")
  .description("Mint a new root soul (no parents)")
  .requiredOption("-n, --name <name>", "soul display name")
  .requiredOption("-p, --personality <text>", "freeform personality prompt")
  .requiredOption("-s, --skills <csv>", "comma-separated skill names")
  .option("-t, --tools <csv>", "comma-separated tool manifest")
  .option("-m, --model <model>", "LLM model id", "qwen3.6-plus")
  .action(async (opts) => {
    await mintCommand({
      name: opts.name,
      personality: opts.personality,
      skills: opts.skills,
      tools: opts.tools,
      model: opts.model,
    });
  });

program
  .command("merge")
  .description("Merge two parent souls into a new child soul")
  .requiredOption("-a, --parent-a <tokenId:dataHash>", "first parent as 'tokenId:dataHash'")
  .requiredOption("-b, --parent-b <tokenId:dataHash>", "second parent as 'tokenId:dataHash'")
  .requiredOption("-n, --child-name <name>", "child soul name")
  .option("--to <address>", "recipient address (defaults to your wallet)")
  .action(async (opts) => {
    const [aIdStr, aHash] = String(opts.parentA).split(":");
    const [bIdStr, bHash] = String(opts.parentB).split(":");
    if (!aIdStr || !aHash || !bIdStr || !bHash) {
      console.error(kleur.red("error: --parent-a and --parent-b must be 'tokenId:dataHash'"));
      process.exit(1);
    }
    await mergeCommand({
      parentA: BigInt(aIdStr),
      parentB: BigInt(bIdStr),
      parentADataHash: aHash as Hex,
      parentBDataHash: bHash as Hex,
      childName: opts.childName,
      to: opts.to as Hex | undefined,
    });
  });

program
  .command("info")
  .description("Show config + optional token lineage")
  .option("--token <id>", "token id to inspect")
  .action(async (opts) => {
    await infoCommand({ token: opts.token ? BigInt(opts.token) : undefined });
  });

program
  .command("invoke")
  .description("Simulate an invocation payment — distributes royalties up the lineage")
  .requiredOption("--token <id>", "token id being invoked")
  .requiredOption("--pay <amount>", "amount in 0G (e.g. 0.1)")
  .action(async (opts) => {
    await invokeCommand({ token: BigInt(opts.token), pay: opts.pay });
  });

const name = program.command("name").description("Human-readable names for iNFTs (ENS-style subname registrar)");

name
  .command("register")
  .description("Register a label bound to a token you own")
  .requiredOption("--token <id>", "token id")
  .requiredOption("--label <label>", "name label (a-z0-9-, 3-32 chars)")
  .action(async (opts) => {
    await nameRegister({ token: BigInt(opts.token), label: opts.label });
  });

name
  .command("set")
  .description("Set a single text record on your token")
  .requiredOption("--token <id>", "token id")
  .requiredOption("--key <key>", "text record key (e.g. axl.pubkey, avatar, description)")
  .requiredOption("--value <value>", "text record value")
  .action(async (opts) => {
    await nameSet({ token: BigInt(opts.token), key: opts.key, value: opts.value });
  });

name
  .command("set-batch")
  .description("Set multiple text records in one tx (key=value pairs as positional args)")
  .requiredOption("--token <id>", "token id")
  .argument("<pairs...>", "pairs like axl.pubkey=abc avatar=ipfs://x")
  .action(async (pairs: string[], opts: { token: string }) => {
    const parsed = pairs.map((p) => {
      const idx = p.indexOf("=");
      if (idx < 0) throw new Error(`bad pair "${p}" — expected key=value`);
      return { key: p.slice(0, idx), value: p.slice(idx + 1) };
    });
    await nameSetBatch({ token: BigInt(opts.token), pairs: parsed });
  });

name
  .command("resolve")
  .description("Resolve a label to its token id + text records")
  .requiredOption("--label <label>", "name label")
  .option("--keys <csv>", "comma-separated keys to read (default: common set)")
  .action(async (opts) => {
    const keys = opts.keys ? String(opts.keys).split(",").map((s) => s.trim()) : undefined;
    await nameResolve({ label: opts.label, keys });
  });

const chat = program.command("chat").description("Agent-to-agent messaging over AXL mesh");

chat
  .command("topology")
  .description("Show this AXL node's pubkey + peers")
  .action(async () => {
    await chatTopology();
  });

chat
  .command("send")
  .description("Send a Helix message to a peer (by AXL pubkey)")
  .requiredOption("--peer <pubkey>", "destination AXL ed25519 pubkey (64 hex)")
  .requiredOption("--from <id>", "your iNFT token id")
  .requiredOption("--to <id>", "recipient iNFT token id")
  .requiredOption("--text <msg>", "message text")
  .action(async (opts) => {
    await chatSend(
      opts.peer,
      BigInt(opts.from),
      BigInt(opts.to),
      opts.text
    );
  });

chat
  .command("listen")
  .description("Poll AXL /recv and print Helix messages as they arrive")
  .option("--max <n>", "stop after N messages", "0")
  .action(async (opts) => {
    const max = Number(opts.max);
    await chatListen({ maxMessages: max > 0 ? max : undefined });
  });

chat
  .command("send-to")
  .description("Send a Helix message to a peer by label (resolves axl.pubkey on-chain)")
  .requiredOption("--label <label>", "recipient label (e.g. alice)")
  .requiredOption("--from <id>", "your iNFT token id")
  .requiredOption("--text <msg>", "message text")
  .action(async (opts) => {
    await chatSendTo({
      label: opts.label,
      fromTokenId: BigInt(opts.from),
      text: opts.text,
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(kleur.red("\n✗ " + (err instanceof Error ? err.message : String(err))));
  process.exit(1);
});
