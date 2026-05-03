// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import {HelixSessionRental} from "../src/helix/HelixSessionRental.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Deploy HelixSessionRental alongside already-deployed HelixSoul + HelixLineage,
///         then grant CONSUMER_ROLE to the oracle signer so `/reply` can consume messages.
contract DeploySessionRental is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address soul = vm.envAddress("HELIX_SOUL");
        address lineage = vm.envAddress("HELIX_LINEAGE");
        address oracle = vm.envAddress("ORACLE_SIGNER");
        address admin = vm.envOr("ADMIN", deployer);

        console.log("Deployer:", deployer);
        console.log("HelixSoul:", soul);
        console.log("HelixLineage:", lineage);
        console.log("Oracle (CONSUMER_ROLE grantee):", oracle);
        console.log("Admin:", admin);

        vm.startBroadcast(pk);

        HelixSessionRental impl = new HelixSessionRental();
        bytes memory init = abi.encodeCall(
            HelixSessionRental.initialize,
            (soul, lineage, admin)
        );
        HelixSessionRental rental =
            HelixSessionRental(address(new ERC1967Proxy(address(impl), init)));

        // Grant CONSUMER_ROLE to the oracle signer so it can call consumeMessage().
        if (oracle != admin) {
            rental.setConsumer(oracle, true);
        }

        vm.stopBroadcast();

        console.log("HelixSessionRental:", address(rental));

        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "sessionRental": "', vm.toString(address(rental)), '",\n',
            '  "oracleSigner": "', vm.toString(oracle), '"\n',
            "}\n"
        );
        string memory path = string.concat(
            "deployments/session-rental-",
            vm.toString(block.chainid),
            ".json"
        );
        vm.writeFile(path, json);
        console.log("Wrote", path);
    }
}
