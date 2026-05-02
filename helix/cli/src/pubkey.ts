import { secp256k1 } from "@noble/curves/secp256k1";
import type { Hex } from "./config.js";

/** 64-byte uncompressed public key (X || Y, no 0x04 prefix) matching Utils.pubKeyToAddress. */
export function pubkey64For(privateKey: Hex): Hex {
  const uncompressed = secp256k1.getPublicKey(privateKey.slice(2), false);
  const noPrefix = uncompressed.slice(1);
  return ("0x" + Buffer.from(noPrefix).toString("hex")) as Hex;
}
