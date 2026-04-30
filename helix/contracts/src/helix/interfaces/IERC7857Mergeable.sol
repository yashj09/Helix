// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC7857} from "../../vendored/interfaces/IERC7857.sol";
import {TransferValidityProof} from "../../vendored/interfaces/IERC7857DataVerifier.sol";

/// @title IERC7857Mergeable — composable intelligence for ERC-7857
/// @notice Extends ERC-7857 with `iMergeFrom`: combine two agent souls into a new child iNFT.
/// @dev The TEE oracle decrypts both parents' encrypted metadata, blends them, re-encrypts for
///      the child's recipient, and signs a merge-validity proof. Re-uses the existing
///      TransferValidityProof shape from IERC7857DataVerifier, one per parent.
interface IERC7857Mergeable is IERC7857 {
    error ERC7857MergeSameParent();
    error ERC7857MergeNotOwnerOrAuthorized(uint256 tokenId);
    error ERC7857MergeProofCountMismatch();

    /// @notice Emitted when two parent tokens are merged into a new child token.
    /// @param _parentA First parent token id
    /// @param _parentB Second parent token id
    /// @param _childTokenId Newly minted child token id
    /// @param _to Recipient of the child token
    event Merged(
        uint256 indexed _parentA,
        uint256 indexed _parentB,
        uint256 indexed _childTokenId,
        address _to
    );

    /// @notice Merge the encrypted souls of two parent tokens into a new child token.
    /// @dev Caller must own or be authorized on BOTH parents. The oracle must return
    ///      proofs demonstrating (1) caller access to each parent, (2) correct
    ///      re-encryption of the blended soul for `_to`. Lineage is recorded by an
    ///      external `HelixLineage` contract via the `Merged` event (indexer pattern).
    /// @param _parentA First parent token
    /// @param _parentB Second parent token (must differ from _parentA)
    /// @param _to Recipient of the newly minted child
    /// @param _parentAProofs Access+ownership proofs for parent A
    /// @param _parentBProofs Access+ownership proofs for parent B
    /// @param _childProofs Ownership proofs for the new child's encrypted data (re-encrypted to _to)
    /// @return _childTokenId The newly minted child token id
    function iMergeFrom(
        uint256 _parentA,
        uint256 _parentB,
        address _to,
        TransferValidityProof[] calldata _parentAProofs,
        TransferValidityProof[] calldata _parentBProofs,
        TransferValidityProof[] calldata _childProofs
    ) external returns (uint256 _childTokenId);
}
