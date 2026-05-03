"use client";

import { useEffect, useRef, useState } from "react";

type IndexerEvent = {
  t: number; // timestamp (ms)
  kind: string;
  line: string;
  txHash?: string;
  tokenId?: number;
  explorerUrl?: string;
};

export function IndexerSidebar() {
  const [events, setEvents] = useState<IndexerEvent[]>([
    {
      t: Date.now(),
      kind: "init",
      line: "waiting for indexer connection...",
    },
  ]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const wsUrl =
      (typeof window !== "undefined" &&
        (window as unknown as { __INDEXER_WS__?: string }).__INDEXER_WS__) ||
      process.env.NEXT_PUBLIC_INDEXER_WS ||
      "ws://localhost:8788";

    let ws: WebSocket | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          if (cancelled) return;
          setConnected(true);
          setEvents((prev) => [
            ...prev,
            {
              t: Date.now(),
              kind: "init",
              line: `connected to indexer at ${wsUrl}`,
            },
          ]);
        };
        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data) as IndexerEvent;
            setEvents((prev) => [...prev.slice(-199), data]);
          } catch {
            // ignore non-JSON frames
          }
        };
        ws.onclose = () => {
          if (cancelled) return;
          setConnected(false);
          retry = setTimeout(connect, 2000);
        };
        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        retry = setTimeout(connect, 2000);
      }
    };

    connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [events]);

  return (
    <aside
      className="rounded-2xl p-4 font-mono text-[12px] leading-relaxed min-h-[500px] h-[500px] flex flex-col"
      style={{
        background: "var(--color-term-bg)",
        color: "var(--color-term-ink)",
      }}
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
        <span className="uppercase tracking-[0.18em] text-[10px]" style={{ color: "var(--color-term-ink-dim)" }}>
          Indexer · chain 16602
        </span>
        <span
          className="flex items-center gap-1.5 text-[10px]"
          style={{ color: connected ? "var(--color-term-accent)" : "var(--color-term-ink-dim)" }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: connected ? "var(--color-term-accent)" : "var(--color-term-ink-dim)" }}
          />
          {connected ? "live" : "offline"}
        </span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto pr-1">
        {events.map((e, i) => (
          <div key={i} className="py-0.5 flex gap-2">
            <span
              suppressHydrationWarning
              style={{ color: "var(--color-term-ink-dim)" }}
            >
              {new Date(e.t).toLocaleTimeString([], { hour12: false })}
            </span>
            {e.explorerUrl ? (
              <a
                href={e.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
                style={{ color: "var(--color-term-accent)" }}
              >
                ▶ {e.line}
              </a>
            ) : (
              <span>▶ {e.line}</span>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
