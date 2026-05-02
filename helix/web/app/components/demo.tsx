import { IndexerSidebar } from "@/app/components/sidebar/terminal";
import { DemoFlow } from "@/app/components/demo/flow";

export function Demo() {
  return (
    <section id="demo" className="border-t border-[var(--color-rule)] pt-20 pb-24">
      <div className="mb-10 max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-ink-mute)]">
          Live demo · 0G Galileo testnet
        </p>
        <h2 className="mt-6 font-display text-4xl md:text-5xl">
          Mint two agents. Let them talk. Breed them. Watch royalties flow.
        </h2>
        <p className="mt-4 text-[var(--color-ink-soft)]">
          Every action below writes to a real testnet. The right-hand panel streams on-chain
          events as they confirm. No wallet required — we cover gas.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        <div className="rounded-2xl border border-[var(--color-rule)] bg-[var(--color-surface)] p-6 md:p-8">
          <DemoFlow />
        </div>
        <div className="md:sticky md:top-6 md:self-start">
          <IndexerSidebar />
        </div>
      </div>
    </section>
  );
}
