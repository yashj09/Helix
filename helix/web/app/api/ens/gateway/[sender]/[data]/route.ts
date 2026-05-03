// ENS CCIP-Read gateway for helixx.eth wildcards.
//
// Flow (per EIP-3668 + ENSIP-10):
//   1. Client calls HelixxOffchainResolver.resolve(dnsName, innerData) on Sepolia
//   2. Resolver reverts OffchainLookup(self, [url], wrappedCall, resolveWithProof.sel, extraData)
//   3. Client does GET https://<domain>/api/ens/gateway/{sender}/{data}.json
//      where {data} = wrappedCall = abi.encode( IResolverService.resolve.selector ‖ name ‖ innerData )
//   4. We decode, read from Helix 0G contracts, sign the reply, return { data: abi.encode(result, expires, sig) }
//   5. Client calls resolver.resolveWithProof(response, extraData); resolver recovers signer,
//      checks signers[signer] == true, returns the decoded result to the caller.
//
// Canonical hash (must match HelixxOffchainResolver._signatureHash exactly):
//   keccak256(abi.encodePacked(0x1900, sender, expires, keccak256(callData), keccak256(result)))
//
// Signed by RESOLVER_SIGNER_PRIVATE_KEY — the oracle wallet, also the trusted signer recorded
// in the resolver contract at deploy time.

import { NextResponse } from "next/server";
import {
  createPublicClient,
  decodeFunctionData,
  encodeAbiParameters,
  hexToBytes,
  http,
  keccak256,
  bytesToHex,
  type Hex,
} from "viem";
import { sign } from "viem/accounts";

import { HelixNamesAbi, HelixSoulAbi } from "@/lib/abis";
import { loadRuntime } from "@/lib/config";

// ─────────────────────────────────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────────────────────────────────

/** Our Sepolia-registered ENS parent name. Everything under it is wildcarded through here. */
const PARENT = (process.env.HELIX_ENS_PARENT ?? "helixx.eth").toLowerCase();
/** Default TTL for signed responses. */
const RESPONSE_TTL_SECONDS = 60 * 5;
/** SLIP-0044 coin type for Ethereum (EIP-2304). */
const ETH_COIN_TYPE = 60n;

// ABI for the outer wrapped call the resolver encodes — must mirror IResolverService:
//   function resolve(bytes name, bytes data) view returns (bytes result, uint64 expires, bytes sig)
const OUTER_RESOLVE_ABI = [
  {
    type: "function",
    name: "resolve",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "result", type: "bytes" },
      { name: "expires", type: "uint64" },
      { name: "sig", type: "bytes" },
    ],
  },
] as const;

