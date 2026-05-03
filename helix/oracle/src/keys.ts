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
  if (!fromEnv) {
    // Fail loudly in the common case. Silently generating a random key produces proofs
    // that no HelixVerifier-on-chain will ever accept — every mint + merge reverts with
    // HelixVerifierBadAccessSig. Only useful in isolated unit tests that also deploy a
    // fresh verifier bound to the random key, which is set via HELIX_ALLOW_EPHEMERAL_ORACLE.
    if (process.env.HELIX_ALLOW_EPHEMERAL_ORACLE !== "1") {
      throw new Error(
        "ORACLE_PRIVATE_KEY is not set. Source helix/contracts/.env before starting the oracle, " +
          "or set HELIX_ALLOW_EPHEMERAL_ORACLE=1 if you really want a throwaway signer."
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[oracle] ORACLE_PRIVATE_KEY missing — generating ephemeral key. Proofs will NOT verify on mainnet verifiers."
    );
  }
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
