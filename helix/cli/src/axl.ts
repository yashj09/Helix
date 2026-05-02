// Thin client for an AXL node's local HTTP bridge (default 127.0.0.1:9002).
//
// We treat AXL as a transport: every Helix agent runs its own AXL node. An agent identifies
// peers by their 64-hex ed25519 pubkey (from /topology); messages are sent via /send and
// polled via /recv. For Helix we wrap the raw bytes in a tiny envelope so recipients can
// correlate messages back to tokenIds and replay cryptographically.

export interface TopologyResponse {
  our_ipv6: string;
  our_public_key: string;
  peers: Array<{
    uri: string;
    up: boolean;
    inbound: boolean;
    public_key: string;
  }>;
}

export interface HelixMessage {
  v: 1;
  kind: "greet" | "invoke" | "reply" | "ack";
  fromTokenId: number;
  toTokenId: number;
  text: string;
  nonce: string; // ms timestamp + random suffix — keeps replay detection simple
}

export class AxlClient {
  constructor(private readonly baseUrl: string) {}

  async topology(): Promise<TopologyResponse> {
    const r = await fetch(this.baseUrl + "/topology");
    if (!r.ok) throw new Error(`AXL /topology ${r.status}`);
    return (await r.json()) as TopologyResponse;
  }

  async sendRaw(destPubkey: string, body: Uint8Array | string): Promise<void> {
    // Normalize Uint8Array → ArrayBuffer (fetch() doesn't accept Uint8Array directly
    // in some TS lib configurations, and SharedArrayBuffer doesn't match BodyInit).
    let payload: BodyInit;
    if (typeof body === "string") {
      payload = body;
    } else {
      const copy = new Uint8Array(body.byteLength);
      copy.set(body);
      payload = copy.buffer as ArrayBuffer;
    }
    const r = await fetch(this.baseUrl + "/send", {
      method: "POST",
      headers: {
        "X-Destination-Peer-Id": destPubkey,
        "Content-Type": "application/octet-stream",
      },
      body: payload,
    });
    if (!r.ok) throw new Error(`AXL /send ${r.status}: ${await r.text()}`);
  }

  async sendHelixMessage(destPubkey: string, msg: HelixMessage): Promise<void> {
    const payload = JSON.stringify(msg);
    return this.sendRaw(destPubkey, payload);
  }

  /**
   * Poll /recv once. Returns null if queue empty.
   * Returns { fromPeerId, body } where body is raw bytes; call parseHelixMessage to decode.
   */
  async recvOnce(): Promise<{ fromPeerId: string; body: Uint8Array } | null> {
    const r = await fetch(this.baseUrl + "/recv");
    if (r.status === 204) return null;
    if (!r.ok) throw new Error(`AXL /recv ${r.status}`);
    const fromPeerId = r.headers.get("x-from-peer-id") ?? "";
    const ab = await r.arrayBuffer();
    return { fromPeerId, body: new Uint8Array(ab) };
  }

  /** Poll with exponential backoff until a message arrives or timeoutMs elapses. */
  async recvOnceWithTimeout(timeoutMs = 5000): Promise<{ fromPeerId: string; body: Uint8Array } | null> {
    const start = Date.now();
    let delay = 150;
    while (Date.now() - start < timeoutMs) {
      const msg = await this.recvOnce();
      if (msg) return msg;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 800);
    }
    return null;
  }
}

export function parseHelixMessage(body: Uint8Array): HelixMessage | null {
  try {
    const text = new TextDecoder().decode(body);
    const obj = JSON.parse(text) as HelixMessage;
    if (obj && obj.v === 1 && typeof obj.kind === "string") return obj;
    return null;
  } catch {
    return null;
  }
}

export function newHelixMessage(
  kind: HelixMessage["kind"],
  fromTokenId: number,
  toTokenId: number,
  text: string
): HelixMessage {
  return {
    v: 1,
    kind,
    fromTokenId,
    toTokenId,
    text,
    nonce: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  };
}
