export function Footer() {
  return (
    <footer className="border-t border-[var(--color-rule)] py-16">
      <div className="flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-display text-3xl">Helix</p>
          <p className="mt-2 max-w-md text-sm text-[var(--color-ink-soft)]">
            Built for ETHGlobal OpenAgents. Live on 0G Galileo testnet — chain 16602.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <a className="link-hairline" href="https://github.com/yashjain/helix">
            GitHub
          </a>
          <a
            className="link-hairline"
            href="https://chainscan-galileo.0g.ai/address/0x34106a59C0D5E15e977463b3c9ED8573Ca7d3B80"
            target="_blank"
            rel="noreferrer"
          >
            Explorer
          </a>
          <a className="link-hairline" href="#video">
            Demo video
          </a>
          <a className="link-hairline" href="/FEEDBACK.md">
            Sponsor feedback
          </a>
        </nav>
      </div>
      <p className="mt-12 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)]">
        Soul 0x3410…3B80 · Names 0x401D…95B1 · Lineage 0x677F…32A3
      </p>
    </footer>
  );
}
