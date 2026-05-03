"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

type ProofData = {
  tokenId: string;
  owner: string;
  onchain: { dataHash: string; dataDescription: string };
  storage: { rootHash: string | null; ciphertextBytes: number; storage: string };
  explorerTokenUrl: string;
};

/**
 * Foldable "View ERC-7857 proof" panel. Sits inside AgentCard. Closed by default so the
 * card looks clean; expands into a set of hard proofs the 0G iNFT track brief asks for:
 *  - on-chain dataHash commitment
 *  - 0G Storage rootHash
 *  - ciphertext download (proof it's there but private)
 *  - owner-only decrypt (proof only the owner can read)
 */
export function ProofPanel({ tokenId, explorerBase }: { tokenId: number; explorerBase: string }) {
  const [open, setOpen] = useState(false);
  const [proof, setProof] = useState<ProofData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<object | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  async function ensureProof(): Promise<ProofData | null> {
    if (proof) return proof;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/soul/${tokenId}/proof`);
      if (!r.ok) {
        const b = await r.text();
        throw new Error(b);
      }
      const body = (await r.json()) as ProofData;
      setProof(body);
      return body;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handleReveal() {
    setRevealError(null);
    setRevealing(true);
    try {
      const r = await fetch(`/api/soul/${tokenId}/reveal`, { method: "POST" });
      const body = (await r.json()) as { soul?: object; error?: string; hint?: string };
      if (!r.ok) {
        setRevealError((body.error ?? "reveal failed") + (body.hint ? " — " + body.hint : ""));
        return;
      }
      setReveal(body.soul ?? null);
    } catch (e) {
      setRevealError(e instanceof Error ? e.message : String(e));
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="mt-3 border-t border-[var(--color-rule)] pt-3">
      <button
        onClick={() => {
          setOpen((p) => !p);
          if (!open) void ensureProof();
        }}
        className="flex w-full items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink-mute)] hover:text-[var(--color-ink)]"
      >
        <span>View ERC-7857 proof</span>
        <span>{open ? "−" : "+"}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="proof"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-3 flex flex-col gap-3">
              {loading && (
                <div className="font-mono text-[11px] text-[var(--color-ink-mute)]">
                  loading on-chain proof…
                </div>
              )}
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 p-2 font-mono text-[11px] text-red-900">
                  {error}
                </div>
              )}

              {proof && (
                <>
                  <ProofRow
                    label="dataHash"
                    value={proof.onchain.dataHash}
                    monospace
                  />
                  <ProofRow
                    label="dataDescription"
                    value={proof.onchain.dataDescription}
                  />
                  <ProofRow
                    label="owner"
                    value={proof.owner}
                    monospace
                    href={`${explorerBase}/address/${proof.owner}`}
                  />
                  <ProofRow
                    label="storage backend"
                    value={proof.storage.storage}
                  />
                  {proof.storage.rootHash && (
                    <ProofRow
                      label="0G Storage rootHash"
                      value={proof.storage.rootHash}
                      monospace
                      href={`https://indexer-storage-testnet-turbo.0g.ai/file?root=${proof.storage.rootHash}`}
                    />
                  )}
                  <ProofRow
                    label="encrypted bytes"
                    value={`${proof.storage.ciphertextBytes} bytes`}
                  />
                  {/* v2-audit fix: explicit sealed-key row. The sidebar labels the event (🔒)
                      as it fires on-chain; here we surface the recipient + payload shape. */}
                  <ProofRow
                    label="sealed key (ERC-7857)"
                    value={`sealed for ${proof.owner.slice(0, 6)}…${proof.owner.slice(-4)} · see PublishedSealedKey`}
                  />

                  <div className="flex flex-wrap gap-2 pt-2">
                    <a
                      href={`/api/soul/${tokenId}/ciphertext`}
                      download
                      className="rounded-md border border-[var(--color-rule)] bg-[var(--color-paper)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface)]"
                    >
                      ↓ Download ciphertext
                    </a>
                    <button
                      onClick={handleReveal}
                      disabled={revealing || !!reveal}
                      className="rounded-md bg-[var(--color-ink)] px-3 py-1.5 text-xs font-medium text-[var(--color-paper)] disabled:opacity-50"
                    >
                      {revealing
                        ? "Decrypting…"
                        : reveal
                        ? "Decrypted ↓"
                        : "🔓 Decrypt soul (owner only)"}
                    </button>
                    <a
                      href={proof.explorerTokenUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-[var(--color-rule)] px-3 py-1.5 text-xs hover:bg-[var(--color-paper)]"
                    >
                      View contract ↗
                    </a>
                  </div>

                  {revealError && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                      {revealError}
                    </div>
                  )}

                  {reveal && (
                    <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-[var(--color-term-bg)] p-3 font-mono text-[11px] text-[var(--color-term-ink)]">
                      {JSON.stringify(reveal, null, 2)}
                    </pre>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ProofRow({
  label,
  value,
  monospace,
  href,
}: {
  label: string;
  value: string;
  monospace?: boolean;
  href?: string;
}) {
  const cls = monospace ? "font-mono text-[11px]" : "text-xs";
  return (
    <div className="flex items-baseline justify-between gap-3 text-[var(--color-ink-soft)]">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-mute)] shrink-0">
        {label}
      </span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={`${cls} truncate text-[var(--color-ink)] hover:underline`}
          title={value}
        >
          {value}
        </a>
      ) : (
        <span className={`${cls} truncate text-[var(--color-ink)]`} title={value}>
          {value}
        </span>
      )}
    </div>
  );
}
