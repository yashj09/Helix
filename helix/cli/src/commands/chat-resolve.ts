// Extension of helix chat: accept a label instead of a raw pubkey.
//
// `helix chat send-to <label> --text ...` resolves <label>.helix.eth on-chain,
// reads its axl.pubkey record, and sends a Helix message over AXL.
//
// This is the "you give me a name, I figure out the mesh address" convenience
// that demonstrates the on-chain identity layer cleanly.

import kleur from "kleur";
import { loadConfig, loadUser } from "../config.js";
import { connect, HelixNamesAbi } from "../client.js";
import { AxlClient, newHelixMessage } from "../axl.js";
import type { Hex } from "../config.js";

const AXL_BASE = process.env.HELIX_AXL_URL ?? "http://127.0.0.1:9002";

async function resolveLabelToPubkey(label: string): Promise<{ tokenId: bigint; pubkey: string; owner: Hex }> {
  const cfg = loadConfig();
  const user = loadUser();
  if (!cfg.contracts.names) throw new Error("HelixNames not configured for this chain");
  const { publicClient } = connect(cfg, user);

  const [tokenId, owner] = (await publicClient.readContract({
    address: cfg.contracts.names,
    abi: HelixNamesAbi as any,
    functionName: "resolveFull",
    args: [label],
  })) as [bigint, Hex];

  const pubkey = (await publicClient.readContract({
    address: cfg.contracts.names,
    abi: HelixNamesAbi as any,
    functionName: "text",
    args: [tokenId, "axl.pubkey"],
  })) as string;

  if (!pubkey || !/^[0-9a-fA-F]{64}$/.test(pubkey.replace(/^0x/, ""))) {
    throw new Error(`label "${label}" has no valid axl.pubkey text record`);
  }
  return { tokenId, pubkey: pubkey.replace(/^0x/, ""), owner };
}

/**
 * helix chat send-to <label> --from <fromTokenId> --text "..."
 * Resolves the label, discovers the peer's AXL pubkey, sends a Helix envelope.
 */
export async function chatSendTo(opts: { label: string; fromTokenId: bigint; text: string }) {
  const { tokenId: toTokenId, pubkey, owner } = await resolveLabelToPubkey(opts.label);

  console.log(kleur.bold().cyan("\n◆ helix chat send-to"));
  console.log(`  label:   ${kleur.yellow(opts.label + ".helix.eth")}`);
  console.log(`  → token: #${toTokenId}  (owner ${owner})`);
  console.log(`  → peer:  ${pubkey.slice(0, 16)}…  ${kleur.dim("(from on-chain record)")}`);
  console.log(`  from#:   ${opts.fromTokenId}`);
  console.log(`  text:    "${opts.text}"`);

  const axl = new AxlClient(AXL_BASE);
  const msg = newHelixMessage("greet", Number(opts.fromTokenId), Number(toTokenId), opts.text);
  await axl.sendHelixMessage(pubkey, msg);

  console.log(kleur.green("\n✓ sent over AXL mesh"));
  console.log(kleur.dim(`  nonce: ${msg.nonce}`));
  console.log();
}
