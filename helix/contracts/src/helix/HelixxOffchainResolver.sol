// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title HelixxOffchainResolver
/// @notice ENS resolver on Sepolia that bridges queries for `*.helixx.eth` to Helix data
///         living on 0G Galileo. Implements ENSIP-10 (wildcard resolution) + ERC-3668
///         (CCIP-Read): reverts with `OffchainLookup`, then verifies the gateway's signed
///         response against a trusted signer.
/// @dev    Lifted from the canonical ENS Labs OffchainResolver template with the signature-
///         verification logic inlined (no library dependency) so the contract compiles
///         standalone in the Helix tree.
contract HelixxOffchainResolver {
    string public url;
    mapping(address => bool) public signers;
    address public owner;

    event NewSigners(address[] signers);
    event UrlChanged(string newUrl);
    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    constructor(string memory _url, address[] memory _signers) {
        url = _url;
        owner = msg.sender;
        for (uint256 i = 0; i < _signers.length; i++) {
            signers[_signers[i]] = true;
        }
        emit NewSigners(_signers);
    }

    /// @dev Simple owner-gated knobs so we can point at a different gateway URL (e.g. after
    ///      Vercel deploy) without redeploying the resolver contract.
    function setUrl(string calldata _url) external {
        require(msg.sender == owner, "not owner");
        url = _url;
        emit UrlChanged(_url);
    }

    function setSigner(address who, bool allowed) external {
        require(msg.sender == owner, "not owner");
        signers[who] = allowed;
        address[] memory arr = new address[](1);
        arr[0] = who;
        emit NewSigners(arr);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  ENSIP-10 / EIP-3668
    // ─────────────────────────────────────────────────────────────────────────

    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory)
    {
        // The gateway receives the exact `resolve(name, data)` call verbatim so it can
        // decode the inner record selector itself (addr / text / etc).
        bytes memory callData = abi.encodeWithSelector(
            IResolverService.resolve.selector,
            name,
            data
        );
        string[] memory urls = new string[](1);
        urls[0] = url;
        revert OffchainLookup(
            address(this),
            urls,
            callData,
            this.resolveWithProof.selector,
            abi.encode(callData, address(this))
        );
    }

    /// @notice CCIP-Read callback. The gateway returned `abi.encode(result, expires, sig)`;
    ///         we recover the signer over the canonical hash, ensure it's trusted, return result.
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (bytes memory result, uint64 expires, bytes memory sig) =
            abi.decode(response, (bytes, uint64, bytes));
        (bytes memory innerReq, address sender) = abi.decode(extraData, (bytes, address));
        bytes32 h = _signatureHash(sender, expires, innerReq, result);
        address signer = _recover(h, sig);
        require(signers[signer], "HelixxResolver: bad sig");
        require(expires >= block.timestamp, "HelixxResolver: expired");
        return result;
    }

    /// @dev ERC-165. The wildcard-resolver interfaceId is 0x9061b923 per ENSIP-10.
    function supportsInterface(bytes4 interfaceID) external pure returns (bool) {
        return
            interfaceID == 0x9061b923 || // IExtendedResolver
            interfaceID == 0x01ffc9a7;   // ERC-165 itself
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Internals — canonical ENS CCIP-Read signing scheme
    //    h = keccak256(0x1900 || sender || expires || keccak256(request) || keccak256(result))
    // ─────────────────────────────────────────────────────────────────────────

    function _signatureHash(
        address sender,
        uint64 expires,
        bytes memory request,
        bytes memory result
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                hex"1900",
                sender,
                expires,
                keccak256(request),
                keccak256(result)
            )
        );
    }

    function _recover(bytes32 h, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        if (v < 27) v += 27;
        return ecrecover(h, v, r, s);
    }
}

interface IResolverService {
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory result, uint64 expires, bytes memory sig);
}
