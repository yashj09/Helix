// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {HelixSoul} from "../src/helix/HelixSoul.sol";
import {HelixLineage} from "../src/helix/HelixLineage.sol";
import {HelixVerifier} from "../src/helix/HelixVerifier.sol";
import {IntelligentData} from "../src/vendored/interfaces/IERC7857Metadata.sol";
import {
    TransferValidityProof,
    AccessProof,
    OwnershipProof,
    OracleType
} from "../src/vendored/interfaces/IERC7857DataVerifier.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract HelixVerifierTest is Test {
    HelixSoul soul;
    HelixLineage lineage;
    HelixVerifier verifier;

    address admin = address(0xA11CE);
    address treasury = address(0xFEE);

    Vm.Wallet oracleW;
    Vm.Wallet aliceW;
    Vm.Wallet bobW;
    Vm.Wallet carolW;

    address oracle;
    address alice;
    address bob;
    address carol;

    function setUp() public {
        oracleW = vm.createWallet("oracle");
        aliceW = vm.createWallet("alice");
        bobW = vm.createWallet("bob");
        carolW = vm.createWallet("carol");
        oracle = oracleW.addr;
        alice = aliceW.addr;
        bob = bobW.addr;
        carol = carolW.addr;

        // Deploy real HelixVerifier with oracle's ECDSA address as the trusted signer
        HelixVerifier verifierImpl = new HelixVerifier();
        bytes memory verifierInit = abi.encodeCall(HelixVerifier.initialize, (oracle, admin));
        ERC1967Proxy verifierProxy = new ERC1967Proxy(address(verifierImpl), verifierInit);
        verifier = HelixVerifier(address(verifierProxy));

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

    function _pubkey64(Vm.Wallet memory w) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(w.publicKeyX), bytes32(w.publicKeyY));
    }

    function _signedProof(bytes32 dataHash, Vm.Wallet memory receiver)
        internal
        view
        returns (TransferValidityProof[] memory proofs)
    {
        bytes memory targetPubkey = _pubkey64(receiver);
        bytes memory emptyBytes = "";
        bytes memory nonce = bytes("n1");
        bytes memory sealedKey = hex"cafe";

        // ACCESS signature
        bytes32 accessDigest = keccak256(
            abi.encode(
                block.chainid,
                address(verifier),
                "ACCESS",
                receiver.addr,
                dataHash,
                keccak256(emptyBytes),
                keccak256(nonce)
            )
        );
        bytes32 accessEth = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", accessDigest));
        (uint8 av, bytes32 ar, bytes32 as_) = vm.sign(oracleW.privateKey, accessEth);
        bytes memory accessSig = abi.encodePacked(ar, as_, av);

        // OWNERSHIP signature
        bytes32 ownDigest = keccak256(
            abi.encode(
                block.chainid,
                address(verifier),
                "OWNERSHIP",
                uint8(OracleType.TEE),
                dataHash,
                keccak256(sealedKey),
                keccak256(targetPubkey),
                keccak256(nonce)
            )
        );
        bytes32 ownEth = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", ownDigest));
        (uint8 ov, bytes32 or_, bytes32 os_) = vm.sign(oracleW.privateKey, ownEth);
        bytes memory ownSig = abi.encodePacked(or_, os_, ov);

        proofs = new TransferValidityProof[](1);
        proofs[0] = TransferValidityProof({
            accessProof: AccessProof({
                dataHash: dataHash,
                targetPubkey: emptyBytes,
                nonce: nonce,
                proof: abi.encode(receiver.addr, accessSig)
            }),
            ownershipProof: OwnershipProof({
                oracleType: OracleType.TEE,
                dataHash: dataHash,
                sealedKey: sealedKey,
                targetPubkey: targetPubkey,
                nonce: nonce,
                proof: ownSig
            })
        });
    }

    function _soulData(bytes32 hash) internal pure returns (IntelligentData[] memory d) {
        d = new IntelligentData[](1);
        d[0] = IntelligentData({dataDescription: "helix-soul-v1", dataHash: hash});
    }

    function test_realVerifier_mergeWithSignedProofs() public {
        bytes32 aHash = keccak256("a-soul");
        bytes32 bHash = keccak256("b-soul");
        bytes32 cHash = keccak256("child-soul");

        vm.prank(alice);
        uint256 aId = soul.mint(_soulData(aHash), alice);
        vm.prank(bob);
        uint256 bId = soul.mint(_soulData(bHash), bob);

        vm.prank(alice);
        soul.authorizeUsage(aId, carol);
        vm.prank(bob);
        soul.authorizeUsage(bId, carol);

        TransferValidityProof[] memory ap = _signedProof(aHash, carolW);
        TransferValidityProof[] memory bp = _signedProof(bHash, carolW);
        TransferValidityProof[] memory cp = _signedProof(cHash, carolW);

        vm.prank(carol);
        uint256 childId = soul.iMergeFrom(aId, bId, carol, ap, bp, cp);

        assertEq(soul.ownerOf(childId), carol, "carol owns child");
        assertEq(lineage.ancestorsOf(childId).length, 2, "2 direct parents recorded");
    }

    function _forgedProof(bytes32 dataHash, Vm.Wallet memory receiver)
        internal
        view
        returns (TransferValidityProof[] memory proofs)
    {
        bytes memory targetPubkey = _pubkey64(receiver);
        bytes memory emptyBytes = "";
        bytes memory nonce = bytes("forge");
        bytes memory sealedKey = hex"cafe";

        // Sign ACCESS with wrong key (bob instead of oracle)
        bytes32 accessDigest = keccak256(
            abi.encode(
                block.chainid, address(verifier), "ACCESS", receiver.addr,
                dataHash, keccak256(emptyBytes), keccak256(nonce)
            )
        );
        bytes32 accessEth = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", accessDigest));
        (uint8 av, bytes32 ar, bytes32 as_) = vm.sign(bobW.privateKey, accessEth);
        bytes memory badSig = abi.encodePacked(ar, as_, av);

        bytes32 ownDigest = keccak256(
            abi.encode(
                block.chainid, address(verifier), "OWNERSHIP", uint8(OracleType.TEE),
                dataHash, keccak256(sealedKey), keccak256(targetPubkey), keccak256(nonce)
            )
        );
        bytes32 ownEth = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", ownDigest));
        (uint8 ov, bytes32 or_, bytes32 os_) = vm.sign(oracleW.privateKey, ownEth);
        bytes memory ownSig = abi.encodePacked(or_, os_, ov);

        proofs = new TransferValidityProof[](1);
        proofs[0] = TransferValidityProof({
            accessProof: AccessProof({
                dataHash: dataHash, targetPubkey: emptyBytes, nonce: nonce,
                proof: abi.encode(receiver.addr, badSig)
            }),
            ownershipProof: OwnershipProof({
                oracleType: OracleType.TEE, dataHash: dataHash, sealedKey: sealedKey,
                targetPubkey: targetPubkey, nonce: nonce, proof: ownSig
            })
        });
    }

    function test_realVerifier_rejectsForgedSignature() public {
        bytes32 aHash = keccak256("a");
        bytes32 bHash = keccak256("b");
        bytes32 cHash = keccak256("c");

        vm.prank(alice);
        uint256 aId = soul.mint(_soulData(aHash), alice);
        vm.prank(alice);
        uint256 bId = soul.mint(_soulData(bHash), alice);

        TransferValidityProof[] memory ap = _forgedProof(aHash, aliceW);
        TransferValidityProof[] memory bp = _signedProof(bHash, aliceW);
        TransferValidityProof[] memory cp = _signedProof(cHash, aliceW);

        vm.prank(alice);
        vm.expectRevert(HelixVerifier.HelixVerifierBadAccessSig.selector);
        soul.iMergeFrom(aId, bId, alice, ap, bp, cp);
    }
}
