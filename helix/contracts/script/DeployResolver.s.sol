// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console.sol";

import {HelixxOffchainResolver} from "../src/helix/HelixxOffchainResolver.sol";

/// @notice Deploy HelixxOffchainResolver to Sepolia, then cut over helixx.eth's resolver on
///         the ENS registry. Requires RESOLVER_GATEWAY_URL + RESOLVER_SIGNER + ENS_NAME env.
contract DeployResolver is Script {
    /// @dev Sepolia ENS Registry (same address as mainnet — ENS registry is chain-deployed
    ///      at a deterministic address via ENS deployment scripts).
    address constant ENS_REGISTRY = 0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory gatewayUrl = vm.envString("RESOLVER_GATEWAY_URL");
        address signer = vm.envAddress("RESOLVER_SIGNER");
        bytes32 ensNode = vm.envBytes32("ENS_NAMEHASH");

        address deployer = vm.addr(pk);
        console.log("Deployer:", deployer);
        console.log("Gateway URL:", gatewayUrl);
        console.log("Signer (trusted gateway key):", signer);
        console.logBytes32(ensNode);

        vm.startBroadcast(pk);

        address[] memory signers = new address[](1);
        signers[0] = signer;
        HelixxOffchainResolver resolver = new HelixxOffchainResolver(gatewayUrl, signers);

        // Cut over: point helixx.eth's resolver at us on the ENS registry.
        // registry.setResolver(node, resolver)
        (bool ok,) = ENS_REGISTRY.call(
            abi.encodeWithSignature(
                "setResolver(bytes32,address)",
                ensNode,
                address(resolver)
            )
        );
        require(ok, "setResolver failed");

        vm.stopBroadcast();

        console.log("HelixxOffchainResolver:", address(resolver));

        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "resolver": "', vm.toString(address(resolver)), '",\n',
            '  "signer": "', vm.toString(signer), '",\n',
            '  "gatewayUrl": "', gatewayUrl, '",\n',
            '  "ensNode": "', vm.toString(ensNode), '"\n',
            "}\n"
        );
        string memory path = string.concat(
            "deployments/resolver-",
            vm.toString(block.chainid),
            ".json"
        );
        vm.writeFile(path, json);
        console.log("Wrote", path);
    }
}
