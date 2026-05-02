import { secp256k1 } from "@noble/curves/secp256k1";
import type { Hex } from "./config";

/** 64-byte uncompressed secp256k1 public key (X || Y, no 0x04 prefix). */
export function pubkey64For(privateKey: Hex): Hex {
  const raw = secp256k1.getPublicKey(privateKey.slice(2), false); // 65 bytes
  return ("0x" + Buffer.from(raw.slice(1)).toString("hex")) as Hex;
}
