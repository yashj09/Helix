#!/usr/bin/env node
// Helix Indexer — WebSocket fan-out of on-chain events.
//
// Subscribes to HelixSoul, HelixNames, and HelixLineage logs via viem's polling watcher
// (RPC-based, no WSS required — 0G Galileo doesn't expose a public WSS endpoint yet).
// For each decoded event, emits a flat IndexerEvent frame to every connected WebSocket client.
//
// No database, no persistence. ~300 lines. Designed to run alongside the Next.js app in
// development and as a tiny sidecar on a VPS in production.

import { WebSocketServer, WebSocket } from "ws";
import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbiItem,
  type Hex,
  type Log,
} from "viem";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { IndexerEvent } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 8788);
const CHAIN_ID = Number(process.env.HELIX_CHAIN_ID ?? 16602);
const RPC_URL = process.env.HELIX_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const EXPLORER = process.env.HELIX_EXPLORER ?? "https://chainscan-galileo.0g.ai";
const POLL_MS = Number(process.env.HELIX_POLL_MS ?? 2500);

// Load deployment record.
const here = dirname(fileURLToPath(import.meta.url));
const depPath =
  process.env.HELIX_DEPLOYMENT_PATH ??
  resolve(here, "..", "..", "contracts", "deployments", `${CHAIN_ID}.json`);
const deployment = JSON.parse(readFileSync(depPath, "utf8")) as {
  chainId: number;
  verifier: Hex;
  soul: Hex;
  lineage: Hex;
  names: Hex;
  /** v3: optional — older deployments don't have this. */
  sessionRental?: Hex;
};

// ─────────────────────────────────────────────────────────────────────────
//  Event ABIs (only the ones we actually display — keep bundle small)
// ─────────────────────────────────────────────────────────────────────────

const soulEvents = {
  Transfer: parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
  ),
  Merged: parseAbiItem(
    "event Merged(uint256 indexed _parentA, uint256 indexed _parentB, uint256 indexed _childTokenId, address _to)"
  ),
  Cloned: parseAbiItem(
    "event Cloned(uint256 indexed _tokenId, uint256 indexed _newTokenId, address _from, address _to)"
  ),
  // Canonical ERC-7857 proof event: receiver's sealed key is published on-chain so only they
  // can decrypt the soul. Labeling it with 🔒 makes the spec trail obvious in the sidebar.
  PublishedSealedKey: parseAbiItem(
    "event PublishedSealedKey(address indexed _to, uint256 indexed _tokenId, bytes[] _sealedKeys)"
  ),
};

const namesEvents = {
  NameRegistered: parseAbiItem(
    "event NameRegistered(uint256 indexed tokenId, string label, address indexed owner)"
  ),
  TextChanged: parseAbiItem(
    "event TextChanged(uint256 indexed tokenId, string indexed keyIndex, string key, string value)"
  ),
};

const lineageEvents = {
  LineageRecorded: parseAbiItem(
    "event LineageRecorded(uint256 indexed childTokenId, uint256 indexed parentA, uint256 indexed parentB)"
  ),
  RoyaltyFlowed: parseAbiItem(
    "event RoyaltyFlowed(uint256 indexed fromToken, uint256 indexed toToken, address indexed toAddress, uint256 amount)"
  ),
};

// v3: HelixSessionRental events — the pay-to-chat primitive built on ERC-7857 authorizeUsage.
const rentalEvents = {
  SessionRented: parseAbiItem(
    "event SessionRented(uint256 indexed tokenId, address indexed renter, uint256 messageCount, uint256 amountPaid)"
  ),
  SessionConsumed: parseAbiItem(
    "event SessionConsumed(uint256 indexed tokenId, address indexed renter, uint256 remaining)"
  ),
};

// ─────────────────────────────────────────────────────────────────────────
//  Chain client
// ─────────────────────────────────────────────────────────────────────────

const client = createPublicClient({
  chain: {
    id: CHAIN_ID,
    name: "0G Galileo",
    nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  },
  transport: http(RPC_URL),
});

