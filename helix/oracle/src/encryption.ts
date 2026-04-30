// Soul encryption primitives.
//
// - `encryptSoul` — AES-256-GCM encrypt a JSON soul with a freshly generated symmetric key.
// - `sealKeyFor` — ECIES-style seal of the symmetric key to a recipient's secp256k1 public key.
//
// ERC-7857 leaves the exact encryption scheme to implementations; we use AES-256-GCM + ECIES
// (a common, auditable combo). The `sealedKey` bytes travel through `OwnershipProof.sealedKey`.

import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import type { Hex } from "./types.js";

export interface EncryptedSoul {
  /** raw ciphertext: nonce(12) || ciphertext || tag(16) */
  ciphertext: Uint8Array;
  /** The symmetric key (32 bytes) used — kept so the oracle can re-seal on transfer/merge. */
  symmetricKey: Uint8Array;
  /** keccak256 of ciphertext, used as `dataHash` on-chain. */
  dataHash: Hex;
}

export function encryptSoul(soulJson: object): EncryptedSoul {
  const plaintext = new TextEncoder().encode(JSON.stringify(soulJson));
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = gcm(key, nonce);
  const encrypted = cipher.encrypt(plaintext);

  const ciphertext = new Uint8Array(nonce.length + encrypted.length);
  ciphertext.set(nonce, 0);
  ciphertext.set(encrypted, nonce.length);

  return {
    ciphertext,
    symmetricKey: key,
    dataHash: toKeccakHex(ciphertext),
  };
}

export function decryptSoul(ciphertext: Uint8Array, symmetricKey: Uint8Array): object {
  const nonce = ciphertext.subarray(0, 12);
  const body = ciphertext.subarray(12);
  const cipher = gcm(symmetricKey, nonce);
  const plaintext = cipher.decrypt(body);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/** ECIES-style seal: derive shared secret via ECDH, encrypt the symmetric key with AES-GCM. */
export function sealKeyFor(recipientPubkey64: Hex, symmetricKey: Uint8Array): Hex {
  // Recipient 64-byte key (X||Y). We need to re-prefix with 0x04 for secp256k1 ops.
  const rawPub = hexToBytes(recipientPubkey64);
  if (rawPub.length !== 64) throw new Error(`sealKeyFor: expected 64-byte pubkey, got ${rawPub.length}`);
  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  uncompressed.set(rawPub, 1);

  // Generate ephemeral keypair
  const ephPriv = secp256k1.utils.randomPrivateKey();
  const ephPub = secp256k1.getPublicKey(ephPriv, false); // 65 bytes

  // ECDH shared point → KDF to 32-byte AES key
  const sharedPoint = secp256k1.getSharedSecret(ephPriv, uncompressed, false); // 65 bytes
  const aesKey = sha256(sharedPoint.slice(1)); // 32 bytes from X (drop 0x04)

  // Encrypt symmetric key with AES-GCM
  const nonce = randomBytes(12);
  const cipher = gcm(aesKey, nonce);
  const ciphertext = cipher.encrypt(symmetricKey);

  // Sealed payload: ephPub(65) || nonce(12) || ciphertext(48)  = 125 bytes
  const out = new Uint8Array(65 + 12 + ciphertext.length);
  out.set(ephPub, 0);
  out.set(nonce, 65);
  out.set(ciphertext, 77);
  return bytesToHex(out);
}

export function openSealedKey(sealedKey: Hex, recipientPrivateKey: Hex): Uint8Array {
  const raw = hexToBytes(sealedKey);
  const ephPub = raw.subarray(0, 65);
  const nonce = raw.subarray(65, 77);
  const ciphertext = raw.subarray(77);

  const sharedPoint = secp256k1.getSharedSecret(recipientPrivateKey.slice(2), ephPub, false);
  const aesKey = sha256(sharedPoint.slice(1));

  return gcm(aesKey, nonce).decrypt(ciphertext);
}

// ─────────────────────────────────────────────────────────────────────────
//  Tiny hex helpers (avoid pulling ethers just for this)
// ─────────────────────────────────────────────────────────────────────────

function hexToBytes(h: string): Uint8Array {
  const clean = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): Hex {
  return ("0x" + Buffer.from(b).toString("hex")) as Hex;
}

function toKeccakHex(b: Uint8Array): Hex {
  return bytesToHex(keccak_256(b));
}
