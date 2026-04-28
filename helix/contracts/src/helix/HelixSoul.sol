// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {ERC7857CloneableUpgradeable} from "../vendored/extensions/ERC7857CloneableUpgradeable.sol";
import {ERC7857AuthorizeUpgradeable} from "../vendored/extensions/ERC7857AuthorizeUpgradeable.sol";
import {ERC7857IDataStorageUpgradeable} from "../vendored/extensions/ERC7857IDataStorageUpgradeable.sol";
import {ERC7857Upgradeable} from "../vendored/ERC7857Upgradeable.sol";
import {IntelligentData} from "../vendored/interfaces/IERC7857Metadata.sol";
import {TransferValidityProof} from "../vendored/interfaces/IERC7857DataVerifier.sol";

import {IERC7857Mergeable} from "./interfaces/IERC7857Mergeable.sol";
import {IHelixLineage} from "./interfaces/IHelixLineage.sol";

/// @title HelixSoul — ERC-7857 iNFT extended with `iMergeFrom`
/// @notice Soul = encrypted agent metadata stored on 0G Storage. Mint, clone, authorize, and
///         merge two souls into a new child token that inherits both. All re-encryption
///         performed by a TEE oracle (or ZKP circuit) and verified on-chain via the
///         existing IERC7857DataVerifier.
contract HelixSoul is
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    ERC7857CloneableUpgradeable,
    ERC7857AuthorizeUpgradeable,
    ERC7857IDataStorageUpgradeable,
    IERC7857Mergeable
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    string public constant VERSION = "0.1.0";

    /// @custom:storage-location erc7201:helix.storage.HelixSoul
    struct HelixSoulStorage {
        /// @dev Optional lineage registry. If set, `iMergeFrom` calls
        ///      `recordMerge(parentA, parentB, child)` after successful mint.
        address lineage;
        /// @dev Creator address per token (for royalties)
        mapping(uint256 => address) creators;
    }

    // keccak256(abi.encode(uint256(keccak256("helix.storage.HelixSoul")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant HELIX_SOUL_STORAGE_LOCATION =
        0x6a5f1c4a6f9e3cbf8ac2d86ad98d6bd97a3ab71a3fb59d9e8c9a1c0e95bba200;

    function _getHelixSoulStorage() private pure returns (HelixSoulStorage storage $) {
        assembly {
            $.slot := HELIX_SOUL_STORAGE_LOCATION
        }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        address verifier_,
        address admin_
    ) external initializer {
        require(admin_ != address(0), "HelixSoul: admin zero");
        require(verifier_ != address(0), "HelixSoul: verifier zero");

        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __ERC7857_init(name_, symbol_, verifier_);

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);
        _grantRole(MINTER_ROLE, admin_);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Mint (root souls — no parents)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Mint a new root soul. Caller is recorded as creator.
    /// @dev The `IntelligentData.dataHash` points to an encrypted soul blob on 0G Storage.
    function mint(IntelligentData[] calldata iDatas, address to)
        external
        whenNotPaused
        returns (uint256 tokenId)
    {
        require(to != address(0), "HelixSoul: to zero");
        require(iDatas.length > 0, "HelixSoul: empty data");

        tokenId = _incrementTokenId();
        _safeMint(to, tokenId);
        _updateData(tokenId, iDatas);

        _getHelixSoulStorage().creators[tokenId] = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Merge (breed two parents into a child)
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IERC7857Mergeable
    function iMergeFrom(
        uint256 parentA,
        uint256 parentB,
        address to,
        TransferValidityProof[] calldata parentAProofs,
        TransferValidityProof[] calldata parentBProofs,
        TransferValidityProof[] calldata childProofs
    ) external override nonReentrant whenNotPaused returns (uint256 childTokenId) {
        if (parentA == parentB) revert ERC7857MergeSameParent();
        if (to == address(0)) revert ERC721InvalidReceiver(to);

        // Caller must own or be authorized on both parents.
        _requireOwnedOrAuthorized(parentA);
        _requireOwnedOrAuthorized(parentB);

        // Verify caller can access parent A's encrypted data (oracle-signed proof).
        _proofCheck(_ownerOf(parentA), msg.sender, parentA, parentAProofs);
        _proofCheck(_ownerOf(parentB), msg.sender, parentB, parentBProofs);

        // Verify the child's new encrypted data is sealed correctly for `to`.
        // We mint first, then update data, then call _proofCheck against the new tokenId.
        childTokenId = _incrementTokenId();
        _safeMint(to, childTokenId);

        // Extract child data from proofs: dataHash of the blended soul.
        IntelligentData[] memory childDatas = _childDatasFromProofs(childProofs);
        _updateData(childTokenId, childDatas);

        // Final access-proof check: `to` can open the child soul.
        _proofCheck(to, to, childTokenId, childProofs);

        _getHelixSoulStorage().creators[childTokenId] = msg.sender;

        // Notify external lineage contract. The 63/64 gas rule on `try` starves deep cascades,
        // so call directly and let any revert surface — lineage misconfig is a setup bug that
        // we'd rather fail loudly than silently.
        address lineage = _getHelixSoulStorage().lineage;
        if (lineage != address(0)) {
            IHelixLineage(lineage).recordMerge(parentA, parentB, childTokenId);
        }

        emit Merged(parentA, parentB, childTokenId, to);
    }

    function _childDatasFromProofs(TransferValidityProof[] calldata childProofs)
        internal
        pure
        returns (IntelligentData[] memory datas)
    {
        datas = new IntelligentData[](childProofs.length);
        for (uint256 i = 0; i < childProofs.length; i++) {
            datas[i] = IntelligentData({
                dataDescription: "helix-soul-v1",
                dataHash: childProofs[i].ownershipProof.dataHash
            });
        }
    }

    function _requireOwnedOrAuthorized(uint256 tokenId) internal view {
        address owner = _ownerOf(tokenId);
        if (owner == address(0)) revert ERC721NonexistentToken(tokenId);
        if (owner == msg.sender) return;
        // Check ERC-7857 authorize extension
        address[] memory authorized = authorizedUsersOf(tokenId);
        for (uint256 i = 0; i < authorized.length; i++) {
            if (authorized[i] == msg.sender) return;
        }
        revert ERC7857MergeNotOwnerOrAuthorized(tokenId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Admin / config
    // ─────────────────────────────────────────────────────────────────────────

    function setLineage(address lineage_) external onlyRole(ADMIN_ROLE) {
        _getHelixSoulStorage().lineage = lineage_;
    }

    function creatorOf(uint256 tokenId) external view returns (address) {
        return _getHelixSoulStorage().creators[tokenId];
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Interface resolution
    // ─────────────────────────────────────────────────────────────────────────

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControlUpgradeable, ERC7857Upgradeable, IERC165)
        returns (bool)
    {
        return
            interfaceId == type(IERC7857Mergeable).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Multiple-inheritance overrides (diamond resolution)
    //  Mirrors the reference AgentNFT.sol pattern.
    // ─────────────────────────────────────────────────────────────────────────

    function _update(address to, uint256 tokenId, address auth)
        internal
        virtual
        override(ERC721Upgradeable, ERC7857AuthorizeUpgradeable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _updateData(uint256 tokenId, IntelligentData[] memory newDatas)
        internal
        virtual
        override(ERC7857IDataStorageUpgradeable, ERC7857Upgradeable)
    {
        ERC7857IDataStorageUpgradeable._updateData(tokenId, newDatas);
    }

    function _intelligentDatasOf(uint256 tokenId)
        internal
        view
        virtual
        override(ERC7857IDataStorageUpgradeable, ERC7857Upgradeable)
        returns (IntelligentData[] memory)
    {
        return ERC7857IDataStorageUpgradeable._intelligentDatasOf(tokenId);
    }

    function _intelligentDatasLengthOf(uint256 tokenId)
        internal
        view
        virtual
        override(ERC7857IDataStorageUpgradeable, ERC7857Upgradeable)
        returns (uint256)
    {
        return ERC7857IDataStorageUpgradeable._intelligentDatasLengthOf(tokenId);
    }
}