// ─────────────────────────────────────────────────────────────────────────
//  WebSocket fan-out
// ─────────────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });
const clients = new Set<WebSocket>();
// Keep the last N events so late-joining clients get a window of context.
const backlog: IndexerEvent[] = [];
const MAX_BACKLOG = 100;

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(
    JSON.stringify({
      t: Date.now(),
      kind: "init",
      line: `indexer connected · watching chain ${CHAIN_ID}`,
    } satisfies IndexerEvent)
  );
  // Replay recent backlog.
  for (const ev of backlog) {
    try {
      ws.send(JSON.stringify(ev));
    } catch {
      // ignore
    }
  }
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

function emit(ev: IndexerEvent): void {
  backlog.push(ev);
  if (backlog.length > MAX_BACKLOG) backlog.shift();
  const payload = JSON.stringify(ev);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(payload);
      } catch {
        // ignore
      }
    }
  }
}

function fmtAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

function fmtAmount(wei: bigint): string {
  // show 6dp 0G
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${fracStr} 0G`;
}

function txUrl(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

// ─────────────────────────────────────────────────────────────────────────
//  Event dispatch — decode a raw log, turn it into an IndexerEvent, emit.
// ─────────────────────────────────────────────────────────────────────────

function handleSoulLog(log: Log): void {
  for (const [name, abi] of Object.entries(soulEvents)) {
    try {
      const decoded = decodeEventLog({
        abi: [abi],
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as unknown as Record<string, unknown>;
      if (name === "Transfer") {
        const from = args.from as Hex;
        const to = args.to as Hex;
        const tokenId = args.tokenId as bigint;
        if (from === "0x0000000000000000000000000000000000000000") {
          emit({
            t: Date.now(),
            kind: "mint",
            line: `Minted soul #${tokenId} → ${fmtAddr(to)}`,
            txHash: log.transactionHash!,
            tokenId: Number(tokenId),
            explorerUrl: txUrl(log.transactionHash!),
          });
        }
      } else if (name === "Merged") {
        emit({
          t: Date.now(),
          kind: "merge",
          line: `Merged #${args._parentA} + #${args._parentB} → #${args._childTokenId}`,
          txHash: log.transactionHash!,
          tokenId: Number(args._childTokenId),
          explorerUrl: txUrl(log.transactionHash!),
        });
      } else if (name === "Cloned") {
        emit({
          t: Date.now(),
          kind: "clone",
          line: `Cloned #${args._tokenId} → #${args._newTokenId}`,
          txHash: log.transactionHash!,
          explorerUrl: txUrl(log.transactionHash!),
        });
      } else if (name === "PublishedSealedKey") {
        const to = args._to as Hex;
        const tokenId = args._tokenId as bigint;
        const sealedKeys = (args._sealedKeys as string[]) ?? [];
        // sealedKeys[0] is typically a hex-prefixed binary. Report total byte length.
        const totalBytes = sealedKeys.reduce((n, k) => {
          const clean = k.startsWith("0x") ? k.slice(2) : k;
          return n + Math.floor(clean.length / 2);
        }, 0);
        emit({
          t: Date.now(),
          kind: "sealed",
          line: `🔒 PublishedSealedKey to ${fmtAddr(to)} for token #${tokenId} · ${totalBytes} bytes`,
          txHash: log.transactionHash!,
          tokenId: Number(tokenId),
          explorerUrl: txUrl(log.transactionHash!),
        });
      }
      return;
    } catch {
      // next event
    }
  }
}

