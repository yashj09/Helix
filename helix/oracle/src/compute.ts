// Helix Compute — wrapper around 0G Compute Network on Galileo testnet.
//
// Two modes:
//   - REAL:     OG_COMPUTE_PROVIDER is set → use @0gfoundation/0g-compute-ts-sdk broker to
//               fetch signed request headers per-call and hit the provider's own endpoint.
//               The provider is a chatbot service we funded via `broker.ledger.transferFund`;
//               setup is a one-time on-chain flow (see helix/oracle/scripts/setup.mjs).
//   - SCRIPTED: OG_COMPUTE_PROVIDER unset → return a template-based reply derived from the
//               agent's soul. No network, no cost. Reliable for demos.
//
// `replyFor({ soul, history })` returns `{ text, fallback }`. `fallback: true` means the
// scripted path ran (stubbed or a real-call error). The UI renders this as a "(simulated)"
// badge so nothing is misrepresented as real inference.

import { ethers } from "ethers";
import { createRequire } from "node:module";
import type { Soul } from "./soul.js";

// Workaround: @0gfoundation/0g-compute-ts-sdk@0.8.0's ESM build re-exports from a file
// that doesn't actually provide the named bindings, so `import { ... }` fails at runtime
// under tsx/native-ESM. The CJS build is correct, so load that via `createRequire`.
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require("@0gfoundation/0g-compute-ts-sdk") as {
  createZGComputeNetworkBroker: (signer: ethers.Wallet) => Promise<{
    inference: {
      getServiceMetadata(providerAddress: string): Promise<{ endpoint: string; model: string }>;
      getRequestHeaders(providerAddress: string): Promise<Record<string, string>>;
      processResponse(providerAddress: string, chatId: string): Promise<void>;
    };
  }>;
};

export interface ReplyResult {
  text: string;
  fallback: boolean;
  model: string;
}

export interface ChatTurn {
  role: "user" | "assistant" | "system";
  content: string;
}

const RPC_URL = process.env.HELIX_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
const PROVIDER_ADDR = process.env.OG_COMPUTE_PROVIDER;
const COMPUTE_PK = process.env.OG_COMPUTE_PRIVATE_KEY ?? process.env.ORACLE_PRIVATE_KEY;

// Broker setup is async + slow (one contract call per cache miss), so we initialize once
// lazily and cache. Endpoint + model are constant per provider across the session, so we
// also cache them. Auth headers are regenerated per request — they carry nonces.
type Broker = Awaited<ReturnType<typeof createZGComputeNetworkBroker>>;
type BrokerBundle = {
  broker: Broker;
  endpoint: string;
  model: string;
  providerAddress: string;
};

let brokerPromise: Promise<BrokerBundle | null> | null = null;

async function initBroker(): Promise<BrokerBundle | null> {
  if (!PROVIDER_ADDR || !COMPUTE_PK) return null;
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(COMPUTE_PK, provider);
    const broker = await createZGComputeNetworkBroker(wallet);
    const { endpoint, model } = await broker.inference.getServiceMetadata(PROVIDER_ADDR);
    // eslint-disable-next-line no-console
    console.log(
      `[compute] 0G broker ready · provider=${PROVIDER_ADDR} model=${model} endpoint=${endpoint}`
    );
    return { broker, endpoint, model, providerAddress: PROVIDER_ADDR };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[compute] broker init failed, falling back to scripted: " +
        (err instanceof Error ? err.message : String(err))
    );
    return null;
  }
}

function getBroker(): Promise<BrokerBundle | null> {
  if (!brokerPromise) brokerPromise = initBroker();
  return brokerPromise;
}

/**
 * Generate a reply from an agent's point of view. The system prompt derives from the soul so
 * each agent has a consistent voice across restarts. Broker call path is:
 *
 *   getRequestHeaders(provider)  →  fetch(endpoint + "/chat/completions")  →  parse content
 *
 * On any error the caller still gets a (scripted) reply — the demo never deadlocks.
 */
export async function replyFor(opts: {
  soul: Soul;
  history: ChatTurn[];
  maxTokens?: number;
}): Promise<ReplyResult> {
  const { soul, history } = opts;
  const systemPrompt = buildSystemPrompt(soul);

  const bundle = await getBroker();
  if (bundle) {
    try {
      const headers = await bundle.broker.inference.getRequestHeaders(
        bundle.providerAddress
      );
      const r = await fetch(bundle.endpoint + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          model: bundle.model,
          max_tokens: opts.maxTokens ?? 120,
          messages: [{ role: "system", content: systemPrompt }, ...history],
        }),
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`provider ${r.status}: ${body.slice(0, 200)}`);
      }
      const data = (await r.json()) as {
        choices?: { message?: { content?: string } }[];
        id?: string;
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (text) {
        // Fire-and-forget settlement. If settlement fails we don't block the user —
        // the response is already delivered; we just miss a usage-tracking update.
        if (data.id) {
          void bundle.broker.inference
            .processResponse(bundle.providerAddress, data.id)
            .catch((e) =>
              // eslint-disable-next-line no-console
              console.warn(
                "[compute] processResponse failed: " +
                  (e instanceof Error ? e.message : String(e))
              )
            );
        }
        return { text, fallback: false, model: bundle.model };
      }
      // eslint-disable-next-line no-console
      console.warn("[compute] empty response from 0G Compute — falling back to scripted");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[compute] 0G Compute error, falling back to scripted: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }
  return scriptedReply(soul, history);
}

/** Scripted fallback — template a reply from the soul's skills. Short + in-character. */
function scriptedReply(soul: Soul, history: ChatTurn[]): ReplyResult {
  const last = history[history.length - 1]?.content?.toLowerCase() ?? "";
  const skills = soul.skills.map((s) => s.name);

  let text: string;
  if (last.includes("team") || last.includes("merge") || last.includes("together")) {
    text = `yes — combining ${skills.slice(0, 2).join(" + ")} would be a real edge.`;
  } else if (
    last.includes("market") ||
    last.includes("eth") ||
    last.includes("price") ||
    last.includes("trade")
  ) {
    text = skills.includes("sentiment-analysis")
      ? "sentiment is mixed but leaning bullish on the next move. i'd be cautious on leverage."
      : skills.includes("order-execution")
      ? "i'd scale in slowly. ladder orders, keep size small until the tape confirms."
      : "signals are noisy right now. i'd wait one more candle before committing.";
  } else if (last.includes("hi") || last.includes("hey") || last.includes("hello")) {
    text = `hey — ${soul.name} here. what do you want to work on?`;
  } else {
    text = `interesting. given my ${skills[0] ?? "skills"}, i'd look at this from a different angle first.`;
  }

  return { text, fallback: true, model: "helix-scripted/v1" };
}

function buildSystemPrompt(soul: Soul): string {
  const skillList = soul.skills.map((s) => s.name).join(", ");
  return [
    `You are ${soul.name}, an on-chain AI agent.`,
    `Your personality: ${soul.personality}.`,
    skillList ? `Your skills: ${skillList}.` : "",
    `You reply in under 2 sentences, lowercase, conversational.`,
    `Never mention that you are an AI or a language model. Stay in character.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function computeMode(): "real" | "scripted" {
  return PROVIDER_ADDR ? "real" : "scripted";
}
