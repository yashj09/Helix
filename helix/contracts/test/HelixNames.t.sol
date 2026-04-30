// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {HelixSoul} from "../src/helix/HelixSoul.sol";
import {HelixNames} from "../src/helix/HelixNames.sol";
import {IntelligentData} from "../src/vendored/interfaces/IERC7857Metadata.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {MockVerifier} from "./MockVerifier.sol";

contract HelixNamesTest is Test {
    HelixSoul soul;
    HelixNames names;
    MockVerifier verifier;

    address admin = address(0xA11CE);
    address alice = address(0xAA);
    address bob = address(0xBB);

    function setUp() public {
        verifier = new MockVerifier();

        HelixSoul soulImpl = new HelixSoul();
        bytes memory soulInit = abi.encodeCall(
            HelixSoul.initialize,
            ("Helix", "SOUL", address(verifier), admin)
        );
        soul = HelixSoul(address(new ERC1967Proxy(address(soulImpl), soulInit)));

        HelixNames namesImpl = new HelixNames();
        bytes memory namesInit = abi.encodeCall(HelixNames.initialize, (address(soul), admin));
        names = HelixNames(address(new ERC1967Proxy(address(namesImpl), namesInit)));
    }

    function _mint(address to) internal returns (uint256 id) {
        IntelligentData[] memory d = new IntelligentData[](1);
        d[0] = IntelligentData({dataDescription: "x", dataHash: keccak256("x")});
        vm.prank(to);
        id = soul.mint(d, to);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Registration
    // ─────────────────────────────────────────────────────────────────────────

    function test_register_bindsLabelToToken() public {
        uint256 id = _mint(alice);
        vm.prank(alice);
        names.register("alice", id);

        assertEq(names.resolve("alice"), id);
        assertEq(names.nameOf(id), "alice");
    }

    function test_register_caseInsensitive() public {
        uint256 id = _mint(alice);
        vm.prank(alice);
        names.register("Alice", id);
        assertEq(names.resolve("alice"), id, "lower lookup");
        assertEq(names.resolve("ALICE"), id, "upper lookup");
    }

    function test_register_revertsNonOwner() public {
        uint256 id = _mint(alice);
        vm.prank(bob);
        vm.expectRevert(HelixNames.NameNotOwner.selector);
        names.register("alice", id);
    }

    function test_register_revertsTaken() public {
        uint256 a = _mint(alice);
        uint256 b = _mint(bob);
        vm.prank(alice);
        names.register("bestname", a);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(HelixNames.NameAlreadyTaken.selector, "bestname"));
        names.register("bestname", b);
    }

    function test_register_rejectsBadLabels() public {
        uint256 id = _mint(alice);

        vm.startPrank(alice);
        // too short
        vm.expectRevert(HelixNames.NameInvalidLabel.selector);
        names.register("ab", id);

        // illegal chars
        vm.expectRevert(HelixNames.NameInvalidLabel.selector);
        names.register("alice!", id);

        // leading hyphen
        vm.expectRevert(HelixNames.NameInvalidLabel.selector);
        names.register("-alice", id);

        // trailing hyphen
        vm.expectRevert(HelixNames.NameInvalidLabel.selector);
        names.register("alice-", id);

        vm.stopPrank();
    }

    function test_register_revertsTokenAlreadyHasName() public {
        uint256 id = _mint(alice);
        vm.prank(alice);
        names.register("first", id);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HelixNames.NameTokenHasName.selector, id));
        names.register("second", id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Release
    // ─────────────────────────────────────────────────────────────────────────

    function test_release_freesLabel() public {
        uint256 id = _mint(alice);
        vm.prank(alice);
        names.register("alice", id);
        vm.prank(alice);
        names.release(id);

        assertEq(names.nameOf(id), "");

        // label now free for re-registration (even by a different owner)
        uint256 id2 = _mint(bob);
        vm.prank(bob);
        names.register("alice", id2);
        assertEq(names.resolve("alice"), id2);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Text records
    // ─────────────────────────────────────────────────────────────────────────

    function test_setText_storesAndReads() public {
        uint256 id = _mint(alice);
        vm.prank(alice);
        names.register("alice", id);

        vm.prank(alice);
        names.setText(id, "axl.pubkey", "deadbeef");
        assertEq(names.text(id, "axl.pubkey"), "deadbeef");
    }

    function test_setTextBatch_writesAllKeys() public {
        uint256 id = _mint(alice);
        vm.prank(alice);
        names.register("alice", id);

        string[] memory keys = new string[](3);
        keys[0] = "axl.pubkey";
        keys[1] = "avatar";
        keys[2] = "description";

        string[] memory values = new string[](3);
        values[0] = "abc";
        values[1] = "ipfs://x";
        values[2] = "hello world";

        vm.prank(alice);
        names.setTextBatch(id, keys, values);

        assertEq(names.text(id, "axl.pubkey"), "abc");
        assertEq(names.text(id, "avatar"), "ipfs://x");
        assertEq(names.text(id, "description"), "hello world");
    }

    function test_setText_revertsNonOwner() public {
        uint256 id = _mint(alice);
        vm.prank(alice);
        names.register("alice", id);

        vm.prank(bob);
        vm.expectRevert(HelixNames.NameNotOwner.selector);
        names.setText(id, "axl.pubkey", "spoof");
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  resolveFull
    // ─────────────────────────────────────────────────────────────────────────

    function test_resolveFull_returnsOwner() public {
        uint256 id = _mint(alice);
        vm.prank(alice);
        names.register("alice", id);

        (uint256 t, address owner) = names.resolveFull("alice");
        assertEq(t, id);
        assertEq(owner, alice);
    }

    function test_resolveFull_revertsUnknown() public {
        vm.expectRevert(HelixNames.NameNotFound.selector);
        names.resolveFull("nobody");
    }
}
