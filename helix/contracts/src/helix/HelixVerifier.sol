// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {
    IERC7857DataVerifier,
    TransferValidityProof,
    TransferValidityProofOutput,
    OracleType
} from "../vendored/interfaces/IERC7857DataVerifier.sol";
import {Utils} from "../vendored/Utils.sol";

/// @title HelixVerifier — ECDSA-based stand-in for a real TEE attestation verifier.
/// @notice Matches the on-chain interface `IERC7857DataVerifier` expects from the vendored
///         reference. In production this would verify a TEE quote (Intel SGX, AMD SEV, etc.);
///         for the hackathon we verify that both the access proof and ownership proof were
///         signed by a trusted oracle address. The verifier interface is identical either way,
///         so swapping in real TEE verification later is a pure upgrade.
///
/// Access proof `proof` bytes: abi.encode(address assistant, bytes signature)
/// Ownership proof `proof` bytes: bytes signature
///
/// The signature covers keccak256(chainid, contract, oracleType, dataHash, sealedKey, targetPubkey, nonce)
/// for ownership, and keccak256(chainid, contract, assistant, dataHash, targetPubkey, nonce) for access.
contract HelixVerifier is AccessControlUpgradeable, IERC7857DataVerifier {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @custom:storage-location erc7201:helix.storage.HelixVerifier
    struct VerifierStorage {
        address trustedOracle;
    }

    // keccak256(abi.encode(uint256(keccak256("helix.storage.HelixVerifier")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant VERIFIER_STORAGE_LOCATION =
        0x8c39f3e9f3a69a6b75a2a1b1e0ab8f01c5cae64b5fc0dbcbefebfe7c3dc87000;

    function _get() private pure returns (VerifierStorage storage $) {
        assembly {
            $.slot := VERIFIER_STORAGE_LOCATION
        }
    }

    event TrustedOracleUpdated(address indexed oldOracle, address indexed newOracle);

    error HelixVerifierBadOracle();
    error HelixVerifierBadAccessSig();
    error HelixVerifierBadOwnershipSig();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address trustedOracle_, address admin_) external initializer {
        require(trustedOracle_ != address(0), "oracle=0");
        require(admin_ != address(0), "admin=0");

        __AccessControl_init();

        _get().trustedOracle = trustedOracle_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);
    }

    function setTrustedOracle(address oracle_) external onlyRole(ADMIN_ROLE) {
        require(oracle_ != address(0), "oracle=0");
        address old = _get().trustedOracle;
        _get().trustedOracle = oracle_;
        emit TrustedOracleUpdated(old, oracle_);
    }

    function trustedOracle() external view returns (address) {
        return _get().trustedOracle;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  IERC7857DataVerifier
    // ─────────────────────────────────────────────────────────────────────────

    function verifyTransferValidity(TransferValidityProof[] calldata proofs)
        external
        view
        override
        returns (TransferValidityProofOutput[] memory out)
    {
        address oracle = _get().trustedOracle;
        if (oracle == address(0)) revert HelixVerifierBadOracle();

        out = new TransferValidityProofOutput[](proofs.length);
        for (uint256 i = 0; i < proofs.length; i++) {
            (address assistant, bytes memory accessSig) = _splitAccessProof(proofs[i].accessProof.proof);
            bytes memory ownershipSig = proofs[i].ownershipProof.proof;

            // Verify access proof signature
            bytes32 accessDigest = _accessDigest(
                assistant,
                proofs[i].accessProof.dataHash,
                proofs[i].accessProof.targetPubkey,
                proofs[i].accessProof.nonce
            );
            address accessSigner = accessDigest.toEthSignedMessageHash().recover(accessSig);
            if (accessSigner != oracle) revert HelixVerifierBadAccessSig();

            // Verify ownership proof signature
            bytes32 ownDigest = _ownershipDigest(
                proofs[i].ownershipProof.oracleType,
                proofs[i].ownershipProof.dataHash,
                proofs[i].ownershipProof.sealedKey,
                proofs[i].ownershipProof.targetPubkey,
                proofs[i].ownershipProof.nonce
            );
            address ownSigner = ownDigest.toEthSignedMessageHash().recover(ownershipSig);
            if (ownSigner != oracle) revert HelixVerifierBadOwnershipSig();

            out[i] = TransferValidityProofOutput({
                dataHash: proofs[i].ownershipProof.dataHash,
                sealedKey: proofs[i].ownershipProof.sealedKey,
                targetPubkey: proofs[i].ownershipProof.targetPubkey,
                wantedKey: proofs[i].accessProof.targetPubkey,
                accessAssistant: assistant,
                accessProofNonce: proofs[i].accessProof.nonce,
                ownershipProofNonce: proofs[i].ownershipProof.nonce
            });
        }
    }

    function _splitAccessProof(bytes calldata proofBytes) internal pure returns (address assistant, bytes memory sig) {
        // abi.encode(address,bytes) layout: head(32)=addr pad, head(32)=offset, tail=bytes
        (assistant, sig) = abi.decode(proofBytes, (address, bytes));
    }

    function _accessDigest(
        address assistant,
        bytes32 dataHash,
        bytes memory targetPubkey,
        bytes memory nonce
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                "ACCESS",
                assistant,
                dataHash,
                keccak256(targetPubkey),
                keccak256(nonce)
            )
        );
    }

    function _ownershipDigest(
        OracleType oracleType,
        bytes32 dataHash,
        bytes memory sealedKey,
        bytes memory targetPubkey,
        bytes memory nonce
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                "OWNERSHIP",
                uint8(oracleType),
                dataHash,
                keccak256(sealedKey),
                keccak256(targetPubkey),
                keccak256(nonce)
            )
        );
    }
}
