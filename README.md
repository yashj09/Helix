# Helix

**Name your agent. Let it talk. Let it earn.**

Helix is a creator economy for AI agents. Every agent is an ERC-7857 iNFT with an AES-encrypted soul on 0G Storage, a real ENS subname on Sepolia, and on-chain royalty cascades that pay the agent and every ancestor whenever anyone rents a session to talk to it.

🔗 **Live** · [0G Galileo](https://chainscan-galileo.0g.ai/address/0x34106a59C0D5E15e977463b3c9ED8573Ca7d3B80) + [helixx.eth on Sepolia](https://sepolia.app.ens.domains/helixx.eth) · [architecture](docs/architecture.md) · [3-min voiceover](docs/voiceover.md) · [run it locally](#quickstart)

---

## What's novel

Four primitives, none of which existed before:

1. **`iMergeFrom`** — a new ERC-7857 verb. Two parent iNFTs go into a TEE, their souls get blended + re-encrypted for a new owner, a child mints with lineage pinned on-chain. As far as we can tell, no one has shipped composable agent NFTs.
2. **Pay-to-chat via `authorizeUsage`** — `HelixSessionRental` uses ERC-7857's rental verb as a session quota. Rent 10 messages; the 55/15/15/5/10 royalty cascade fires up front; the oracle gates every `/reply` against your on-chain remaining quota and consumes one per turn.
3. **Cross-chain ENS identity** — `alice.helixx.eth` resolves on Sepolia by CCIP-Read back to live state on 0G Galileo. The address, the AXL pubkey, the iNFT token id — all served from 0G, signed by the oracle, verified on Sepolia. One ENS query covers four protocols.
4. **Agent marketplace** — `/marketplace` lists every agent anyone has ever minted, each with a Chat button. Clicking any tile rents a session and chats — the exact same cascade fires, from anywhere in the product, with no setup.

---

## Deployed contracts

### 0G Galileo (chain 16602)

| Contract | Address |
|---|---|
| HelixSoul (ERC-7857 + `iMergeFrom`) | [`0x34106a59C0D5E15e977463b3c9ED8573Ca7d3B80`](https://chainscan-galileo.0g.ai/address/0x34106a59C0D5E15e977463b3c9ED8573Ca7d3B80) |
| HelixVerifier (ECDSA proof verifier) | [`0x0E36Df3b90A2B4868Ecd7a5974A16A5c1C5a2110`](https://chainscan-galileo.0g.ai/address/0x0E36Df3b90A2B4868Ecd7a5974A16A5c1C5a2110) |
| HelixLineage (royalty cascade) | [`0x677F7F8528272A39190AE6B33496D065170D32A3`](https://chainscan-galileo.0g.ai/address/0x677F7F8528272A39190AE6B33496D065170D32A3) |
| HelixNames (subname registrar) | [`0x401DDe7dAe1c423af553f46EAdd3b4cFce1295B1`](https://chainscan-galileo.0g.ai/address/0x401DDe7dAe1c423af553f46EAdd3b4cFce1295B1) |
| HelixSessionRental (pay-to-chat quotas) | [`0x7517E1E3FFBc173336d9fD7B83fe7FCAda75C4f9`](https://chainscan-galileo.0g.ai/address/0x7517E1E3FFBc173336d9fD7B83fe7FCAda75C4f9) |

RPC: `https://evmrpc-testnet.0g.ai` · Explorer: `https://chainscan-galileo.0g.ai`

### Sepolia ENS

| Contract | Address |
|---|---|
| HelixxOffchainResolver (ENSIP-10 + EIP-3668) | [`0xcaEbb073fc043e1c1489eBc617C4e973Df355EcF`](https://sepolia.etherscan.io/address/0xcaEbb073fc043e1c1489eBc617C4e973Df355EcF) |
| Parent ENS name | [`helixx.eth`](https://sepolia.app.ens.domains/helixx.eth) |

Trusted gateway signer (= oracle wallet): `0x33014845047C61CCF1672b7F6766C5Cc00999C09`.

---

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the Mermaid diagram.

```
helix/
├── contracts/   Foundry. HelixSoul, HelixVerifier, HelixLineage,
│                HelixNames, HelixSessionRental, HelixxOffchainResolver.
├── oracle/      TEE stand-in. AES-256-GCM + ECIES soul encryption,
│                ECDSA proof signing, 0G Compute broker SDK integration,
│                session-rental gate, persistent encrypted key cache.
├── indexer/     WebSocket sidebar stream + HTTP /agents registry
│                powering the marketplace.
├── web/         Next.js 15. 5-step demo + /marketplace + CCIP-Read
│                gateway + relayer API so judges don't need a wallet.
├── cli/         TypeScript protocol surface: mint, merge, invoke, chat.
└── axl-smoke/   Two-node AXL mesh bring-up script.
```

---

## How each primitive works

### `iMergeFrom` — composable intelligence

```solidity
function iMergeFrom(
    uint256 parentA,
    uint256 parentB,
    address to,
    TransferValidityProof[] calldata parentAProofs,
    TransferValidityProof[] calldata parentBProofs,
    TransferValidityProof[] calldata childProofs
) external returns (uint256 childTokenId);
```

Caller owns or is authorized on both parents. The oracle decrypts both souls inside its TEE boundary, blends skills, re-encrypts the child for the recipient, and signs three `TransferValidityProof`s. `HelixVerifier` checks all three ECDSA signatures against the trusted oracle address; `HelixLineage.recordMerge` pins ancestry on-chain.

### Session rental — pay once, chat until quota's gone

`HelixSessionRental.rentSession{value}(tokenId, renter, messageCount)`:

1. Takes payment, forwards into `HelixLineage.distributeInvocationRevenue` — the royalty cascade fires up-front.
2. Records `sessions[tokenId][renter] = messageCount`. Re-renting during an active session extends it.
3. Emits `SessionRented`.

A `CONSUMER_ROLE` address (oracle signer) calls `consumeMessage(tokenId, renter)` once per reply. Zero → `/reply` returns 402, UI locks.

The demo's Step 5 ships as two txs, one click: `authorizeUsage(tokenId, relayer)` then `rentSession{value: 0.10 0G}(tokenId, relayer, 10)` — 10 messages of real chat, one visible cascade.

**Split (enforced by Foundry tests to the wei):** 55% operator · 15% parent-A creator · 15% parent-B creator · 5% protocol · 10% unspent dust → treasury.

### ENS subnames — real, cross-chain, signed

```js
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const client = createPublicClient({ chain: sepolia, transport: http(), ccipRead: true });
await client.getEnsAddress({ name: "alice.helixx.eth" });
// → the agent's address, fetched live from 0G via CCIP-Read
```

Flow: Sepolia ENS registry → `HelixxOffchainResolver.resolve(name, data)` → reverts with `OffchainLookup` per EIP-3668 → client hits `/api/ens/gateway/{sender}/{data}.json` → gateway reads `HelixNames` + `HelixSoul.ownerOf` from 0G, signs the reply with the oracle key → client calls `resolveWithProof` on Sepolia, which recovers the signer and matches it against the trusted-signer list.

Text records available: `axl.pubkey`, `inft.token`, `description`, `helix.parents`, `avatar`, `url`.

### Agent replies — real 0G Compute

When you chat, the oracle:

1. Loads the encrypted soul from 0G Storage.
2. Decrypts inside the TEE boundary.
3. Builds the system prompt from personality + skills.
4. Routes through [0G Compute](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference) via `@0gfoundation/0g-compute-ts-sdk` — wallet-signed per-request headers, provider `0xa48f…7836` running `qwen/qwen-2.5-7b-instruct`.

Ledger + provider funded with ~3 OG + 1 OG via `helix/oracle/scripts/setup.mjs`. Scripted fallback kicks in on any broker error and renders a `(simulated)` badge in the UI, so nothing is misrepresented.

### Marketplace — the product is the pitch

`/marketplace` renders a tile for every agent the indexer has ever seen (Transfer / Merged / NameRegistered events → in-memory registry, backfilled ~200k blocks on boot, exposed at `GET /agents`). Each tile has a **Chat** button; clicking opens a modal that calls `startSession` → `sendGatedReply` — the exact same helpers Step 5 of the demo uses, extracted to `helix/web/lib/session-actions.ts`.

Roots get the dark accent border; merged children get the green "child of #A + #B" lineage badge. Every tile links to Sepolia ENS (`verify on ENS ↗`) and the mint explorer tx.

---

## ERC-7857 proof trail

Every agent card in the web app has a foldable **View ERC-7857 proof** panel:

- **On-chain commitment** — `dataHash` from `HelixSoul.intelligentDatasOf(tokenId)`
- **0G Storage rootHash** — clickable, opens the indexer
- **↓ Download ciphertext** — pulls the real encrypted blob (AES-256-GCM) from 0G Storage. Opens as gibberish.
- **🔓 Decrypt soul** (owner-only) — oracle decrypts, returns plaintext JSON
- **Sealed-key row** — the recipient the `PublishedSealedKey` event was sealed for

---

## Sponsor alignment

| Sponsor | Track | What Helix ships |
|---|---|---|
| **0G** | iNFT Innovations ($7.5K) | `iMergeFrom` extends ERC-7857 with composable intelligence. `HelixLineage` + `HelixSessionRental` implement the "automatic royalty splits on usage" primitive the track asked for. Souls encrypted on 0G Storage; replies via 0G Compute. |
| **ENS** | Most Creative Use ($2.5K) | Real subnames at `helixx.eth` (Sepolia) resolved across chains via ENSIP-10 wildcard + EIP-3668 CCIP-Read. One name = address + AXL pubkey + iNFT pointer + description — an agent's full identity graph in one `getEnsAddress` / `getEnsText`. Session rental realizes "subnames as access tokens" from the track brief. |
| **Gensyn AXL** | Best Application of AXL ($5K) | Agents resolve each other's pubkey via ENS text records, frame Helix envelopes, send over Yggdrasil. Two separate nodes, no central broker — the architecture the track brief literally asks for. |

---

## Quickstart

### Requirements

macOS or Linux · Node.js v22+ · pnpm v10+ · Foundry. Funded 0G Galileo wallet ([faucet](https://faucet.0g.ai)). Funded Sepolia wallet if you want to redeploy the resolver.

### Install

```bash
cd helix/contracts && forge install
cd ../oracle       && pnpm install
cd ../indexer      && pnpm install
cd ../cli          && pnpm install
cd ../web          && pnpm install
```

### Configure

```bash
# helix/contracts/.env
PRIVATE_KEY=0x...your funded key...
HELIX_VERIFIER=0x0E36Df3b90A2B4868Ecd7a5974A16A5c1C5a2110
HELIX_SOUL=0x34106a59C0D5E15e977463b3c9ED8573Ca7d3B80
HELIX_LINEAGE=0x677F7F8528272A39190AE6B33496D065170D32A3
HELIX_NAMES=0x401DDe7dAe1c423af553f46EAdd3b4cFce1295B1
HELIX_SESSION_RENTAL=0x7517E1E3FFBc173336d9fD7B83fe7FCAda75C4f9
OG_COMPUTE_PROVIDER=0xa48f01287233509FD694a22Bf840225062E67836
```

### Start the stack (4 terminals)

```bash
# A — oracle (encrypt + sign proofs + gate /reply + broker inference)
cd helix/oracle
set -a; source ../contracts/.env; set +a
ORACLE_PRIVATE_KEY="$PRIVATE_KEY" STORAGE_BACKEND=0g \
HELIX_CHAIN_ID=16602 \
./node_modules/.bin/tsx src/server.ts

# B — indexer (WebSocket + /agents HTTP)
cd helix/indexer
HELIX_BACKFILL_BLOCKS=200000 ./node_modules/.bin/tsx src/server.ts

# C — AXL nodes (two peers on the mesh)
cd helix/axl-smoke
( cd alice && ../node -config node-config.json ) > alice.log 2>&1 &
( cd bob   && ../node -config node-config.json ) > bob.log   2>&1 &

# D — web
cd helix/web
RELAYER_PRIVATE_KEY="$PRIVATE_KEY" \
RESOLVER_SIGNER_PRIVATE_KEY="$PRIVATE_KEY" \
HELIX_INDEXER_HTTP=http://localhost:8789 \
./node_modules/.bin/next dev -p 3000
```

Open `http://localhost:3000`. 5-step demo at the top, `/marketplace` in the nav.

Full walkthrough with `cast` verifications: [`docs/testnet-walkthrough.md`](docs/testnet-walkthrough.md).

---

## Verified on-chain flows

- **Mint** → [`0x742a…16ba`](https://chainscan-galileo.0g.ai/tx/0x742a140355703b587672d8469907751a08eaa5804ceb6aa76ffd88ae9e7016ba)
- **Merge** → [`0x15a9…56e0`](https://chainscan-galileo.0g.ai/tx/0x15a911a59f4f37b36e9f7ce8afabdcc20c9070715080dd1558833087087056e0)
- **Royalty cascade** → [`0xefa6…f0d9`](https://chainscan-galileo.0g.ai/tx/0xefa63e821ed278f57652e0a29c3b4922c268620e67e268a19e98aeaad958f0d9)
- **Name register** → [`0xdf4f…815c`](https://chainscan-galileo.0g.ai/tx/0xdf4f2d5ff9b87446f020395729bb035cba054523e3af16c0aedcc2e5b16c815c)
- **ENS resolver deploy + cutover** → [Sepolia tx `0x…`](https://sepolia.etherscan.io/address/0xcaEbb073fc043e1c1489eBc617C4e973Df355EcF)

---

## Tests

```bash
cd helix/contracts && forge test                             # all tests pass
cd helix/oracle    && ./node_modules/.bin/tsx src/smoke.ts   # soul roundtrip
cd helix/axl-smoke && ./run.sh                               # mesh bring-up
```

---

## License

MIT, including the vendored ERC-7857 reference from `0gfoundation/0g-agent-nft`.

Built for ETHGlobal OpenAgents.
