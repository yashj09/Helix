import kleur from "kleur";
import { loadConfig, loadUser } from "../config.js";
import { AxlClient, newHelixMessage, parseHelixMessage } from "../axl.js";

/**
 * Usage patterns:
 *   helix chat listen              — start an AXL /recv loop, print incoming Helix messages
 *   helix chat send <peer> <text>  — send a single Helix message to a peer pubkey
 *   helix chat topology            — show AXL mesh topology for this node
 */

const AXL_BASE = process.env.HELIX_AXL_URL ?? "http://127.0.0.1:9002";

export async function chatTopology() {
  const axl = new AxlClient(AXL_BASE);
  const t = await axl.topology();
  console.log(kleur.bold().cyan("\n◆ helix chat topology"));
  console.log(`  node:    ${AXL_BASE}`);
  console.log(`  pubkey:  ${kleur.yellow(t.our_public_key)}`);
  console.log(`  ipv6:    ${t.our_ipv6}`);
  console.log(`  peers:   ${t.peers.length}`);
  for (const p of t.peers) {
    const arrow = p.inbound ? "←" : "→";
    const up = p.up ? kleur.green("●") : kleur.red("●");
    console.log(`    ${up} ${arrow} ${p.public_key}  ${kleur.dim(p.uri)}`);
  }
  console.log();
}

export async function chatSend(peerPubkey: string, fromTokenId: bigint, toTokenId: bigint, text: string) {
  // Sanity: addresses look like 0x… but AXL pubkeys are 64 hex chars without prefix
  if (peerPubkey.startsWith("0x")) peerPubkey = peerPubkey.slice(2);
  if (!/^[0-9a-fA-F]{64}$/.test(peerPubkey)) {
    throw new Error("peer pubkey must be 64 hex chars (AXL ed25519 public key)");
  }
  const _cfg = loadConfig();
  const _user = loadUser();

  const axl = new AxlClient(AXL_BASE);
  const msg = newHelixMessage("greet", Number(fromTokenId), Number(toTokenId), text);

  console.log(kleur.bold().magenta("\n◆ helix chat send"));
  console.log(`  via:   ${AXL_BASE}`);
  console.log(`  to:    ${peerPubkey.slice(0, 16)}…`);
  console.log(`  from#: ${fromTokenId}`);
  console.log(`  to#:   ${toTokenId}`);
  console.log(`  text:  "${text}"`);

  await axl.sendHelixMessage(peerPubkey, msg);
  console.log(kleur.green("\n✓ sent"));
  console.log(kleur.dim(`  nonce: ${msg.nonce}`));
  console.log();
}

export async function chatListen(opts: { maxMessages?: number }) {
  const axl = new AxlClient(AXL_BASE);
  const t = await axl.topology();
  console.log(kleur.bold().cyan("\n◆ helix chat listen"));
  console.log(`  you:    ${t.our_public_key}`);
  console.log(`  peers:  ${t.peers.length}`);
  console.log(kleur.dim(`  (Ctrl-C to stop)\n`));

  const max = opts.maxMessages ?? Infinity;
  let seen = 0;

  while (seen < max) {
    const raw = await axl.recvOnce();
    if (!raw) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    seen++;
    const parsed = parseHelixMessage(raw.body);
    if (!parsed) {
      const text = new TextDecoder().decode(raw.body);
      console.log(
        kleur.gray(`[${new Date().toLocaleTimeString()}]`),
        kleur.dim(`from=${raw.fromPeerId.slice(0, 16)}…`),
        kleur.yellow("(non-helix)"),
        text.slice(0, 120)
      );
      continue;
    }
    console.log(
      kleur.gray(`[${new Date().toLocaleTimeString()}]`),
      kleur.cyan(parsed.kind.padEnd(6)),
      kleur.dim(`#${parsed.fromTokenId}→#${parsed.toTokenId}`),
      kleur.dim(`from=${raw.fromPeerId.slice(0, 16)}…`)
    );
    console.log(`    "${parsed.text}"`);
  }
}
