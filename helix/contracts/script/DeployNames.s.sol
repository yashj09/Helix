// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import {HelixNames} from "../src/helix/HelixNames.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// Deploy HelixNames only, alongside an already-deployed HelixSoul.
///
/// Usage:
///   DEPLOYER_PRIVATE_KEY=0x... HELIX_SOUL=0x... \
///   forge script script/DeployNames.s.sol --rpc-url https://evmrpc-testnet.0g.ai \
///     --broadcast --priority-gas-price 2gwei --with-gas-price 3gwei
contract DeployNames is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address soul = vm.envAddress("HELIX_SOUL");
        address admin = vm.envOr("ADMIN", deployer);

        console.log("Deployer:", deployer);
        console.log("HelixSoul:", soul);
        console.log("Admin:", admin);

        vm.startBroadcast(pk);

        HelixNames impl = new HelixNames();
        bytes memory init = abi.encodeCall(HelixNames.initialize, (soul, admin));
        HelixNames names = HelixNames(address(new ERC1967Proxy(address(impl), init)));

        vm.stopBroadcast();

        console.log("HelixNames:", address(names));

        // Companion JSON — easy to merge into deployments/{chainId}.json
        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "names": "', vm.toString(address(names)), '"\n',
            "}\n"
        );
        string memory path = string.concat("deployments/names-", vm.toString(block.chainid), ".json");
        vm.writeFile(path, json);
        console.log("Wrote", path);
    }
}
