// Oracle signer key.
//
// Design note: in a real TEE deployment this key lives inside the enclave and is never readable.
// For the hackathon we load it from env. The on-chain `TeeVerifier` only checks that the signature
// was produced by the known oracle address, so the contract-facing interface is identical.

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { PrivateKeyAccount } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1";
import type { Hex } from "./types.js";

export interface OracleIdentity {
  /** ECDSA signer used for `TransferValidityProof` attestations */
  signer: PrivateKeyAccount;
  /** Raw private key hex (needed for ECIES sealing operations) */
  signerPrivateKey: Hex;
  /** 64-byte uncompressed public key (X || Y, no 0x04 prefix) matching Utils.pubKeyToAddress */
  signerPublicKey64: Hex;
}

export function loadOracleIdentity(): OracleIdentity {
  const fromEnv = process.env.ORACLE_PRIVATE_KEY as Hex | undefined;
  const pk: Hex = fromEnv ?? generatePrivateKey();
  const signer = privateKeyToAccount(pk);

  // viem returns a 0x04-prefixed 65-byte uncompressed key. Strip the prefix for Utils.pubKeyToAddress.
  const uncompressed = secp256k1.getPublicKey(pk.slice(2), false); // Uint8Array(65)
  const noPrefix = uncompressed.slice(1); // 64 bytes
  const pub64 = ("0x" + Buffer.from(noPrefix).toString("hex")) as Hex;

  return {
    signer,
    signerPrivateKey: pk,
    signerPublicKey64: pub64,
  };
}

/** 64-byte uncompressed pubkey for an arbitrary private key. */
export function pubkey64For(privateKey: Hex): Hex {
  const uncompressed = secp256k1.getPublicKey(privateKey.slice(2), false);
  const noPrefix = uncompressed.slice(1);
  return ("0x" + Buffer.from(noPrefix).toString("hex")) as Hex;
}
