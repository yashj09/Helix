// POST /api/session/start
//
// Body: { tokenId: number, messageCount: number }
// Behavior: the relayer (who owns the demo's iNFTs) submits TWO txs:
//   1. HelixSoul.authorizeUsage(tokenId, relayerAddr) — ERC-7857 owner-only grant
//   2. HelixSessionRental.rentSession{value: 0.01 × messageCount}(tokenId, relayerAddr, messageCount)
// Response: { authTxHash, rentTxHash, messageCount, amountPaid, explorerUrls }
//
// We use the relayer as both the owner AND the renter. That's intentional for the hosted
// demo — the relayer subsidizes the visitor's session, and using its own address as the
// renter keeps things simple (the oracle's consumeMessage writes against the same renter
// address the /reply body will carry). In production you'd pass a per-visitor address.

import { NextResponse } from "next/server";
import { parseEther } from "viem";

import { getRelayer } from "@/lib/relayer";
import { HelixSoulAbi } from "@/lib/abis";
import { HelixSessionRentalAbi } from "@/lib/session-abi";
import { loadRuntime } from "@/lib/config";

const PRICE_PER_MESSAGE = "0.01";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      tokenId?: number;
      messageCount?: number;
    };
    if (typeof body.tokenId !== "number" || typeof body.messageCount !== "number") {
      return NextResponse.json(
        { error: "tokenId (number) + messageCount (number) required" },
        { status: 400 }
      );
    }
    if (body.messageCount <= 0 || body.messageCount > 100) {
      return NextResponse.json(
        { error: "messageCount must be 1..100" },
        { status: 400 }
      );
    }

    const runtime = loadRuntime();
    const deployment = runtime.deployment as typeof runtime.deployment & {
      sessionRental?: `0x${string}`;
    };
    if (!deployment.sessionRental) {
      return NextResponse.json(
        { error: "sessionRental not deployed on this chain" },
        { status: 503 }
      );
    }

    const { publicClient, walletClient, account, chain } = getRelayer();

    // Pre-flight: relayer must own the token (otherwise authorizeUsage will revert anyway,
    // but this gives a friendlier error).
    const owner = (await publicClient.readContract({
      address: runtime.deployment.soul,
      abi: HelixSoulAbi,
      functionName: "ownerOf",
      args: [BigInt(body.tokenId)],
    })) as `0x${string}`;
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      return NextResponse.json(
        {
          error: "relayer is not the owner of this token",
          hint: "session rentals in the demo require the relayer to hold the token",
          owner,
          relayer: account.address,
        },
        { status: 403 }
      );
    }

    // Tx 1: authorizeUsage(tokenId, relayer) — but only if not already authorized.
    // ERC7857AuthorizeUpgradeable._authorizeUsage reverts with ERC7857AlreadyAuthorized()
    // (selector 0x338944af) when the user is already in the set, and the set persists until
    // the token is transferred. Treating it as idempotent here lets the user start a second
    // session (after quota exhaustion) without hitting a spurious 500.
    const authorizedUsers = (await publicClient.readContract({
      address: runtime.deployment.soul,
      abi: HelixSoulAbi,
      functionName: "authorizedUsersOf",
      args: [BigInt(body.tokenId)],
    })) as `0x${string}`[];
    const alreadyAuthorized = authorizedUsers.some(
      (u) => u.toLowerCase() === account.address.toLowerCase()
    );

    let authHash: `0x${string}` | null = null;
    if (!alreadyAuthorized) {
      authHash = await walletClient.writeContract({
        address: runtime.deployment.soul,
        abi: HelixSoulAbi,
        functionName: "authorizeUsage",
        args: [BigInt(body.tokenId), account.address],
        chain,
        account,
      });
      await publicClient.waitForTransactionReceipt({ hash: authHash });
    }

    // Tx 2: rentSession{value}(tokenId, relayer, messageCount)
    const amountWei = parseEther(
      (Number(PRICE_PER_MESSAGE) * body.messageCount).toFixed(18)
    );
    const rentHash = await walletClient.writeContract({
      address: deployment.sessionRental,
      abi: HelixSessionRentalAbi,
      functionName: "rentSession",
      args: [BigInt(body.tokenId), account.address, BigInt(body.messageCount)],
      value: amountWei,
      chain,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: rentHash });

    return NextResponse.json({
      tokenId: body.tokenId,
      renter: account.address,
      messageCount: body.messageCount,
      amountPaid: (Number(PRICE_PER_MESSAGE) * body.messageCount).toFixed(4),
      // authTxHash/authExplorerUrl are null when the relayer was already authorized from a
      // prior session start — rental still gets created fresh so the second session is valid.
      authTxHash: authHash,
      authExplorerUrl: authHash ? `${runtime.explorerBase}/tx/${authHash}` : null,
      authAlreadyGranted: alreadyAuthorized,
      rentTxHash: rentHash,
      rentExplorerUrl: `${runtime.explorerBase}/tx/${rentHash}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
