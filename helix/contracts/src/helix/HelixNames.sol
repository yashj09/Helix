// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title HelixNames — ENS-style subname registrar for Helix iNFTs
/// @notice Provides human-readable names (e.g. "alice" → child.helix.eth convention)
///         bound to iNFT token ownership. Transferring the iNFT transfers the name.
///
/// Records schema (convention — any string key is allowed):
///   "axl.pubkey"      — 64-hex AXL ed25519 public key
///   "inft.token"      — "<contract>:<tokenId>" (redundant for convenience)
///   "helix.parents"   — JSON array of parent token IDs (for merged children)
///   "avatar"          — image URL
///   "description"     — freeform text
///
/// Naming is case-insensitive: "Alice" == "alice". A label must be 3–32 chars of
/// [a-z0-9-]. Labels are unique per registrar (no namespace collision).
///
/// Design note: we're not trying to replicate ENS's full namehash machinery. This
/// is a flat label → tokenId → records lookup. For the "alice.helix.eth" display
/// convention, the frontend composes the label client-side. On-chain we only
/// store `label → tokenId` and `(tokenId, recordKey) → value`.
contract HelixNames is AccessControlUpgradeable {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    string public constant ROOT_LABEL = "helix"; // shown as alice.helix.eth by convention

    /// @custom:storage-location erc7201:helix.storage.HelixNames
    struct NamesStorage {
        address soul; // HelixSoul (IERC721)
        mapping(bytes32 => uint256) tokenByLabel;     // keccak256(label) → tokenId
        mapping(uint256 => string) labelByToken;      // tokenId → label (the last registered label)
        mapping(uint256 => mapping(string => string)) records; // (tokenId, key) → value
        mapping(bytes32 => bool) labelReserved;       // true when a label is taken
    }

    // keccak256(abi.encode(uint256(keccak256("helix.storage.HelixNames")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant NAMES_STORAGE_LOCATION =
        0x6b3f4d9c60a39bca12ac7f7d2e8a4c1e5b7e82d55e6d9e0a1b2c3d4e5f607900;

    function _get() private pure returns (NamesStorage storage $) {
        assembly { $.slot := NAMES_STORAGE_LOCATION }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Events & errors
    // ─────────────────────────────────────────────────────────────────────────

    event NameRegistered(uint256 indexed tokenId, string label, address indexed owner);
    event NameReleased(uint256 indexed tokenId, string label);
    event TextChanged(uint256 indexed tokenId, string indexed keyIndex, string key, string value);

    error NameInvalidLabel();
    error NameAlreadyTaken(string label);
    error NameNotOwner();
    error NameTokenHasName(uint256 tokenId);
    error NameNotFound();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address soul_, address admin_) external initializer {
        require(soul_ != address(0), "soul=0");
        require(admin_ != address(0), "admin=0");

        __AccessControl_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);

        _get().soul = soul_;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Register / release
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Bind a human-readable label to a token you own.
    /// @dev Label is normalized to lowercase here on-chain and must match
    ///      ^[a-z0-9][a-z0-9-]{2,31}$ (3–32 chars, no leading hyphen).
    function register(string calldata label, uint256 tokenId) external {
        _requireOwner(tokenId);
        bytes32 key = _validateAndKey(label);

        NamesStorage storage $ = _get();
        if ($.labelReserved[key]) revert NameAlreadyTaken(label);
        if (bytes($.labelByToken[tokenId]).length != 0) revert NameTokenHasName(tokenId);

        $.tokenByLabel[key] = tokenId;
        $.labelByToken[tokenId] = label;
        $.labelReserved[key] = true;

        emit NameRegistered(tokenId, label, msg.sender);
    }

    /// @notice Release the name bound to a token you own. Frees the label for reuse.
    function release(uint256 tokenId) external {
        _requireOwner(tokenId);
        NamesStorage storage $ = _get();
        string memory label = $.labelByToken[tokenId];
        if (bytes(label).length == 0) revert NameNotFound();
        bytes32 key = keccak256(bytes(label));
        delete $.tokenByLabel[key];
        delete $.labelByToken[tokenId];
        $.labelReserved[key] = false;

        emit NameReleased(tokenId, label);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Text records
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Set a text record on your token (e.g., "axl.pubkey" → "0xabc...").
    /// @dev Empty value clears the record. Keys are freeform strings.
    function setText(uint256 tokenId, string calldata key, string calldata value) external {
        _requireOwner(tokenId);
        _get().records[tokenId][key] = value;
        emit TextChanged(tokenId, key, key, value);
    }

    /// @notice Bulk write multiple text records in one tx. Handy during onboarding.
    function setTextBatch(
        uint256 tokenId,
        string[] calldata keys,
        string[] calldata values
    ) external {
        require(keys.length == values.length, "length mismatch");
        _requireOwner(tokenId);
        NamesStorage storage $ = _get();
        for (uint256 i = 0; i < keys.length; i++) {
            $.records[tokenId][keys[i]] = values[i];
            emit TextChanged(tokenId, keys[i], keys[i], values[i]);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Resolve a label to its bound token id. Reverts if unknown.
    function resolve(string calldata label) external view returns (uint256 tokenId) {
        bytes32 key = keccak256(bytes(_toLower(label)));
        tokenId = _get().tokenByLabel[key];
        if (!_get().labelReserved[key]) revert NameNotFound();
    }

    /// @notice Reverse: token → label. Returns empty string if unregistered.
    function nameOf(uint256 tokenId) external view returns (string memory) {
        return _get().labelByToken[tokenId];
    }

    /// @notice Read a text record by token + key.
    function text(uint256 tokenId, string calldata key) external view returns (string memory) {
        return _get().records[tokenId][key];
    }

    /// @notice Combined: label → (tokenId, owner). Convenience for CLI/frontend.
    function resolveFull(string calldata label)
        external
        view
        returns (uint256 tokenId, address owner)
    {
        bytes32 key = keccak256(bytes(_toLower(label)));
        NamesStorage storage $ = _get();
        if (!$.labelReserved[key]) revert NameNotFound();
        tokenId = $.tokenByLabel[key];
        owner = IERC721($.soul).ownerOf(tokenId);
    }

    function soul() external view returns (address) {
        return _get().soul;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Internals
    // ─────────────────────────────────────────────────────────────────────────

    function _requireOwner(uint256 tokenId) internal view {
        if (IERC721(_get().soul).ownerOf(tokenId) != msg.sender) revert NameNotOwner();
    }

    /// @dev Lowercase + validate (a-z, 0-9, -, no leading/trailing hyphen, 3–32 chars).
    ///      Returns keccak256 of the lowercased label.
    function _validateAndKey(string calldata label) internal pure returns (bytes32) {
        bytes memory b = bytes(_toLower(label));
        uint256 n = b.length;
        if (n < 3 || n > 32) revert NameInvalidLabel();
        if (b[0] == "-" || b[n - 1] == "-") revert NameInvalidLabel();
        for (uint256 i = 0; i < n; i++) {
            bytes1 c = b[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-";
            if (!ok) revert NameInvalidLabel();
        }
        return keccak256(b);
    }

    function _toLower(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length);
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            out[i] = (c >= 0x41 && c <= 0x5A) ? bytes1(uint8(c) + 32) : c;
        }
        return string(out);
    }
}
