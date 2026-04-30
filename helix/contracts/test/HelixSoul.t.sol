// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {HelixSoul} from "../src/helix/HelixSoul.sol";
import {HelixLineage} from "../src/helix/HelixLineage.sol";
import {IHelixLineage} from "../src/helix/interfaces/IHelixLineage.sol";
import {IERC7857Mergeable} from "../src/helix/interfaces/IERC7857Mergeable.sol";
import {IntelligentData} from "../src/vendored/interfaces/IERC7857Metadata.sol";
import {
    TransferValidityProof,
    AccessProof,
    OwnershipProof,
    OracleType
} from "../src/vendored/interfaces/IERC7857DataVerifier.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {MockVerifier} from "./MockVerifier.sol";

contract HelixSoulTest is Test {
    HelixSoul soul;
    HelixLineage lineage;
    MockVerifier verifier;

    address admin = address(0xA11CE);
    address treasury = address(0xFEE);

    // Test wallets — we need their 64-byte pubkeys for ERC-7857 proof checks.
    Vm.Wallet aliceW;
    Vm.Wallet bobW;
    Vm.Wallet carolW;

    address alice;
    address bob;
    address carol;

    function setUp() public {
        aliceW = vm.createWallet("alice");
        bobW = vm.createWallet("bob");
        carolW = vm.createWallet("carol");
        alice = aliceW.addr;
        bob = bobW.addr;
        carol = carolW.addr;

        verifier = new MockVerifier();

        // Deploy HelixSoul behind ERC1967 proxy so initializer works.
        HelixSoul soulImpl = new HelixSoul();
        bytes memory soulInit = abi.encodeCall(
            HelixSoul.initialize,
            ("Helix", "SOUL", address(verifier), admin)
        );
        ERC1967Proxy soulProxy = new ERC1967Proxy(address(soulImpl), soulInit);
        soul = HelixSoul(address(soulProxy));

        HelixLineage lineageImpl = new HelixLineage();
        bytes memory lineageInit = abi.encodeCall(
            HelixLineage.initialize,
            (address(soul), treasury, admin)
        );
        ERC1967Proxy lineageProxy = new ERC1967Proxy(address(lineageImpl), lineageInit);
        lineage = HelixLineage(address(lineageProxy));

        vm.prank(admin);
        soul.setLineage(address(lineage));
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Proof builders
    // ─────────────────────────────────────────────────────────────────────────

    function _pubkey64(Vm.Wallet memory w) internal pure returns (bytes memory) {
        // 64-byte uncompressed pubkey = X || Y (no 0x04 prefix), per Utils.pubKeyToAddress.
        return abi.encodePacked(bytes32(w.publicKeyX), bytes32(w.publicKeyY));
    }

    function _makeProof(
        bytes32 dataHash,
        Vm.Wallet memory receiver
    ) internal pure returns (TransferValidityProof[] memory proofs) {
        proofs = new TransferValidityProof[](1);
        proofs[0] = TransferValidityProof({
            accessProof: AccessProof({
                dataHash: dataHash,
                targetPubkey: bytes(""), // empty => default path: targetPubkey must hash to `to`
                nonce: bytes("n1"),
                proof: abi.encode(receiver.addr) // access assistant = receiver (self)
            }),
            ownershipProof: OwnershipProof({
                oracleType: OracleType.TEE,
                dataHash: dataHash,
                sealedKey: hex"cafe",
                targetPubkey: _pubkey64(receiver),
                nonce: bytes("n1"),
                proof: hex""
            })
        });
    }

    function _soulData(string memory desc, bytes32 hash) internal pure returns (IntelligentData[] memory d) {
        d = new IntelligentData[](1);
        d[0] = IntelligentData({dataDescription: desc, dataHash: hash});
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_mintRoot_assignsCreator() public {
        bytes32 aliceHash = keccak256("alice-soul");
        vm.prank(alice);
        uint256 id = soul.mint(_soulData("alice-soul-v1", aliceHash), alice);
        assertEq(soul.ownerOf(id), alice, "owner");
        assertEq(soul.creatorOf(id), alice, "creator");
    }

    function test_merge_createsChildWithLineage() public {
        bytes32 aliceHash = keccak256("alice-soul");
        bytes32 bobHash = keccak256("bob-soul");
        bytes32 childHash = keccak256("alice+bob-soul");

        vm.prank(alice);
        uint256 aId = soul.mint(_soulData("alice-soul-v1", aliceHash), alice);
        vm.prank(bob);
        uint256 bId = soul.mint(_soulData("bob-soul-v1", bobHash), bob);

        // Carol wants to merge alice's + bob's souls into her child.
        // For simplicity in this test, alice and bob authorize carol on their souls.
        vm.prank(alice);
        soul.authorizeUsage(aId, carol);
        vm.prank(bob);
        soul.authorizeUsage(bId, carol);

        TransferValidityProof[] memory aProofs = _makeProof(aliceHash, carolW);
        TransferValidityProof[] memory bProofs = _makeProof(bobHash, carolW);
        TransferValidityProof[] memory childProofs = _makeProof(childHash, carolW);

        vm.prank(carol);
        uint256 childId = soul.iMergeFrom(aId, bId, carol, aProofs, bProofs, childProofs);

        assertEq(soul.ownerOf(childId), carol, "child owner");
        assertEq(soul.creatorOf(childId), carol, "child creator");
        assertTrue(lineage.isRecorded(childId), "lineage recorded");

        uint256[2] memory parents = lineage.directParentsOf(childId);
        assertEq(parents[0], aId);
        assertEq(parents[1], bId);

        IHelixLineage.Ancestor[] memory ancestors = lineage.ancestorsOf(childId);
        assertEq(ancestors.length, 2, "ancestor count = 2 direct parents");
        assertEq(ancestors[0].tokenId, aId);
        assertEq(ancestors[1].tokenId, bId);
        assertEq(ancestors[0].shareBps + ancestors[1].shareBps, 3_000);
    }

    function test_merge_revertsSameParent() public {
        bytes32 h = keccak256("x");
        vm.prank(alice);
        uint256 aId = soul.mint(_soulData("x", h), alice);

        TransferValidityProof[] memory p = _makeProof(h, aliceW);
        TransferValidityProof[] memory cp = _makeProof(keccak256("c"), aliceW);

        vm.prank(alice);
        vm.expectRevert(IERC7857Mergeable.ERC7857MergeSameParent.selector);
        soul.iMergeFrom(aId, aId, alice, p, p, cp);
    }

    function test_merge_revertsNotAuthorized() public {
        bytes32 aHash = keccak256("a");
        bytes32 bHash = keccak256("b");

        vm.prank(alice);
        uint256 aId = soul.mint(_soulData("a", aHash), alice);
        vm.prank(bob);
        uint256 bId = soul.mint(_soulData("b", bHash), bob);

        TransferValidityProof[] memory aProofs = _makeProof(aHash, carolW);
        TransferValidityProof[] memory bProofs = _makeProof(bHash, carolW);
        TransferValidityProof[] memory childProofs = _makeProof(keccak256("c"), carolW);

        // Carol has no authorization on either parent.
        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(IERC7857Mergeable.ERC7857MergeNotOwnerOrAuthorized.selector, aId)
        );
        soul.iMergeFrom(aId, bId, carol, aProofs, bProofs, childProofs);
    }

    function test_royalty_rootToken_operatorGetsNearlyEverything() public {
        bytes32 h = keccak256("a");
        vm.prank(alice);
        uint256 aId = soul.mint(_soulData("a", h), alice);

        uint256 payment = 1 ether;
        vm.deal(address(this), payment);

        uint256 aliceBefore = alice.balance;
        uint256 treasuryBefore = treasury.balance;

        lineage.distributeInvocationRevenue{value: payment}(aId);

        uint256 aliceGot = alice.balance - aliceBefore;
        uint256 treasuryGot = treasury.balance - treasuryBefore;

        assertEq(aliceGot, (payment * 9_500) / 10_000, "operator gets 95%");
        assertEq(treasuryGot, (payment * 500) / 10_000, "treasury gets 5%");
    }

    function test_royalty_mergedChild_cascadesToParentsCreators() public {
        bytes32 aHash = keccak256("a");
        bytes32 bHash = keccak256("b");
        bytes32 cHash = keccak256("c");

        vm.prank(alice);
        uint256 aId = soul.mint(_soulData("a", aHash), alice);
        vm.prank(bob);
        uint256 bId = soul.mint(_soulData("b", bHash), bob);

        vm.prank(alice);
        soul.authorizeUsage(aId, carol);
        vm.prank(bob);
        soul.authorizeUsage(bId, carol);

        TransferValidityProof[] memory ap = _makeProof(aHash, carolW);
        TransferValidityProof[] memory bp = _makeProof(bHash, carolW);
        TransferValidityProof[] memory cp = _makeProof(cHash, carolW);

        vm.prank(carol);
        uint256 childId = soul.iMergeFrom(aId, bId, carol, ap, bp, cp);

        uint256 payment = 1 ether;
        vm.deal(address(this), payment);

        uint256 carolBefore = carol.balance;
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;
        uint256 treasuryBefore = treasury.balance;

        lineage.distributeInvocationRevenue{value: payment}(childId);

        uint256 carolGot = carol.balance - carolBefore;
        uint256 aliceGot = alice.balance - aliceBefore;
        uint256 bobGot = bob.balance - bobBefore;
        uint256 treasuryGot = treasury.balance - treasuryBefore;

        // Operator (Carol) = 55%
        assertEq(carolGot, (payment * 5_500) / 10_000, "operator 55%");
        // Each direct parent's creator = 15% (3000 / 2)
        assertEq(aliceGot, (payment * 1_500) / 10_000, "alice 15%");
        assertEq(bobGot, (payment * 1_500) / 10_000, "bob 15%");
        // Treasury = 5% + any unspent grandparent budget (here: 10%) since no grandparents exist.
        uint256 expectedTreasury = payment - carolGot - aliceGot - bobGot;
        assertEq(treasuryGot, expectedTreasury, "treasury gets dust+protocol");
    }

    function test_royalty_revertsOnZeroPayment() public {
        bytes32 h = keccak256("a");
        vm.prank(alice);
        uint256 aId = soul.mint(_soulData("a", h), alice);

        vm.expectRevert(IHelixLineage.LineageInsufficientPayment.selector);
        lineage.distributeInvocationRevenue{value: 0}(aId);
    }

    // Needed to receive ETH refunds during cascade tests
    receive() external payable {}
}
