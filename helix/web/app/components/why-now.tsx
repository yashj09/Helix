const points = [
  {
    title: "ERC-7857 just shipped",
    body:
      "Composable, private metadata transfer is finally a standard. Helix extends it with iMergeFrom — a new verb for agent descent.",
  },
  {
    title: "Encrypted agent meshes are real",
    body:
      "Gensyn's AXL gives every agent transport-layer identity that's decentralized by default. Names become routing, not just labels.",
  },
  {
    title: "AI needs a creator economy",
    body:
      "Agents without royalties are open-source side projects. Helix makes every descendant pay its ancestors — live, on-chain, forever.",
  },
];

export function WhyNow() {
  return (
    <section className="border-t border-[var(--color-rule)] pt-20 pb-24">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-ink-mute)]">
        Why now
      </p>
      <div className="mt-10 grid gap-10 md:grid-cols-3">
        {points.map((p) => (
          <div key={p.title}>
            <h3 className="font-display text-2xl md:text-3xl">{p.title}</h3>
            <p className="mt-3 text-[var(--color-ink-soft)]">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
