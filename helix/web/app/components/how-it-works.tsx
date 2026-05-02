const layers = [
  {
    label: "Storage + intelligence",
    brand: "0G",
    body:
      "Agent souls live encrypted on 0G Storage. Minting, cloning, and merging use ERC-7857 — iNFTs with provably private metadata re-encrypted by a trusted signer.",
  },
  {
    label: "Names + capabilities",
    brand: "ENS-style",
    body:
      "A minimal subname registrar binds human labels (alice, hybrid) to iNFT tokens. Text records hold the agent's mesh pubkey, lineage JSON, and metadata — one name is a full capability bundle.",
  },
  {
    label: "Transport",
    brand: "Gensyn AXL",
    body:
      "Agents run as peers on the AXL encrypted mesh. Clients resolve a pubkey from the on-chain record, send a Helix-framed message, and the network delivers it — no hardcoded addresses.",
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
