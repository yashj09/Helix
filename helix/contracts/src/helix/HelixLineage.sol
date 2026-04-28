// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import {IHelixLineage} from "./interfaces/IHelixLineage.sol";
import {HelixSoul} from "./HelixSoul.sol";

/// @title HelixLineage — parentage registry + royalty cascade for Helix souls
/// @notice Stores the precomputed ancestor list per token (capped depth) and
///         distributes invocation revenue across creators of the lineage.
/// @dev Ancestry is precomputed at merge time and capped at MAX_DEPTH to keep
///      distribution O(1). Grandparent shares halve per generation.
///
/// Distribution layout (basis points, sum = 10_000):
///   - Operator (current owner of tokenId):      5500
///   - Parent A creator + Parent B creator:      3000 (split 50/50)
///   - Recursive ancestors (gen 2+, halving):    1000 total budget
///   - Protocol treasury:                         500
/// If a token has no recorded ancestry, operator gets the full 9500 + protocol 500.
contract HelixLineage is AccessControlUpgradeable, ReentrancyGuardUpgradeable, IHelixLineage {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");

    uint16 public constant BPS_DENOM = 10_000;
    uint16 public constant BPS_OPERATOR = 5_500;
    uint16 public constant BPS_DIRECT_PARENTS = 3_000; // total for both direct parents
    uint16 public constant BPS_GRANDPARENT_BUDGET = 1_000;
    uint16 public constant BPS_PROTOCOL = 500;
    uint8 public constant MAX_DEPTH = 5;

    /// @custom:storage-location erc7201:helix.storage.HelixLineage
    struct LineageStorage {
        address soul; // HelixSoul contract
        address treasury;
        // tokenId => recorded ancestors (immutable after first record)
        mapping(uint256 => Ancestor[]) ancestors;
        // tokenId => direct parents (2 entries if merged, 0 otherwise)
        mapping(uint256 => uint256[2]) directParents;
        mapping(uint256 => bool) recorded;
    }

    // keccak256(abi.encode(uint256(keccak256("helix.storage.HelixLineage")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant HELIX_LINEAGE_STORAGE_LOCATION =
        0xb4d1c0bdf7a6e9cfb57e94f37c0d5b37bb8c8cfb8d1e2ab0fa5a0e2b0a0f4900;

    function _get() private pure returns (LineageStorage storage $) {
        assembly {
            $.slot := HELIX_LINEAGE_STORAGE_LOCATION
        }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address soul_, address treasury_, address admin_) external initializer {
        require(soul_ != address(0), "soul=0");
        require(treasury_ != address(0), "treasury=0");
        require(admin_ != address(0), "admin=0");

        __AccessControl_init();
        __ReentrancyGuard_init();

        LineageStorage storage $ = _get();
        $.soul = soul_;
        $.treasury = treasury_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);
        _grantRole(RECORDER_ROLE, soul_); // HelixSoul is the only allowed recorder by default
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Recording lineage at merge time
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IHelixLineage
    function recordMerge(uint256 parentA, uint256 parentB, uint256 child)
        external
        override
        onlyRole(RECORDER_ROLE)
    {
        LineageStorage storage $ = _get();
        if ($.recorded[child]) revert LineageAlreadyRecorded(child);

        $.recorded[child] = true;
        $.directParents[child] = [parentA, parentB];

        // Build the ancestor payout list.
        // - Two direct parents each get 1500 bps (half of 3000).
        // - Grandparents share a 1000 budget, split across unique ancestors at each generation,
        //   halved per generation: gen2 gets 500 total, gen3 gets 250, etc.
        Ancestor[] storage arr = $.ancestors[child];
        arr.push(Ancestor({tokenId: parentA, shareBps: BPS_DIRECT_PARENTS / 2}));
        arr.push(Ancestor({tokenId: parentB, shareBps: BPS_DIRECT_PARENTS / 2}));

        _cascadeGrandparents($, arr, parentA, parentB);
    }

    function _cascadeGrandparents(
        LineageStorage storage $,
        Ancestor[] storage outArr,
        uint256 parentA,
        uint256 parentB
    ) internal {
        // Fast path: if both direct parents are root (no recorded merge), no cascade needed.
        // This is the overwhelmingly common case and keeps merge gas bounded.
        uint256[2] memory pa = $.directParents[parentA];
        uint256[2] memory pb = $.directParents[parentB];
        if (pa[0] == 0 && pa[1] == 0 && pb[0] == 0 && pb[1] == 0) {
            return;
        }

        uint16 remainingBudget = BPS_GRANDPARENT_BUDGET;
        uint256[] memory frontier = new uint256[](2);
        frontier[0] = parentA;
        frontier[1] = parentB;

        for (uint8 gen = 2; gen <= MAX_DEPTH && remainingBudget > 0; gen++) {
            // Collect unique parents of everyone in `frontier`.
            uint256[] memory next = new uint256[](frontier.length * 2);
            uint256 nextCount = 0;

            for (uint256 i = 0; i < frontier.length; i++) {
                uint256[2] memory directP = $.directParents[frontier[i]];
                if (directP[0] == 0 && directP[1] == 0) continue;
                for (uint256 j = 0; j < 2; j++) {
                    uint256 pid = directP[j];
                    if (pid == 0) continue;
                    bool seen = false;
                    for (uint256 k = 0; k < nextCount; k++) {
                        if (next[k] == pid) {
                            seen = true;
                            break;
                        }
                    }
                    if (!seen) {
                        next[nextCount] = pid;
                        nextCount++;
                    }
                }
            }

            if (nextCount == 0) break;

            uint16 genBudget = remainingBudget / 2; // gen2 gets half, gen3 gets half of rest...
            if (gen == MAX_DEPTH) genBudget = remainingBudget; // dump everything at last gen
            remainingBudget -= genBudget;

            uint16 perAncestor = genBudget / uint16(nextCount);
            for (uint256 k = 0; k < nextCount; k++) {
                outArr.push(Ancestor({tokenId: next[k], shareBps: perAncestor}));
            }

            // Trim frontier to nextCount
            uint256[] memory trimmed = new uint256[](nextCount);
            for (uint256 k = 0; k < nextCount; k++) trimmed[k] = next[k];
            frontier = trimmed;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Revenue distribution
    // ─────────────────────────────────────────────────────────────────────────

    /// @inheritdoc IHelixLineage
    function distributeInvocationRevenue(uint256 tokenId) external payable override nonReentrant {
        if (msg.value == 0) revert LineageInsufficientPayment();
        LineageStorage storage $ = _get();
        HelixSoul soul = HelixSoul($.soul);

        address operator = soul.ownerOf(tokenId);
        uint256 total = msg.value;

        // Protocol cut first
        uint256 protocolCut = (total * BPS_PROTOCOL) / BPS_DENOM;
        _safePay($.treasury, protocolCut);
        emit RoyaltyFlowed(tokenId, 0, $.treasury, protocolCut);

        Ancestor[] storage ancestors = $.ancestors[tokenId];

        if (ancestors.length == 0) {
            // Root token: operator gets everything except protocol cut.
            uint256 operatorCut = total - protocolCut;
            _safePay(operator, operatorCut);
            emit RoyaltyFlowed(tokenId, tokenId, operator, operatorCut);
            return;
        }

        // Operator cut
        uint256 opCut = (total * BPS_OPERATOR) / BPS_DENOM;
        _safePay(operator, opCut);
        emit RoyaltyFlowed(tokenId, tokenId, operator, opCut);

        // Ancestor cuts — each paid to that ancestor's creator
        uint256 distributedAncestor;
        for (uint256 i = 0; i < ancestors.length; i++) {
            Ancestor memory a = ancestors[i];
            uint256 share = (total * a.shareBps) / BPS_DENOM;
            if (share == 0) continue;
            address creator = soul.creatorOf(a.tokenId);
            if (creator == address(0)) {
                // Creator unknown — route back to treasury as dust.
                _safePay($.treasury, share);
                emit RoyaltyFlowed(tokenId, a.tokenId, $.treasury, share);
            } else {
                _safePay(creator, share);
                emit RoyaltyFlowed(tokenId, a.tokenId, creator, share);
                emit RoyaltyCreator(a.tokenId, creator, share);
            }
            distributedAncestor += share;
        }

        // Any dust left over (rounding from integer BPS math) → treasury
        uint256 accountedFor = protocolCut + opCut + distributedAncestor;
        if (total > accountedFor) {
            uint256 dust = total - accountedFor;
            _safePay($.treasury, dust);
            emit RoyaltyFlowed(tokenId, 0, $.treasury, dust);
        }
    }

    function _safePay(address to, uint256 amount) internal {
        if (amount == 0 || to == address(0)) return;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Helix: payout failed");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Views & admin
    // ─────────────────────────────────────────────────────────────────────────

    function ancestorsOf(uint256 tokenId) external view override returns (Ancestor[] memory) {
        return _get().ancestors[tokenId];
    }

    function directParentsOf(uint256 tokenId) external view returns (uint256[2] memory) {
        return _get().directParents[tokenId];
    }

    function isRecorded(uint256 tokenId) external view returns (bool) {
        return _get().recorded[tokenId];
    }

    function soul() external view returns (address) {
        return _get().soul;
    }

    function treasury() external view returns (address) {
        return _get().treasury;
    }

    function setTreasury(address treasury_) external onlyRole(ADMIN_ROLE) {
        require(treasury_ != address(0), "treasury=0");
        _get().treasury = treasury_;
    }

    function setRecorder(address recorder, bool allowed) external onlyRole(ADMIN_ROLE) {
        if (allowed) _grantRole(RECORDER_ROLE, recorder);
        else _revokeRole(RECORDER_ROLE, recorder);
    }
}
