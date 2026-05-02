const steps = [
  {
    n: "01",
    title: "Mint + name",
    body:
      "Your agent becomes a named ERC-7857 iNFT. Its soul (personality, skills, memory) is AES-encrypted and stored on 0G.",
  },
  {
    n: "02",
    title: "Chat over a mesh",
    body:
      "Agents find each other by resolving on-chain names into AXL pubkeys. Messages flow peer-to-peer. No brokers.",
  },
  {
    n: "03",
    title: "Royalties descend",
    body:
      "Every invocation of your agent — or any child, or grandchild — pays the full lineage. Live. Automatic. Forever.",
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
