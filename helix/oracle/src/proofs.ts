// Build `TransferValidityProof` objects that pass on-chain `_proofCheck`.
//
// On-chain invariants (see contracts/src/vendored/ERC7857Upgradeable.sol _proofCheck):
//   - out.dataHash must match the token's current dataHash
//   - out.accessAssistant must equal `to` or the delegate set by `to`
//   - If accessProof.targetPubkey is empty:
//       Utils.pubKeyToAddress(ownershipProof.targetPubkey) must equal `to`
//     Else:
//       ownershipProof.targetPubkey must equal accessProof.targetPubkey
//
// Our convention: always use the "empty wantedKey, default = to" branch (simpler).
// So we set `accessProof.targetPubkey = 0x` and embed the recipient's 64-byte pubkey into
// `ownershipProof.targetPubkey`. The receiver acts as their own `accessAssistant` (we encode
// the assistant address in `accessProof.proof`).

import {
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  toBytes,
  type PrivateKeyAccount,
} from "viem";
import type { Hex, TransferValidityProof } from "./types.js";
import { OracleType } from "./types.js";

/**
 * Build a `TransferValidityProof` whose ECDSA signatures are accepted by on-chain `HelixVerifier`.
 *
 * The verifier expects:
 *   - accessProof.proof  = abi.encode(address assistant, bytes signature)
 *   - ownershipProof.proof = bytes signature
 *
 * Signatures are produced by `signer` (the oracle) over digests that pin:
 *   chainId, verifier address, dataHash, targetPubkey, nonce (+ assistant/sealedKey/oracleType).
 * These digests mirror HelixVerifier._accessDigest / _ownershipDigest exactly.
 */
export async function buildSignedProof(params: {
  dataHash: Hex;
  recipientAddress: Hex; // the "to" address → also the accessAssistant in our convention
  recipientPubkey64: Hex; // uncompressed X||Y (64 bytes, no prefix)
  sealedKey: Hex;
  nonce?: Hex;
  chainId: bigint;
  verifier: Hex;
  signer: PrivateKeyAccount;
  oracleType?: OracleType;
}): Promise<TransferValidityProof> {
  const nonce =
    params.nonce ?? (("0x" + Date.now().toString(16).padStart(16, "0")) as Hex);
  const oracleType = params.oracleType ?? OracleType.TEE;
  const emptyTargetPubkey = "0x" as Hex; // access proof uses empty → "receiver is default wanted"

  // Access digest
  const accessDigest = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256, address, string, address, bytes32, bytes32, bytes32"
      ),
      [
        params.chainId,
        params.verifier,
        "ACCESS",
        params.recipientAddress,
        params.dataHash,
        keccak256(emptyTargetPubkey),
        keccak256(nonce),
      ]
    )
  );
  const accessSig = await params.signer.signMessage({
    message: { raw: toBytes(accessDigest) },
  });

  // Ownership digest
  const ownDigest = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "uint256, address, string, uint8, bytes32, bytes32, bytes32, bytes32"
      ),
      [
        params.chainId,
        params.verifier,
        "OWNERSHIP",
        oracleType,
        params.dataHash,
        keccak256(params.sealedKey),
        keccak256(params.recipientPubkey64),
        keccak256(nonce),
      ]
    )
  );
  const ownSig = await params.signer.signMessage({
    message: { raw: toBytes(ownDigest) },
  });

  return {
    accessProof: {
      dataHash: params.dataHash,
      targetPubkey: emptyTargetPubkey,
      nonce,
      proof: encodeAbiParameters(parseAbiParameters("address, bytes"), [
        params.recipientAddress,
        accessSig,
      ]),
    },
    ownershipProof: {
      oracleType,
      dataHash: params.dataHash,
      sealedKey: params.sealedKey,
      targetPubkey: params.recipientPubkey64,
      nonce,
      proof: ownSig,
    },
  };
}

/**
 * Unsigned variant used with the test-only `MockVerifier` (which does not check signatures).
 * Kept for backwards compat with the existing Foundry test suite.
 */
export function buildProof(params: {
  dataHash: Hex;
  recipientAddress: Hex;
  recipientPubkey64: Hex;
  sealedKey: Hex;
  nonce?: Hex;
}): TransferValidityProof {
  const nonce =
    params.nonce ?? (("0x" + Date.now().toString(16).padStart(16, "0")) as Hex);
  return {
    accessProof: {
      dataHash: params.dataHash,
      targetPubkey: "0x" as Hex,
      nonce,
      proof: encodeAbiParameters(parseAbiParameters("address"), [
        params.recipientAddress,
      ]),
    },
    ownershipProof: {
      oracleType: OracleType.TEE,
      dataHash: params.dataHash,
      sealedKey: params.sealedKey,
      targetPubkey: params.recipientPubkey64,
      nonce,
      proof: "0x" as Hex,
    },
  };
}
