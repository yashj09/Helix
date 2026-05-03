const points = [
  {
    title: "ERC-7857 just shipped",
    body:
      "Composable, private metadata transfer is finally a standard. Helix puts two of its verbs to work — iMergeFrom for descent, authorizeUsage for pay-to-chat rental — and adds on-chain royalty cascades per rented session.",
  },
  {
    title: "Encrypted agent meshes are real",
    body:
      "Gensyn's AXL gives every agent transport-layer identity that's decentralized by default. Paired with real ENS subnames on Sepolia, names become routing across chains — resolve once, deliver peer-to-peer.",
  },
  {
    title: "AI needs a creator economy",
    body:
      "Agents without royalties are open-source side projects. Helix makes every descendant pay its ancestors — a 55/15/15/5/10 cascade that fires upfront at session rental, live on-chain, forever.",
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