// Subset of the ENS PublicResolver ABI — only the record functions we serve.
const PUBLIC_RESOLVER_ABI = [
  {
    type: "function",
    name: "addr",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "addr",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "coinType", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "contenthash",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes" }],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────
//  DNS name decoding (RFC 1035 §3.1)
// ─────────────────────────────────────────────────────────────────────────

function decodeDnsName(buf: Uint8Array): string {
  const labels: string[] = [];
  let idx = 0;
  while (idx < buf.length) {
    const len = buf[idx];
    if (len === 0) break;
    labels.push(new TextDecoder().decode(buf.slice(idx + 1, idx + 1 + len)));
    idx += 1 + len;
  }
  return labels.join(".");
}

// ─────────────────────────────────────────────────────────────────────────
//  Helix lookup — label → records
// ─────────────────────────────────────────────────────────────────────────

type ResolvedRecord = {
  /** Ethereum address associated with the name. Empty if unresolved. */
  address: Hex;
  /** Text records we pre-fetch. Any missing key returns empty string. */
  text: Record<string, string>;
};

async function resolveLabelOnHelix(label: string): Promise<ResolvedRecord> {
  const runtime = loadRuntime();
  const client = createPublicClient({
    chain: {
      id: runtime.chainId,
      name: "0G Galileo",
      nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
      rpcUrls: { default: { http: [runtime.rpcUrl] } },
    },
    transport: http(runtime.rpcUrl),
  });

  // HelixNames.resolveFull(label) reverts with NameNotFound if unknown; catch and return
  // zero record so ENS queries for unregistered names 404 cleanly (empty addr + empty text)
  // instead of blowing up the gateway.
  let tokenIdResult = 0n;
  let ownerResult: Hex = "0x0000000000000000000000000000000000000000";
  try {
    const res = (await client.readContract({
      address: runtime.deployment.names,
      abi: HelixNamesAbi,
      functionName: "resolveFull",
      args: [label],
    })) as [bigint, Hex];
    tokenIdResult = res[0];
    ownerResult = res[1];
  } catch {
    return { address: "0x0000000000000000000000000000000000000000", text: {} };
  }

  if (tokenIdResult === 0n || ownerResult === "0x0000000000000000000000000000000000000000") {
    return { address: "0x0000000000000000000000000000000000000000", text: {} };
  }

  // Re-check owner via HelixSoul.ownerOf — the registrar's owner can lag behind transfers.
  let addr: Hex = ownerResult;
  try {
    addr = (await client.readContract({
      address: runtime.deployment.soul,
      abi: HelixSoulAbi,
      functionName: "ownerOf",
      args: [tokenIdResult],
    })) as Hex;
  } catch {
    // If ownerOf reverts (shouldn't), fall back to the registrar record.
  }

  // Pre-fetch the well-known text records we care about.
  const wellKnownKeys = [
    "axl.pubkey",
    "inft.token",
    "description",
    "helix.parents",
    "avatar",
    "url",
  ];
  const values = await Promise.all(
    wellKnownKeys.map((key) =>
      client
        .readContract({
          address: runtime.deployment.names,
          abi: HelixNamesAbi,
          functionName: "text",
          args: [tokenIdResult, key],
        })
        .catch(() => "" as string)
    )
  );
  const text: Record<string, string> = {};
  wellKnownKeys.forEach((k, i) => {
    text[k] = (values[i] as string) ?? "";
  });

  return { address: addr, text };
}

// ─────────────────────────────────────────────────────────────────────────
//  Record-type handlers — one per PublicResolver signature
// ─────────────────────────────────────────────────────────────────────────

type InnerCall =
  | { kind: "addr"; node: Hex }
  | { kind: "addrCoin"; node: Hex; coinType: bigint }
  | { kind: "text"; node: Hex; key: string }
  | { kind: "contenthash"; node: Hex }
  | { kind: "unknown" };

function decodeInnerCall(innerData: Hex): InnerCall {
  try {
    const decoded = decodeFunctionData({
      abi: PUBLIC_RESOLVER_ABI,
      data: innerData,
    });
    if (decoded.functionName === "addr") {
      if (decoded.args.length === 1) {
        return { kind: "addr", node: decoded.args[0] as Hex };
      }
      return {
        kind: "addrCoin",
        node: decoded.args[0] as Hex,
        coinType: decoded.args[1] as bigint,
      };
    }
    if (decoded.functionName === "text") {
      return {
        kind: "text",
        node: decoded.args[0] as Hex,
        key: decoded.args[1] as string,
      };
    }
    if (decoded.functionName === "contenthash") {
      return { kind: "contenthash", node: decoded.args[0] as Hex };
    }
  } catch {
    // fall through
  }
  return { kind: "unknown" };
}

function encodeInnerResult(call: InnerCall, rec: ResolvedRecord): Hex {
  if (call.kind === "addr") {
    // addr(bytes32) returns address — ABI-encoded as 32 bytes (padded).
    return encodeAbiParameters([{ type: "address" }], [rec.address]);
  }
  if (call.kind === "addrCoin") {
    // EIP-2304 addr(bytes32, uint256) returns bytes. Only ETH (coinType 60) has a value.
    const bytes = call.coinType === ETH_COIN_TYPE ? (rec.address as Hex) : ("0x" as Hex);
    return encodeAbiParameters([{ type: "bytes" }], [bytes]);
  }
  if (call.kind === "text") {
    const v = rec.text[call.key] ?? "";
    return encodeAbiParameters([{ type: "string" }], [v]);
  }
  if (call.kind === "contenthash") {
    return encodeAbiParameters([{ type: "bytes" }], ["0x"]);
  }
  // Unknown function — return empty bytes. Client will receive a zero value.
  return "0x" as Hex;
}

// ─────────────────────────────────────────────────────────────────────────
//  Signing — match HelixxOffchainResolver._signatureHash exactly.
//     h = keccak256(abi.encodePacked(0x1900, sender, expires, keccak256(request), keccak256(result)))
// ─────────────────────────────────────────────────────────────────────────

function makeSignatureHash(
  sender: Hex,
  expires: bigint,
  request: Hex,
  result: Hex
): Hex {
  // abi.encodePacked: 0x1900 (2 bytes) || sender (20) || expires (8) || keccak256(request) (32) || keccak256(result) (32)
  const payload = new Uint8Array(2 + 20 + 8 + 32 + 32);
  payload[0] = 0x19;
  payload[1] = 0x00;
  payload.set(hexToBytes(sender), 2);
  // expires: uint64 big-endian
  const expiresBytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    expiresBytes[i] = Number((expires >> BigInt((7 - i) * 8)) & 0xffn);
  }
  payload.set(expiresBytes, 22);
  payload.set(hexToBytes(keccak256(request)), 30);
  payload.set(hexToBytes(keccak256(result)), 62);
  return keccak256(bytesToHex(payload));
}

async function signOrFail(hash: Hex): Promise<Hex> {
  const pk = process.env.RESOLVER_SIGNER_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new Error("RESOLVER_SIGNER_PRIVATE_KEY not set");
  // viem's `sign` does raw ECDSA over the 32-byte hash — exactly what ecrecover expects.
  // (No EIP-191 prefix; we already prepended 0x1900 inside makeSignatureHash.)
  const signature = await sign({ hash, privateKey: pk });
  const r = signature.r.slice(2).padStart(64, "0");
  const s = signature.s.slice(2).padStart(64, "0");
  const v = (27 + Number(signature.yParity ?? 0)).toString(16).padStart(2, "0");
  return ("0x" + r + s + v) as Hex;
}

// ─────────────────────────────────────────────────────────────────────────
//  GET handler
//    /api/ens/gateway/{sender}/{data}.json
//    {data} includes a trailing ".json" we need to strip.
// ─────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ sender: string; data: string }> }
): Promise<Response> {
  return handle(await context.params);
}

