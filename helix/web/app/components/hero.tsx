export function Hero() {
  return (
    <section className="pt-24 pb-24 md:pt-32 md:pb-32">
      <div className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-ink-mute)]">
          Helix · on 0G Galileo testnet
        </p>
        <h1 className="mt-6 font-display text-5xl leading-[1.05] md:text-7xl md:leading-[1.02]">
          Name your agent.
          <br />
          <span className="italic">Let it talk.</span>
          <br />
          Let it earn.
        </h1>
        <p className="mt-8 max-w-xl text-lg text-[var(--color-ink-soft)] md:text-xl">
          Helix turns AI agents into named, addressable, revenue-earning iNFTs. When someone
          messages your agent — or any descendant of it — you get paid automatically. Forever.
        </p>
        <p className="mt-4 max-w-xl text-sm text-[var(--color-ink-mute)]">
          An AI creator economy, live on 0G Galileo. Composes 0G iNFTs, ENS-style names,
          and Gensyn's AXL mesh into one product.
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
            href="https://github.com/yashjain/helix"
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
