#!/usr/bin/env bash
# AXL two-node smoke test.
#
# Usage: ./run.sh
#
# Spins up two AXL nodes (alice on :9102, bob on :9202), exchanges messages
# both directions, prints pubkeys + topology + payload confirmation, and
# tears everything down. Exits 0 on success.
#
# Prerequisite: `node` binary at repo root (built via `make build` in the AXL source).

set -euo pipefail
cd "$(dirname "$0")"

cleanup() {
  [[ -n "${ALICE_PID:-}" ]] && kill "$ALICE_PID" 2>/dev/null || true
  [[ -n "${BOB_PID:-}" ]]   && kill "$BOB_PID"   2>/dev/null || true
}
trap cleanup EXIT

if [[ ! -x ./node ]]; then
  echo "error: ./node binary missing — build it via 'cd reference/axl && make build && cp node ../../helix/axl-smoke/'"
  exit 1
fi

mkdir -p alice bob
[[ -f alice/private.pem ]] || openssl genpkey -algorithm ed25519 -out alice/private.pem 2>/dev/null
[[ -f bob/private.pem   ]] || openssl genpkey -algorithm ed25519 -out bob/private.pem   2>/dev/null

echo "◆ starting alice (listener) on API :9102, mesh TLS :9101, tcp :7000..."
( cd alice && ../node -config node-config.json > ../alice.log 2>&1 ) &
ALICE_PID=$!

echo "◆ starting bob (dialer)   on API :9202..."
sleep 1
( cd bob && ../node -config node-config.json > ../bob.log 2>&1 ) &
BOB_PID=$!

sleep 3

ALICE_PK=$(curl -sS http://127.0.0.1:9102/topology | python3 -c 'import sys,json; print(json.load(sys.stdin)["our_public_key"])')
BOB_PK=$(curl -sS http://127.0.0.1:9202/topology | python3 -c 'import sys,json; print(json.load(sys.stdin)["our_public_key"])')

echo "  alice pubkey: $ALICE_PK"
echo "  bob   pubkey: $BOB_PK"

echo
echo "◆ bob → alice:"
curl -sS -X POST "http://127.0.0.1:9202/send" \
  -H "X-Destination-Peer-Id: $ALICE_PK" \
  --data-binary "hello alice from bob" -o /dev/null -w "  HTTP %{http_code}\n"

sleep 1
echo "◆ alice /recv:"
RECV=$(curl -sS "http://127.0.0.1:9102/recv")
[[ "$RECV" == "hello alice from bob" ]] || { echo "  ✗ mismatch: got '$RECV'"; exit 1; }
echo "  ✓ received: \"$RECV\""

echo
echo "◆ alice → bob:"
curl -sS -X POST "http://127.0.0.1:9102/send" \
  -H "X-Destination-Peer-Id: $BOB_PK" \
  --data-binary "ack from alice" -o /dev/null -w "  HTTP %{http_code}\n"

sleep 1
echo "◆ bob /recv:"
RECV=$(curl -sS "http://127.0.0.1:9202/recv")
[[ "$RECV" == "ack from alice" ]] || { echo "  ✗ mismatch: got '$RECV'"; exit 1; }
echo "  ✓ received: \"$RECV\""

echo
echo "✅ AXL two-node smoke passed"
