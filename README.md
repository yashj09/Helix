# Helix

**Name your agent. Let it talk. Let it earn.**

Helix turns AI agents into **named, addressable, revenue-earning iNFTs** on 0G. Every time someone messages your agent — or any descendant of your agent — you get paid automatically, forever.

🔗 **Live on 0G Galileo testnet** (chain 16602) · [watch the 3-min demo](docs/video-script.md) · [try it locally](#quickstart)

---

## The idea

> We built the primitive missing from the "AI agents everywhere" story: **an on-chain creator economy for agents.**
>
> - **Names** — every agent has a real ENS subname (`alice.helixx.eth`) bound to its iNFT, resolvable from any mainnet ENS client via CCIP-Read.
> - **Networks** — agents find each other by resolving their on-chain name → mesh pubkey, and talk over Gensyn's AXL P2P network.
> - **Royalties** — when an agent gets invoked, payment cascades up its full ancestry: parents, grandparents, protocol. Automatically. Forever.

It's three sponsor primitives composed into something that didn't exist before:

| Layer | Primitive | Sponsor |
|---|---|---|
| Ownership + private intelligence | ERC-7857 iNFTs with `iMergeFrom` | **0G** |
| Identity + capability bundle | Subname registrar with text records | **ENS-style** |
| Transport | Encrypted P2P mesh, pubkey-addressed | **Gensyn AXL** |

Remove any one and the product stops working — which is why the integration is the point, not a sticker.

---

## What's in the box

```
helix/
├── contracts/          Foundry project — HelixSoul, HelixVerifier,
│                       HelixLineage, HelixNames. 21/21 tests pass.
│                       Deployed + verified on 0G Galileo.
├── oracle/             Node.js TEE-stand-in: AES-256-GCM + ECIES soul
│                       encryption, ECDSA proof signing, persistent
│                       encrypted key cache that survives restarts.
├── indexer/            Tiny WebSocket server that streams HelixSoul /
│                       HelixNames / HelixLineage events to UI clients.
├── cli/                TypeScript CLI: mint, merge, invoke, name, chat
│                       — full developer surface for the protocol.
├── web/                Next.js 15 app. Minimal light modernist theme.
│                       Interactive demo (5 steps), terminal sidebar
│                       with live on-chain events, relayer-signed txs
│                       so judges don't need a wallet.
└── axl-smoke/          Two-node AXL mesh smoke test (run.sh).
```

---

## Deployed contracts (0G Galileo, chain 16602)

| Contract | Address |
|---|---|
| HelixSoul (ERC-7857 iNFT with `iMergeFrom`) | [`0x34106a59C0D5E15e977463b3c9ED8573Ca7d3B80`](https://chainscan-galileo.0g.ai/address/0x34106a59C0D5E15e977463b3c9ED8573Ca7d3B80) |
| HelixVerifier (ECDSA proof verifier) | [`0x0E36Df3b90A2B4868Ecd7a5974A16A5c1C5a2110`](https://chainscan-galileo.0g.ai/address/0x0E36Df3b90A2B4868Ecd7a5974A16A5c1C5a2110) |
| HelixLineage (royalty cascade) | [`0x677F7F8528272A39190AE6B33496D065170D32A3`](https://chainscan-galileo.0g.ai/address/0x677F7F8528272A39190AE6B33496D065170D32A3) |
| HelixNames (ENS-style registrar) | [`0x401DDe7dAe1c423af553f46EAdd3b4cFce1295B1`](https://chainscan-galileo.0g.ai/address/0x401DDe7dAe1c423af553f46EAdd3b4cFce1295B1) |
| HelixSessionRental (pay-to-chat quotas) | [`0x7517E1E3FFBc173336d9fD7B83fe7FCAda75C4f9`](https://chainscan-galileo.0g.ai/address/0x7517E1E3FFBc173336d9fD7B83fe7FCAda75C4f9) |

RPC: `https://evmrpc-testnet.0g.ai` · Explorer: `https://chainscan-galileo.0g.ai`

### ENS (Sepolia)

| Contract | Address |
|---|---|
| HelixxOffchainResolver (ENSIP-10 + CCIP-Read) | [`0xcaEbb073fc043e1c1489eBc617C4e973Df355EcF`](https://sepolia.etherscan.io/address/0xcaEbb073fc043e1c1489eBc617C4e973Df355EcF) |
| Parent ENS name | [`helixx.eth`](https://sepolia.app.ens.domains/helixx.eth) |
| Trusted gateway signer | `0x33014845047C61CCF1672b7F6766C5Cc00999C09` (oracle wallet) |

---

## What's new (the novel primitive)

ERC-7857 ships with `transfer`, `cloneTo`, and `authorizeUsage`. Helix adds the missing verb:

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

- Caller must own or be authorized on **both** parents.
- Oracle decrypts both souls inside a TEE boundary, blends them, re-encrypts the child for the recipient, and signs three `TransferValidityProof`s.
- The contract verifies all three ECDSA signatures against the trusted oracle, mints the child, then calls `HelixLineage.recordMerge` to pin ancestry on-chain.
- Future `invoke` payments cascade exactly: **55% operator · 15% parent A creator · 15% parent B creator · 5% protocol · 10% unspent grandparent budget → treasury**. Verified by Foundry tests to balance to the wei.

This is what gives descendants real economic weight. It's the difference between "Open-source the agent and hope" and "Rent out the agent forever, mathematically."

## ERC-7857 proof trail — not just a claim

The 0G iNFT track brief asks for *"proof that the intelligence/memory is embedded."* Every agent card in the web app has a foldable **View ERC-7857 proof** panel that exposes the full receipt chain per token:

- **On-chain commitment** — `dataHash` returned by `HelixSoul.intelligentDatasOf(tokenId)`
- **0G Storage rootHash** — the encrypted soul's merkle root in 0G's decentralized storage
- **↓ Download ciphertext** — pulls the real encrypted blob (AES-256-GCM) from 0G Storage. Opening it shows gibberish — that's the proof the intelligence is there but private.
- **🔓 Decrypt soul** (owner-only) — TEE oracle decrypts and returns the plaintext JSON: personality, skills, memory refs
- **Sidebar** — every mint/merge triggers a canonical `PublishedSealedKey` event, labeled `🔒` in the live indexer feed

## ENS identity — real subnames, resolved across chains

Every minted agent gets a real ENS subname under [`helixx.eth`](https://sepolia.app.ens.domains/helixx.eth) on Sepolia. `alice.helixx.eth` is not a cosmetic label — it's a mainnet-style ENS name that resolves, from any ENS-aware client, to the agent's on-chain address, AXL pubkey, and iNFT token ID.

**How it works** (ENSIP-10 wildcard + EIP-3668 CCIP-Read):

1. Mint on 0G Galileo registers `alice` in `HelixNames` + writes `axl.pubkey`, `inft.token`, `description` text records
2. Sepolia `helixx.eth`'s resolver is our [`HelixxOffchainResolver`](helix/contracts/src/helix/HelixxOffchainResolver.sol) at `0xcaEbb073fc043e1c1489eBc617C4e973Df355EcF`
3. When a client calls `getEnsAddress({ name: "alice.helixx.eth" })` the resolver reverts with `OffchainLookup(...)` per EIP-3668
4. Client hits our CCIP-Read gateway at `/api/ens/gateway/{sender}/{data}.json`
5. Gateway decodes the DNS name + record selector, reads `HelixNames` + `HelixSoul.ownerOf` from 0G, signs the reply with the oracle's key, returns
6. Client calls `resolveWithProof(response, extraData)` on the Sepolia resolver — the contract recovers the signer, verifies it's in `signers[...]`, returns the record

**What this unlocks:**
- **Agent-to-agent discovery.** AXL peers address each other via `axl.pubkey` stored as an ENS text record. No off-chain directory — the mesh routes using the same names humans read.
- **Cross-chain identity.** 0G stays the source of truth for iNFT state (minting, encryption, royalties); ENS is the identity window any chain's tooling can read from.
- **Verifiable records.** Every gateway response is ECDSA-signed by the oracle key registered in the resolver. The signature proves the record wasn't forged between 0G and your wallet.

**Verify end-to-end** — on any Sepolia-enabled wallet:
```js
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const client = createPublicClient({ chain: sepolia, transport: http(), ccipRead: true });
await client.getEnsAddress({ name: "alice.helixx.eth" });
// → the agent's address, fetched live from 0G via CCIP-Read
```

## Session rental — `authorizeUsage` in action

ERC-7857 defines `authorizeUsage(tokenId, user)` — the owner grants a third party the right to invoke the iNFT without transferring ownership. Helix uses it as the canonical pay-to-chat primitive.

`HelixSessionRental.rentSession{value}(tokenId, renter, messageCount)`:
1. Takes payment, forwards it straight into `HelixLineage.distributeInvocationRevenue` — the royalty cascade fires *upfront*, not at end of conversation.
2. Records `sessions[tokenId][renter] = messageCount` in its own storage (additive — renting during an active session extends it).
3. Emits `SessionRented`.

A `CONSUMER_ROLE` address (the oracle's signer) calls `consumeMessage(tokenId, renter)` once per reply. When the quota hits zero, the oracle's `/reply` endpoint returns 402 and the UI stops accepting input.

In the demo's Step 5 the relayer, who owns the minted iNFTs, signs both txs on the visitor's behalf: `authorizeUsage(tokenId, relayer)` then `rentSession{value: 0.10 0G}(tokenId, relayer, 10)`. One click, two txs, one cascade, ten messages of real chat.

## Marketplace — every agent, one click away

The 5-step demo teaches the concept. The marketplace at `/marketplace` **is** the concept: a live grid of every agent iNFT anyone has ever minted on Helix, each with a **Chat** button that rents a session and opens a gated chat modal — no mint required.

**How it's wired:**

1. The indexer (`helix/indexer`) keeps an in-memory registry updated by `Transfer` / `Merged` / `NameRegistered` / `TextChanged` / `RoyaltyFlowed` events and backfills ~200k blocks on boot. Snapshot exposed at `GET /agents` on port 8789.
2. The Next.js app proxies via `/api/agents`, enriches each row with `dataHash` (read lazily from `HelixSoul.intelligentDatasOf`), and renders a responsive grid of tiles.
3. Clicking **Chat** opens a modal that calls `startSession(tokenId, 10)` → `sendGatedReply(...)` — the same primitives the 5-step demo uses, extracted into `helix/web/lib/session-actions.ts` so both surfaces share one code path.
4. Every rented session fires a real royalty cascade. Repeated marketplace visits pound the "talk-to-descendant, ancestors-earn" narrative on-chain, visible in the sidebar as `SessionRented` + five `Royalty` events per click.

Roots render with the dark accent border; merged children get the green "child of #A + #B" lineage badge. Every tile links to Sepolia ENS (`verify on ENS ↗`) and the mint explorer tx — all agents are simultaneously iNFTs, ENS names, and marketplace listings.

## Agent replies powered by 0G Compute

When you chat with an agent in the demo, its reply is generated from its *own soul* (personality + skills), not a global LLM. The oracle exposes `POST /reply` which:
1. Loads the encrypted soul from 0G Storage
2. Decrypts inside the TEE boundary
3. Builds a system prompt from the agent's personality + skills
4. Routes the request through the [0G Compute Network](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference) when `OG_COMPUTE_PROVIDER` is set (`@0gfoundation/0g-compute-ts-sdk` wallet-signed request headers → provider's HTTP endpoint). Current demo provider: `0xa48f...7836` running `qwen/qwen-2.5-7b-instruct`. Falls back to a deterministic scripted reply on any error.

The scripted fallback is the default so the demo stays reliable even when testnet providers blip. One-time setup to flip on real inference: `addLedger(3 OG)` + `transferFund(provider, 'inference', 1 OG)` from the oracle wallet (`helix/oracle/scripts/setup.mjs`). The `(simulated)` badge in the UI surfaces `fallback: true` responses so nothing is misrepresented.

---

## Quickstart

### Requirements

- macOS or Linux · Node.js v22+ · pnpm v10+ · Foundry · Go 1.25+ (only if rebuilding AXL)
- A funded 0G Galileo testnet wallet ([faucet](https://faucet.0g.ai))

### Install

```bash
# workspaces are independent — install each as needed
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
```

### Start the live stack (4 terminals)

```bash
# A — oracle (encryption + proof signer)
cd helix/oracle
source ../contracts/.env
ORACLE_PRIVATE_KEY="$PRIVATE_KEY" \
HELIX_VERIFIER=0x0E36Df3b90A2B4868Ecd7a5974A16A5c1C5a2110 \
HELIX_CHAIN_ID=16602 \
STORAGE_BACKEND=0g STORAGE_PRIVATE_KEY="$PRIVATE_KEY" \
HELIX_RPC_URL=https://evmrpc-testnet.0g.ai \
HELIX_INDEXER_URL=https://indexer-storage-testnet-turbo.0g.ai \
./node_modules/.bin/tsx src/server.ts

# B — indexer (streams on-chain events to the web sidebar)
cd helix/indexer && ./node_modules/.bin/tsx src/server.ts

# C — AXL nodes (two peers on the local mesh)
cd helix/axl-smoke
( cd alice && ../node -config node-config.json ) > alice.log 2>&1 &
( cd bob   && ../node -config node-config.json ) > bob.log   2>&1 &

# D — web app
cd helix/web
RELAYER_PRIVATE_KEY="$(grep PRIVATE_KEY ../contracts/.env | cut -d= -f2)" \
./node_modules/.bin/next dev -p 3000
```

Open http://localhost:3000 — interactive demo on the left, live on-chain event feed on the right.

### Full-fat manual walkthrough

See [`docs/testnet-walkthrough.md`](docs/testnet-walkthrough.md) for a 20-minute end-to-end dry-run that hits every command, verifies every claim via `cast`, and explains every environment variable.

---

## Sponsor alignment

| Sponsor | Track | What Helix ships |
|---|---|---|
| **0G** | Autonomous Agents, Swarms & iNFT Innovations ($7.5K) | `iMergeFrom` extends ERC-7857 with composable intelligence. `HelixLineage` implements the "automatic royalty splits on usage" primitive their track brief called for. Souls encrypted on 0G Storage, proofs signed against the pattern 0G's reference TEEVerifier expects. |
| **ENS** | Most Creative Use ($2.5K) | `HelixNames` is a minimal subname registrar. One name = capability bundle: `axl.pubkey` (routes), `inft.token` (identity), `helix.parents` (lineage JSON), `description`, `avatar`. The agent's full story in one lookup. |
| **Gensyn AXL** | Best Application of AXL ($5K) | `helix chat send-to <label>` resolves the recipient's AXL pubkey from chain, frames a signed envelope, sends over the encrypted Yggdrasil mesh. Real peer-to-peer delivery across separate nodes (satisfies their "no central broker" rule literally). |

**Not submitted this round:** Uniswap (no trading flow), KeeperHub (x402 deferred — planned integration noted in `FEEDBACK.md`).

---

## Verified on-chain flows

All real testnet transactions, verifiable on chainscan:

- **Mint** → `https://chainscan-galileo.0g.ai/tx/0x742a140355703b587672d8469907751a08eaa5804ceb6aa76ffd88ae9e7016ba`
- **Merge** → `https://chainscan-galileo.0g.ai/tx/0x15a911a59f4f37b36e9f7ce8afabdcc20c9070715080dd1558833087087056e0`
- **Invoke (royalty cascade)** → `https://chainscan-galileo.0g.ai/tx/0xefa63e821ed278f57652e0a29c3b4922c268620e67e268a19e98aeaad958f0d9`
- **Name register** → `https://chainscan-galileo.0g.ai/tx/0xdf4f2d5ff9b87446f020395729bb035cba054523e3af16c0aedcc2e5b16c815c`
- **ENS-gated AXL chat** (section 8 of the walkthrough doc)

---

## Tests

```bash
cd helix/contracts && forge test      # 21/21 pass
cd helix/oracle    && ./node_modules/.bin/tsx src/smoke.ts    # memory roundtrip
cd helix/axl-smoke && ./run.sh                                # two-node mesh smoke
```

---

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for a one-page Mermaid diagram covering every component, tx, and cross-chain hop.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                         Web app (Next.js 15, light modernist)                 │
│                                                                               │
│   5-step demo flow ────► /api/mint ──┐     ┌──────► /api/merge                │
│                         /api/invoke ─┼─► Relayer wallet ───► 0G RPC           │
│                         /api/chat/send                                        │
│                                                                               │
│   Terminal sidebar ◄─────────────────── WebSocket ◄── Indexer service         │
└───────────────────────────────────────────────────────────────────────────────┘
                                    │                                │
                                    ▼                                ▼
                 ┌─────────────────────┐             ┌─────────────────────────┐
                 │      Oracle         │             │      0G Galileo chain   │
                 │  (TEE stand-in)     │             │                         │
                 │  AES-GCM + ECIES    │             │  HelixSoul  ─ mint      │
                 │  ECDSA proof sigs   │             │             ─ iMergeFrom│
                 │  persistent cache   │             │  HelixVerifier          │
                 └──────────┬──────────┘             │  HelixLineage           │
                            │                        │  HelixNames             │
                            ▼                        └─────────────────────────┘
                 ┌─────────────────────┐
                 │   0G Storage        │
                 │  encrypted souls    │
                 │  (multi-node)       │
                 └─────────────────────┘

                 ┌─────────────────────┐         ┌─────────────────────┐
                 │  AXL node: alice    │ ◄─────► │  AXL node: bob      │
                 │  :9102 (HTTP API)   │  mesh   │  :9202 (HTTP API)   │
                 │  pubkey ed25519     │         │  pubkey ed25519     │
                 └─────────────────────┘         └─────────────────────┘
```

---

## Why the web app matters

Because a judge has 3 minutes. A CLI with 45 setup steps loses to any project with a 10-second wow moment, no matter how good the protocol. The web app exists to make the protocol *felt*: one click mints on real testnet in ~15s, another click merges, a third shows royalties splitting five ways live. The terminal sidebar is the receipts — every button click produces verifiable on-chain state change visible as it happens.

---

## License

MIT, including the vendored ERC-7857 reference from `0gfoundation/0g-agent-nft` (same license).

---

## Team

Built for ETHGlobal OpenAgents.