function handleNamesLog(log: Log): void {
  for (const [name, abi] of Object.entries(namesEvents)) {
    try {
      const decoded = decodeEventLog({
        abi: [abi],
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as unknown as Record<string, unknown>;
      if (name === "NameRegistered") {
        emit({
          t: Date.now(),
          kind: "name",
          line: `Registered ${args.label}.helix.eth → #${args.tokenId}`,
          txHash: log.transactionHash!,
          tokenId: Number(args.tokenId),
          explorerUrl: txUrl(log.transactionHash!),
        });
      } else if (name === "TextChanged") {
        const key = args.key as string;
        const value = (args.value as string) ?? "";
        const short = value.length > 24 ? value.slice(0, 12) + "…" + value.slice(-10) : value;
        emit({
          t: Date.now(),
          kind: "text",
          line: `text #${args.tokenId} ${key} = ${short}`,
          txHash: log.transactionHash!,
          tokenId: Number(args.tokenId),
          explorerUrl: txUrl(log.transactionHash!),
        });
      }
      return;
    } catch {
      // next
    }
  }
}

function handleLineageLog(log: Log): void {
  for (const [name, abi] of Object.entries(lineageEvents)) {
    try {
      const decoded = decodeEventLog({
        abi: [abi],
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as unknown as Record<string, unknown>;
      if (name === "LineageRecorded") {
        emit({
          t: Date.now(),
          kind: "lineage",
          line: `Lineage #${args.childTokenId} ← #${args.parentA} + #${args.parentB}`,
          txHash: log.transactionHash!,
          tokenId: Number(args.childTokenId),
          explorerUrl: txUrl(log.transactionHash!),
        });
      } else if (name === "RoyaltyFlowed") {
        emit({
          t: Date.now(),
          kind: "royalty",
          line: `Royalty #${args.fromToken} → #${args.toToken} · ${fmtAddr(
            args.toAddress as string
          )} · ${fmtAmount(args.amount as bigint)}`,
          txHash: log.transactionHash!,
          explorerUrl: txUrl(log.transactionHash!),
        });
      }
      return;
    } catch {
      // next
    }
  }
}

function handleRentalLog(log: Log): void {
  for (const [name, abi] of Object.entries(rentalEvents)) {
    try {
      const decoded = decodeEventLog({
        abi: [abi],
        data: log.data,
        topics: log.topics,
      });
      const args = decoded.args as unknown as Record<string, unknown>;
      if (name === "SessionRented") {
        emit({
          t: Date.now(),
          kind: "session-rented",
          line: `🎫 SessionRented #${args.tokenId} · renter ${fmtAddr(
            args.renter as string
          )} · ${args.messageCount} msgs · ${fmtAmount(args.amountPaid as bigint)}`,
          txHash: log.transactionHash!,
          tokenId: Number(args.tokenId),
          explorerUrl: txUrl(log.transactionHash!),
        });
      } else if (name === "SessionConsumed") {
        emit({
          t: Date.now(),
          kind: "session-consumed",
          line: `▶ SessionConsumed #${args.tokenId} · ${args.remaining} msgs remaining`,
          txHash: log.transactionHash!,
          tokenId: Number(args.tokenId),
          explorerUrl: txUrl(log.transactionHash!),
        });
      }
      return;
    } catch {
      // next
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Polling loop — get latest block, fetch logs since last checkpoint
// ─────────────────────────────────────────────────────────────────────────

type Checkpoint = { block: bigint };
const state: Checkpoint = { block: 0n };

async function tick(): Promise<void> {
  try {
    const latest = await client.getBlockNumber();
    if (state.block === 0n) {
      // First tick — start from a small window back so we have something to show.
      state.block = latest > 5n ? latest - 5n : 0n;
    }
    if (latest <= state.block) return;

    const fromBlock = state.block + 1n;
    const toBlock = latest;

    const [soulLogs, namesLogs, lineageLogs, rentalLogs] = await Promise.all([
      client.getLogs({
        address: deployment.soul,
        fromBlock,
        toBlock,
      }),
      client.getLogs({
        address: deployment.names,
        fromBlock,
        toBlock,
      }),
      client.getLogs({
        address: deployment.lineage,
        fromBlock,
        toBlock,
      }),
      deployment.sessionRental
        ? client.getLogs({
            address: deployment.sessionRental,
            fromBlock,
            toBlock,
          })
        : Promise.resolve([] as Log[]),
    ]);

    soulLogs.forEach(handleSoulLog);
    namesLogs.forEach(handleNamesLog);
    lineageLogs.forEach(handleLineageLog);
    rentalLogs.forEach(handleRentalLog);

    state.block = toBlock;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[indexer] tick error:", (err as Error).message);
  }
}

setInterval(tick, POLL_MS);
void tick();

// eslint-disable-next-line no-console
console.log(
  `[helix-indexer] ws://0.0.0.0:${PORT}  chain=${CHAIN_ID}  rpc=${RPC_URL}  poll=${POLL_MS}ms`
);
console.log(
  `[helix-indexer]   watching soul=${deployment.soul} names=${deployment.names} lineage=${deployment.lineage}` +
    (deployment.sessionRental ? ` rental=${deployment.sessionRental}` : "")
);
