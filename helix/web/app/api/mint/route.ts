// POST /api/mint
// Body: { name: string, personality?: string, skills?: string[], registerLabel?: boolean }
// Flow:
//   1. Ask oracle to encrypt the soul (prepareMint) — uploads ciphertext to 0G Storage.
//   2. Submit `HelixSoul.mint([intelligentData], relayerAddress)` with relayer key.
//   3. If registerLabel, also register `<name>` on HelixNames + write axl.pubkey.
// Returns tokenId, dataHash, txHash, explorer URL.

import { NextResponse } from "next/server";
import { decodeEventLog } from "viem";

import { getRelayer } from "@/lib/relayer";
import { HelixSoulAbi, HelixNamesAbi } from "@/lib/abis";
import { prepareMint } from "@/lib/oracle";
import { pubkey64For } from "@/lib/pubkey";
import type { Hex } from "@/lib/config";

const DEFAULT_PERSONALITY = "curious helpful agent";
const DEFAULT_SKILLS = ["conversation", "assistance"];

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      name?: string;
      personality?: string;
      skills?: string[];
      registerLabel?: boolean;
      axlPubkey?: string;
    };

    if (!body.name || !/^[a-z0-9][a-z0-9-]{2,31}$/.test(body.name)) {
      return NextResponse.json(
        { error: "name must be 3–32 chars of a–z, 0–9, hyphen (no leading/trailing hyphen)" },
        { status: 400 }
      );
    }

    const relayer = getRelayer();
    const { publicClient, walletClient, account, chain, runtime } = relayer;

    // 1. Oracle prepares encrypted soul + signed proof.
    const relayerKey = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
    if (!relayerKey) {
      return NextResponse.json(
        { error: "RELAYER_PRIVATE_KEY missing on server process" },
        { status: 500 }
      );
    }
    const prep = await prepareMint({
      name: body.name,
      personality: body.personality ?? DEFAULT_PERSONALITY,
      skills: body.skills ?? DEFAULT_SKILLS,
      recipient: {
        address: account.address,
        pubkey64: pubkey64For(relayerKey),
      },
    });

    // 2. Submit mint tx.
    const mintHash = await walletClient.writeContract({
      address: runtime.deployment.soul,
      abi: HelixSoulAbi,
      functionName: "mint",
      args: [[prep.intelligentData], account.address],
      chain,
      account,
    });
    const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintHash });

    // Decode tokenId from Transfer event.
    let tokenId: bigint | null = null;
    for (const log of mintReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: HelixSoulAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "Transfer") {
          const args = decoded.args as { from: string; to: string; tokenId: bigint };
          if (args.from === "0x0000000000000000000000000000000000000000") {
            tokenId = args.tokenId;
            break;
          }
        }
      } catch {
        // skip non-matching logs
      }
    }
    if (tokenId === null) {
      return NextResponse.json({ error: "mint: Transfer event not found" }, { status: 500 });
    }

    const out: Record<string, unknown> = {
      tokenId: tokenId.toString(),
      dataHash: prep.dataHash,
      mintTxHash: mintHash,
      mintExplorerUrl: `${runtime.explorerBase}/tx/${mintHash}`,
    };

    // 3. Optional: register name + write axl.pubkey.
    if (body.registerLabel) {
      const registerHash = await walletClient.writeContract({
        address: runtime.deployment.names,
        abi: HelixNamesAbi,
        functionName: "register",
        args: [body.name, tokenId],
        chain,
        account,
      });
      await publicClient.waitForTransactionReceipt({ hash: registerHash });
      out.registerTxHash = registerHash;
      out.registerExplorerUrl = `${runtime.explorerBase}/tx/${registerHash}`;

      // Optional axl.pubkey record (if caller passed one — otherwise skip; operator may set later).
      if (body.axlPubkey && /^[0-9a-fA-F]{64}$/.test(body.axlPubkey.replace(/^0x/, ""))) {
        const clean = body.axlPubkey.replace(/^0x/, "");
        const textHash = await walletClient.writeContract({
          address: runtime.deployment.names,
          abi: HelixNamesAbi,
          functionName: "setTextBatch",
          args: [
            tokenId,
            ["axl.pubkey", "inft.token", "description"],
            [
              clean,
              `${runtime.deployment.soul}:${tokenId.toString()}`,
              body.personality ?? DEFAULT_PERSONALITY,
            ],
          ],
          chain,
          account,
        });
        await publicClient.waitForTransactionReceipt({ hash: textHash });
        out.textTxHash = textHash;
        out.textExplorerUrl = `${runtime.explorerBase}/tx/${textHash}`;
      }
    }

    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
