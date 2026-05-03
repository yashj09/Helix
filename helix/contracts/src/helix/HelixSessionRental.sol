// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import {IHelixLineage} from "./interfaces/IHelixLineage.sol";

/// @title HelixSessionRental — pay-per-session invocation quotas for ERC-7857 iNFTs
/// @notice Canonical "rent an agent for N messages" primitive for Helix. Designed to pair with
///         ERC-7857's `authorizeUsage(tokenId, renter)`, which the token owner calls separately
///         (either before or after `rentSession`) to grant the renter the spec-level usage
///         right. This contract handles the economic half — payment cascading + per-renter
///         message quotas — while the ERC-7857 authorization stays owned by its proper caller.
///
/// Flow:
///   1. Token owner calls `HelixSoul.authorizeUsage(tokenId, renter)` (ERC-7857 owner-only)
///   2. Payer (owner or anyone subsidizing) calls `rentSession{value: X}(tokenId, renter, N)`
///      → distributes X via HelixLineage, records sessions[tokenId][renter] = N
///   3. Oracle (with CONSUMER_ROLE) calls `consumeMessage(tokenId, renter)` per reply
///      → decrements remaining; reverts at 0 with SessionExpired
///   4. Renter can re-rent at any time (quota is additive, not reset)
///
/// Why separate from HelixLineage: keeps HelixLineage's invariants tight (it just cascades),
/// and gives us an isolated place to iterate on session policy (time-bounded, refundable,
/// multi-token bundles) without risking the royalty primitive.
contract HelixSessionRental is AccessControlUpgradeable, ReentrancyGuardUpgradeable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant CONSUMER_ROLE = keccak256("CONSUMER_ROLE");

    /// @custom:storage-location erc7201:helix.storage.HelixSessionRental
    struct RentalStorage {
        address soul;
        address lineage;
        mapping(uint256 tokenId => mapping(address renter => uint256 remaining)) sessions;
    }

    // keccak256(abi.encode(uint256(keccak256("helix.storage.HelixSessionRental")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant RENTAL_STORAGE_LOCATION =
        0x7f9e1c5a0d8f4a3b2e6c70bfb1aa6d33c0d2f10bcd8e2a7f9b4c1d5e6fa0b200;

    function _get() private pure returns (RentalStorage storage $) {
        assembly {
            $.slot := RENTAL_STORAGE_LOCATION
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Events & errors
    // ─────────────────────────────────────────────────────────────────────────

    event SessionRented(
        uint256 indexed tokenId,
        address indexed renter,
        uint256 messageCount,
        uint256 amountPaid,
        uint256 totalRemainingAfter
    );

    event SessionConsumed(
        uint256 indexed tokenId,
        address indexed renter,
        uint256 remaining
    );

    error RentalInvalidAddress();
    error RentalInvalidMessageCount();
    error RentalInsufficientPayment();
    error RentalSessionExpired();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address soul_, address lineage_, address admin_) external initializer {
        if (soul_ == address(0) || lineage_ == address(0) || admin_ == address(0)) {
            revert RentalInvalidAddress();
        }
        __AccessControl_init();
        __ReentrancyGuard_init();

        RentalStorage storage $ = _get();
        $.soul = soul_;
        $.lineage = lineage_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);
        // Admin is the initial consumer too — ops typically grants CONSUMER_ROLE to the oracle
        // address post-deploy. Granting to admin keeps local-dev loops working without a second tx.
        _grantRole(CONSUMER_ROLE, admin_);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Rent + consume
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Pay to extend a renter's message quota on a token. Cascades payment to the
    ///         token's lineage and increments `sessions[tokenId][renter]` by `messageCount`.
    /// @dev    Permissionless: anyone can pay to subsidize any renter on any token. Ownership
    ///         of the token (and the ERC-7857 `authorizeUsage` call) is independent — callers
    ///         are responsible for ensuring the renter has been authorized separately if they
    ///         want the oracle to honor the session.
    function rentSession(
        uint256 tokenId,
        address renter,
        uint256 messageCount
    ) external payable nonReentrant {
        if (renter == address(0)) revert RentalInvalidAddress();
        if (messageCount == 0) revert RentalInvalidMessageCount();
        if (msg.value == 0) revert RentalInsufficientPayment();

        RentalStorage storage $ = _get();

        // Confirm token exists (will revert on ERC721NonexistentToken otherwise — good).
        IERC721($.soul).ownerOf(tokenId);

        // Fire the existing royalty cascade. HelixLineage is permissionless by design.
        IHelixLineage($.lineage).distributeInvocationRevenue{value: msg.value}(tokenId);

        $.sessions[tokenId][renter] += messageCount;
        uint256 total = $.sessions[tokenId][renter];

        emit SessionRented(tokenId, renter, messageCount, msg.value, total);
    }

    /// @notice Decrement the renter's message quota. Only callable by CONSUMER_ROLE (oracle).
    function consumeMessage(uint256 tokenId, address renter)
        external
        onlyRole(CONSUMER_ROLE)
    {
        RentalStorage storage $ = _get();
        uint256 remaining = $.sessions[tokenId][renter];
        if (remaining == 0) revert RentalSessionExpired();
        unchecked {
            remaining = remaining - 1;
        }
        $.sessions[tokenId][renter] = remaining;
        emit SessionConsumed(tokenId, renter, remaining);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────────────────

    function activeSessionOf(uint256 tokenId, address renter) external view returns (uint256) {
        return _get().sessions[tokenId][renter];
    }

    function soul() external view returns (address) {
        return _get().soul;
    }

    function lineage() external view returns (address) {
        return _get().lineage;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────────────────

    function setConsumer(address consumer, bool allowed) external onlyRole(ADMIN_ROLE) {
        if (allowed) _grantRole(CONSUMER_ROLE, consumer);
        else _revokeRole(CONSUMER_ROLE, consumer);
    }
}
