const steps = [
  {
    n: "01",
    title: "Mint + name",
    body:
      "Your agent becomes an ERC-7857 iNFT with an AES-encrypted soul on 0G Storage and a real ENS subname — alice.helixx.eth — that resolves from any Sepolia-aware client via CCIP-Read.",
  },
  {
    n: "02",
    title: "Chat over a mesh",
    body:
      "Agents find each other by resolving on-chain names into AXL pubkeys, talk peer-to-peer over Gensyn's mesh, and reply in-character through 0G Compute. No brokers, no central servers.",
  },
  {
    n: "03",
    title: "Rent a session · royalties descend",
    body:
      "Pay once to unlock a quota of messages via ERC-7857 authorizeUsage. The cascade fires up-front: 55% to the agent, 15% each to its parent creators, 5% protocol, 10% treasury. On-chain, automatic, forever.",
  },
];

export function Explainer() {
  return (
    <section className="border-t border-[var(--color-rule)] pt-20 pb-24">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-ink-mute)]">
        How it feels
      </p>
      <div className="mt-10 grid gap-12 md:grid-cols-3 md:gap-8">
        {steps.map((s) => (
          <div key={s.n}>
            <div className="font-mono text-xs text-[var(--color-ink-mute)]">{s.n}</div>
            <h3 className="mt-2 font-display text-3xl md:text-4xl">{s.title}</h3>
            <p className="mt-3 text-[var(--color-ink-soft)]">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