export async function POST(
  req: Request,
  context: { params: Promise<{ sender: string; data: string }> }
): Promise<Response> {
  // CCIP-Read POST variant: body = { data, sender }. Prefer body over path if present.
  const p = await context.params;
  try {
    const body = (await req.json()) as { data?: string; sender?: string };
    return handle({
      sender: (body.sender ?? p.sender) as string,
      data: (body.data ?? p.data) as string,
    });
  } catch {
    return handle(p);
  }
}

async function handle(params: { sender: string; data: string }): Promise<Response> {
  try {
    const sender = params.sender as Hex;
    // Strip optional `.json` suffix from the path variant.
    const dataHex = (
      params.data.endsWith(".json") ? params.data.slice(0, -5) : params.data
    ) as Hex;

    // Outer decode: data = IResolverService.resolve.selector || abi.encode(name, innerData)
    const decodedOuter = decodeFunctionData({ abi: OUTER_RESOLVE_ABI, data: dataHex });
    if (decodedOuter.functionName !== "resolve") {
      return jsonError("unexpected outer function: " + decodedOuter.functionName, 400);
    }
    const [dnsName, innerData] = decodedOuter.args as [Hex, Hex];

    const name = decodeDnsName(hexToBytes(dnsName)).toLowerCase();
    const parentSuffix = "." + PARENT;
    let label: string;
    if (name === PARENT) {
      // Query for the parent itself — respond as if it's an empty record so ENS UIs don't 404.
      label = "";
    } else if (name.endsWith(parentSuffix)) {
      // "alice.helixx.eth" → "alice". Multi-label ("x.y.helixx.eth") → full child prefix.
      label = name.slice(0, -parentSuffix.length);
    } else {
      return jsonError("name is not under " + PARENT + ": " + name, 400);
    }

    const rec = label
      ? await resolveLabelOnHelix(label)
      : ({ address: "0x0000000000000000000000000000000000000000", text: {} } as ResolvedRecord);

    const innerCall = decodeInnerCall(innerData);
    const innerResult = encodeInnerResult(innerCall, rec);

    // Signing: the request we sign over is the outer wrapped call (exactly `dataHex`).
    const expires = BigInt(Math.floor(Date.now() / 1000) + RESPONSE_TTL_SECONDS);
    const hashToSign = makeSignatureHash(sender, expires, dataHex, innerResult);
    const sig = await signOrFail(hashToSign);

    const encoded = encodeAbiParameters(
      [
        { name: "result", type: "bytes" },
        { name: "expires", type: "uint64" },
        { name: "sig", type: "bytes" },
      ],
      [innerResult, expires, sig]
    );

    return NextResponse.json(
      { data: encoded },
      {
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

function jsonError(message: string, status: number): Response {
  return NextResponse.json(
    { message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

