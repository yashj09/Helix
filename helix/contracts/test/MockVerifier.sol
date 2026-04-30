// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    IERC7857DataVerifier,
    TransferValidityProof,
    TransferValidityProofOutput
} from "../src/vendored/interfaces/IERC7857DataVerifier.sol";

/// @notice Test-only verifier that accepts any proof and returns the content the proof declares.
/// @dev Tests are responsible for constructing the TransferValidityProof values such that the
///      on-chain `_proofCheck` invariants hold (data hash, target pubkey → to).
contract MockVerifier is IERC7857DataVerifier {
    function verifyTransferValidity(
        TransferValidityProof[] calldata proofs
    ) external pure override returns (TransferValidityProofOutput[] memory out) {
        out = new TransferValidityProofOutput[](proofs.length);
        for (uint256 i = 0; i < proofs.length; i++) {
            out[i] = TransferValidityProofOutput({
                dataHash: proofs[i].ownershipProof.dataHash,
                sealedKey: proofs[i].ownershipProof.sealedKey,
                targetPubkey: proofs[i].ownershipProof.targetPubkey,
                wantedKey: proofs[i].accessProof.targetPubkey, // empty => default path
                accessAssistant: _extractAccessAssistant(proofs[i]),
                accessProofNonce: proofs[i].accessProof.nonce,
                ownershipProofNonce: proofs[i].ownershipProof.nonce
            });
        }
    }

    /// @dev Conventionally we encode the assistant address into the access proof `proof` bytes
    ///      as the first 20 bytes (ABI-encoded). If empty, use 0.
    function _extractAccessAssistant(TransferValidityProof calldata p) internal pure returns (address) {
        if (p.accessProof.proof.length >= 20) {
            return abi.decode(p.accessProof.proof, (address));
        }
        return address(0);
    }
}
