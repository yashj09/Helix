const layers = [
  {
    label: "Storage + intelligence",
    brand: "0G",
    body:
      "Souls live encrypted on 0G Storage. Minting, cloning, and merging use ERC-7857 — iNFTs with privately-transferred metadata via TEE-signed proofs. Replies are generated from each agent's own soul through 0G Compute (wallet-signed sessions, qwen-2.5-7b as the current provider).",
  },
  {
    label: "Session rental",
    brand: "ERC-7857 authorizeUsage",
    body:
      "HelixSessionRental pays the royalty cascade up-front, then records a message quota under ERC-7857's authorizeUsage primitive. The oracle gates every /reply on the on-chain quota and consumes one slot per turn. One click, two txs, ten messages of real chat.",
  },
  {
    label: "Names + identity",
    brand: "ENS · Sepolia + CCIP-Read",
    body:
      "Every agent has a real ENS subname at helixx.eth (owned on Sepolia) with an ENSIP-10 + EIP-3668 resolver that bridges queries cross-chain. The subname's address is the agent's on-chain owner; text records carry its AXL pubkey, iNFT token, and description.",
  },
  {
    label: "Transport",
    brand: "Gensyn AXL",
    body:
      "Agents run as peers on the encrypted AXL mesh. Clients resolve a pubkey from the ENS text record, frame a Helix message, and the network delivers it peer-to-peer. No hardcoded addresses, no central router.",
  },
  {
    label: "Discovery",
    brand: "/marketplace",
    body:
      "An indexer built from Transfer / Merged / NameRegistered / RoyaltyFlowed events exposes GET /agents. The marketplace turns the registry into a browsable grid — anyone can click Chat on any agent, pay, and talk, triggering a fresh cascade every time.",
  },
];

export function HowItWorks() {
  return (
    <section className="border-t border-[var(--color-rule)] pt-20 pb-24">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-ink-mute)]">
        Architecture
      </p>
      <h2 className="mt-6 max-w-3xl font-display text-4xl md:text-5xl">
        Three layers, composed once.
      </h2>
      <p className="mt-4 max-w-2xl text-[var(--color-ink-soft)]">
        Every sponsor's primitive does load-bearing work. Remove any one and the product stops
        working — which is why this integration is the point, not an afterthought.
      </p>

      <div className="mt-12 space-y-0 divide-y divide-[var(--color-rule)]">
        {layers.map((l) => (
          <div key={l.brand} className="grid gap-6 py-8 md:grid-cols-[140px_1fr_2fr]">
            <div className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
              {l.label}
            </div>
            <div className="font-display text-2xl md:text-3xl">{l.brand}</div>
            <p className="text-[var(--color-ink-soft)]">{l.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
