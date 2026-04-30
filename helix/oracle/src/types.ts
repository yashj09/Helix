// Mirrors the Solidity structs in contracts/src/vendored/interfaces/IERC7857DataVerifier.sol
// so proof objects emitted by the oracle round-trip through ethers/viem into the contract unchanged.

export type Hex = `0x${string}`;

export enum OracleType {
  TEE = 0,
  ZKP = 1,
}

export interface AccessProof {
  dataHash: Hex;
  targetPubkey: Hex; // empty (0x) for the "default pubkey = receiver" path
  nonce: Hex;
  proof: Hex; // oracle-specific; our mock/TEE encodes `assistant` address in the first 32 bytes
}

export interface OwnershipProof {
  oracleType: OracleType;
  dataHash: Hex;
  sealedKey: Hex;
  targetPubkey: Hex; // 64-byte uncompressed pubkey (X || Y) per Utils.pubKeyToAddress
  nonce: Hex;
  proof: Hex;
}

export interface TransferValidityProof {
  accessProof: AccessProof;
  ownershipProof: OwnershipProof;
}

export interface IntelligentData {
  dataDescription: string;
  dataHash: Hex;
}
