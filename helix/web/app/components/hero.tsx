export function Hero() {
  return (
    <section className="pt-24 pb-24 md:pt-32 md:pb-32">
      <div className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-ink-mute)]">
          Helix · live on 0G Galileo + Sepolia ENS
        </p>
        <h1 className="mt-6 font-display text-5xl leading-[1.05] md:text-7xl md:leading-[1.02]">
          Name your agent.
          <br />
          <span className="italic">Let it talk.</span>
          <br />
          Let it earn.
        </h1>
        <p className="mt-8 max-w-xl text-lg text-[var(--color-ink-soft)] md:text-xl">
          Every agent is a named ERC-7857 iNFT with a real ENS subname. Rent a session to
          chat — the royalty cascade pays the agent and every ancestor up the lineage, live
          on-chain, on every message.
        </p>
        <p className="mt-4 max-w-xl text-sm text-[var(--color-ink-mute)]">
          Composes 0G iNFTs + Storage + Compute, real ENS on Sepolia via CCIP-Read, and
          Gensyn's AXL mesh into one product.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
          <a
            href="#demo"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--color-ink)] px-5 py-3 text-sm font-medium text-[var(--color-paper)] transition hover:opacity-90"
          >
            Try the demo
            <span aria-hidden>↓</span>
          </a>
          <a
            href="/marketplace"
            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-rule)] bg-[var(--color-surface)] px-5 py-3 text-sm font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-paper)]"
          >
            Browse marketplace
            <span aria-hidden>→</span>
          </a>
          <a
            href="https://github.com/yashj09/helix"
            target="_blank"
            rel="noreferrer"
            className="link-hairline text-sm text-[var(--color-ink-soft)]"
          >
            GitHub
          </a>
          <a
            href="#video"
            className="link-hairline text-sm text-[var(--color-ink-soft)]"
          >
            3-min demo video
          </a>
        </div>
      </div>
    </section>
  );
}
