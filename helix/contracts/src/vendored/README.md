# Vendored ERC-7857 reference code

**Source:** https://github.com/0gfoundation/0g-agent-nft
**Pinned commit:** `b86e108a49bf3601bf57f1f0b3166dce2cb15928`
**License:** MIT (from upstream `LICENSE.md`)

## What's here

Only the ERC-7857 primitives Helix actually needs:

```
ERC7857Upgradeable.sol              — base implementation (proof check, transfer)
Utils.sol                           — pubKeyToAddress helper
extensions/
  ERC7857AuthorizeUpgradeable.sol   — authorizeUsage / revokeAuthorization
  ERC7857CloneableUpgradeable.sol   — iCloneFrom
  ERC7857IDataStorageUpgradeable.sol — IntelligentData storage
interfaces/
  IERC7857.sol, IERC7857Authorize.sol, IERC7857Cloneable.sol,
  IERC7857DataVerifier.sol, IERC7857Metadata.sol
```

The upstream repo also ships `AgentNFT.sol` / `AgentMarket.sol` / `TeeVerifier.sol` / `verifiers/` — Helix **replaces** those (see `src/helix/HelixSoul.sol`, `HelixLineage.sol`, `HelixVerifier.sol`), so they are not vendored here.

## Re-vendoring (if upstream updates)

```bash
# from repo root
git clone --depth 1 https://github.com/0gfoundation/0g-agent-nft.git /tmp/agent-nft
cd /tmp/agent-nft && git rev-parse HEAD   # record new commit SHA, update this README

# copy only the files Helix needs
DEST=<repo>/helix/contracts/src/vendored
cp contracts/ERC7857Upgradeable.sol   $DEST/
cp contracts/Utils.sol                $DEST/
cp contracts/extensions/ERC7857AuthorizeUpgradeable.sol    $DEST/extensions/
cp contracts/extensions/ERC7857CloneableUpgradeable.sol    $DEST/extensions/
cp contracts/extensions/ERC7857IDataStorageUpgradeable.sol $DEST/extensions/
cp contracts/interfaces/IERC7857.sol             $DEST/interfaces/
cp contracts/interfaces/IERC7857Authorize.sol    $DEST/interfaces/
cp contracts/interfaces/IERC7857Cloneable.sol    $DEST/interfaces/
cp contracts/interfaces/IERC7857DataVerifier.sol $DEST/interfaces/
cp contracts/interfaces/IERC7857Metadata.sol     $DEST/interfaces/

cd $DEST/.. && forge test                        # re-run tests
```

## Rebuilding the AXL binary (not vendored — too large)

Helix's `axl-smoke/run.sh` expects an `axl-smoke/node` binary. Rebuild from source:

```bash
git clone --depth 1 https://github.com/gensyn-ai/axl.git /tmp/axl
cd /tmp/axl && GOTOOLCHAIN=go1.25.5 make build
cp node <repo>/helix/axl-smoke/
```

Requires Go 1.25.5+.

## Rule

Do not modify vendored files in place. All Helix-specific code lives under `src/helix/`.
