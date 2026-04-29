// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import {HelixSoul} from "../src/helix/HelixSoul.sol";
import {HelixLineage} from "../src/helix/HelixLineage.sol";
import {HelixVerifier} from "../src/helix/HelixVerifier.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// Deploy Helix: HelixVerifier → HelixSoul → HelixLineage, all behind ERC1967 proxies.
///
/// Usage:
///   DEPLOYER_PRIVATE_KEY=0x... ORACLE_SIGNER=0x... \
///   forge script script/Deploy.s.sol --rpc-url zg_testnet --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address oracle = vm.envAddress("ORACLE_SIGNER");
        address treasury = vm.envOr("TREASURY", deployer);
        address admin = vm.envOr("ADMIN", deployer);

        console.log("Deployer:", deployer);
        console.log("Oracle signer:", oracle);
        console.log("Treasury:", treasury);
        console.log("Admin:", admin);

        vm.startBroadcast(pk);

        // 1. Verifier
        HelixVerifier verifierImpl = new HelixVerifier();
        bytes memory verifierInit = abi.encodeCall(HelixVerifier.initialize, (oracle, admin));
        HelixVerifier verifier = HelixVerifier(address(new ERC1967Proxy(address(verifierImpl), verifierInit)));
        console.log("HelixVerifier:", address(verifier));

        // 2. Soul
        HelixSoul soulImpl = new HelixSoul();
        bytes memory soulInit = abi.encodeCall(
            HelixSoul.initialize,
            ("Helix Soul", "SOUL", address(verifier), admin)
        );
        HelixSoul soul = HelixSoul(address(new ERC1967Proxy(address(soulImpl), soulInit)));
        console.log("HelixSoul:", address(soul));

        // 3. Lineage
        HelixLineage lineageImpl = new HelixLineage();
        bytes memory lineageInit = abi.encodeCall(
            HelixLineage.initialize,
            (address(soul), treasury, admin)
        );
        HelixLineage lineage = HelixLineage(address(new ERC1967Proxy(address(lineageImpl), lineageInit)));
        console.log("HelixLineage:", address(lineage));

        // 4. Wire lineage into soul (deployer must be ADMIN)
        soul.setLineage(address(lineage));
        console.log("HelixSoul.setLineage completed");

        vm.stopBroadcast();

        // 5. Persist deployment addresses for CLI/oracle consumption
        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "verifier": "', vm.toString(address(verifier)), '",\n',
            '  "soul": "', vm.toString(address(soul)), '",\n',
            '  "lineage": "', vm.toString(address(lineage)), '",\n',
            '  "oracle": "', vm.toString(oracle), '",\n',
            '  "treasury": "', vm.toString(treasury), '",\n',
            '  "admin": "', vm.toString(admin), '"\n',
            "}\n"
        );
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeFile(path, json);
        console.log("Wrote", path);
    }
}
