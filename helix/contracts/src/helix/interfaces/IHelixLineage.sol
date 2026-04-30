// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IHelixLineage — parentage + royalty cascade registry
/// @notice Records parent→child relationships between Helix souls and cascades
///         invocation revenue to ancestors.
interface IHelixLineage {
    error LineageAlreadyRecorded(uint256 childTokenId);
    error LineageDepthExceeded();
    error LineageUnauthorizedCaller();
    error LineageInsufficientPayment();

    struct Ancestor {
        uint256 tokenId;
        uint16 shareBps; // share in basis points (1 bps = 0.01%)
    }

    event LineageRecorded(
        uint256 indexed childTokenId,
        uint256 indexed parentA,
        uint256 indexed parentB
    );

    event RoyaltyFlowed(
        uint256 indexed fromToken,
        uint256 indexed toToken,
        address indexed toAddress,
        uint256 amount
    );

    event RoyaltyCreator(
        uint256 indexed token,
        address indexed creator,
        uint256 amount
    );

    /// @notice Record the lineage of a newly minted child token. MUST be called by
    ///         the authorized HelixSoul contract inside `iMergeFrom`.
    /// @param parentA First parent token
    /// @param parentB Second parent token
    /// @param child Newly minted child token
    function recordMerge(uint256 parentA, uint256 parentB, uint256 child) external;

    /// @notice Distribute invocation revenue for `tokenId` across its ancestry and operator.
    /// @dev Typical cascade (bps):
    ///      - Operator (current owner of `tokenId`): 5500
    ///      - Direct ancestors' creators: 3000 (split equally)
    ///      - Recursive grandparents: 1000 (halving per generation)
    ///      - Protocol: 500
    ///      Caller is the invocation-payment source (e.g., KeeperHub settler).
    /// @param tokenId Token that earned the invocation
    function distributeInvocationRevenue(uint256 tokenId) external payable;

    function ancestorsOf(uint256 tokenId) external view returns (Ancestor[] memory);
}
