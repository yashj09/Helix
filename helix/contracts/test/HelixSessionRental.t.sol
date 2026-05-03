// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {HelixSoul} from "../src/helix/HelixSoul.sol";
import {HelixLineage} from "../src/helix/HelixLineage.sol";
import {HelixSessionRental} from "../src/helix/HelixSessionRental.sol";
import {IntelligentData} from "../src/vendored/interfaces/IERC7857Metadata.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {MockVerifier} from "./MockVerifier.sol";

contract HelixSessionRentalTest is Test {
    HelixSoul soul;
    HelixLineage lineage;
    HelixSessionRental rental;
    MockVerifier verifier;

    address admin = address(0xA11CE);
    address treasury = address(0xFEE);

    address alice = address(0xAA);
    address bob = address(0xBB);
    address carol = address(0xCA);
    address oracle = address(0x0FACE);

    function setUp() public {
        verifier = new MockVerifier();

        HelixSoul soulImpl = new HelixSoul();
        bytes memory soulInit = abi.encodeCall(
            HelixSoul.initialize,
            ("Helix", "SOUL", address(verifier), admin)
        );
        soul = HelixSoul(address(new ERC1967Proxy(address(soulImpl), soulInit)));

        HelixLineage lineageImpl = new HelixLineage();
        bytes memory lineageInit = abi.encodeCall(
            HelixLineage.initialize,
            (address(soul), treasury, admin)
        );
        lineage = HelixLineage(address(new ERC1967Proxy(address(lineageImpl), lineageInit)));

        vm.prank(admin);
        soul.setLineage(address(lineage));

        HelixSessionRental rentalImpl = new HelixSessionRental();
        bytes memory rentalInit = abi.encodeCall(
            HelixSessionRental.initialize,
            (address(soul), address(lineage), admin)
        );
        rental = HelixSessionRental(address(new ERC1967Proxy(address(rentalImpl), rentalInit)));

        // Mimic the prod topology: oracle address holds CONSUMER_ROLE.
        vm.prank(admin);
        rental.setConsumer(oracle, true);
    }

    function _mint(address to) internal returns (uint256 id) {
        IntelligentData[] memory d = new IntelligentData[](1);
        d[0] = IntelligentData({dataDescription: "x", dataHash: keccak256(abi.encode(to, block.timestamp))});
        vm.prank(to);
        id = soul.mint(d, to);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  rentSession
    // ─────────────────────────────────────────────────────────────────────────

    function test_rentSession_incrementsQuotaAndCascades() public {
        uint256 id = _mint(alice);

        uint256 payment = 0.1 ether;
        vm.deal(address(this), payment);

        uint256 aliceBefore = alice.balance;
        uint256 treasuryBefore = treasury.balance;

        rental.rentSession{value: payment}(id, bob, 10);

        // 10 messages now available to bob
        assertEq(rental.activeSessionOf(id, bob), 10);

        // Alice is operator (owner + creator) for a root token, so she collects ~95% via the
        // operator path (and protocol pulls 5%). Parents array is empty ⇒ operator shortcut.
        uint256 aliceGot = alice.balance - aliceBefore;
        uint256 treasuryGot = treasury.balance - treasuryBefore;
        assertEq(aliceGot + treasuryGot, payment, "full payment cascaded");
        assertEq(treasuryGot, (payment * 500) / 10_000, "protocol gets 5%");
    }

    function test_rentSession_revertsOnZeroValue() public {
        uint256 id = _mint(alice);
        vm.expectRevert(HelixSessionRental.RentalInsufficientPayment.selector);
        rental.rentSession{value: 0}(id, bob, 10);
    }

    function test_rentSession_revertsOnZeroMessageCount() public {
        uint256 id = _mint(alice);
        vm.deal(address(this), 0.1 ether);
        vm.expectRevert(HelixSessionRental.RentalInvalidMessageCount.selector);
        rental.rentSession{value: 0.1 ether}(id, bob, 0);
    }

    function test_rentSession_revertsOnZeroRenter() public {
        uint256 id = _mint(alice);
        vm.deal(address(this), 0.1 ether);
        vm.expectRevert(HelixSessionRental.RentalInvalidAddress.selector);
        rental.rentSession{value: 0.1 ether}(id, address(0), 10);
    }

    function test_rentSession_quotaIsAdditive() public {
        uint256 id = _mint(alice);
        vm.deal(address(this), 0.3 ether);

        rental.rentSession{value: 0.1 ether}(id, bob, 5);
        assertEq(rental.activeSessionOf(id, bob), 5);

        // Re-rent should stack, not reset
        rental.rentSession{value: 0.1 ether}(id, bob, 7);
        assertEq(rental.activeSessionOf(id, bob), 12);
    }

    function test_rentSession_independentRentersOnSameToken() public {
        uint256 id = _mint(alice);
        vm.deal(address(this), 0.2 ether);

        rental.rentSession{value: 0.1 ether}(id, bob, 5);
        rental.rentSession{value: 0.1 ether}(id, carol, 3);

        assertEq(rental.activeSessionOf(id, bob), 5);
        assertEq(rental.activeSessionOf(id, carol), 3);
    }

    function test_rentSession_permissionless() public {
        // Anyone with payment can subsidize anyone else's session.
        uint256 id = _mint(alice);
        vm.deal(carol, 0.1 ether);

        vm.prank(carol); // carol pays for bob's session on alice's token
        rental.rentSession{value: 0.1 ether}(id, bob, 5);

        assertEq(rental.activeSessionOf(id, bob), 5);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  consumeMessage
    // ─────────────────────────────────────────────────────────────────────────

    function test_consumeMessage_decrementsQuota() public {
        uint256 id = _mint(alice);
        vm.deal(address(this), 0.1 ether);
        rental.rentSession{value: 0.1 ether}(id, bob, 3);

        vm.prank(oracle);
        rental.consumeMessage(id, bob);
        assertEq(rental.activeSessionOf(id, bob), 2);

        vm.prank(oracle);
        rental.consumeMessage(id, bob);
        assertEq(rental.activeSessionOf(id, bob), 1);

        vm.prank(oracle);
        rental.consumeMessage(id, bob);
        assertEq(rental.activeSessionOf(id, bob), 0);
    }

    function test_consumeMessage_revertsAtZero() public {
        uint256 id = _mint(alice);

        vm.prank(oracle);
        vm.expectRevert(HelixSessionRental.RentalSessionExpired.selector);
        rental.consumeMessage(id, bob);
    }

    function test_consumeMessage_requiresConsumerRole() public {
        uint256 id = _mint(alice);
        vm.deal(address(this), 0.1 ether);
        rental.rentSession{value: 0.1 ether}(id, bob, 3);

        // alice (token owner) does NOT have CONSUMER_ROLE
        bytes32 role = rental.CONSUMER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                alice,
                role
            )
        );
        vm.prank(alice);
        rental.consumeMessage(id, bob);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Admin: setConsumer
    // ─────────────────────────────────────────────────────────────────────────

    function test_setConsumer_grantsAndRevokes() public {
        uint256 id = _mint(alice);
        vm.deal(address(this), 0.1 ether);
        rental.rentSession{value: 0.1 ether}(id, bob, 3);

        // Grant to carol
        vm.prank(admin);
        rental.setConsumer(carol, true);
        vm.prank(carol);
        rental.consumeMessage(id, bob);
        assertEq(rental.activeSessionOf(id, bob), 2);

        // Revoke and expect a revert
        vm.prank(admin);
        rental.setConsumer(carol, false);
        bytes32 role = rental.CONSUMER_ROLE();
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                carol,
                role
            )
        );
        vm.prank(carol);
        rental.consumeMessage(id, bob);
    }
}
