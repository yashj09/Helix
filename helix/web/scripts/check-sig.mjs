import { keccak256, hexToBytes, bytesToHex, recoverAddress } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";

function makeSignatureHash(sender, expires, request, result) {
  const payload = new Uint8Array(2 + 20 + 8 + 32 + 32);
  payload[0] = 0x19; payload[1] = 0x00;
  payload.set(hexToBytes(sender), 2);
  const expiresBytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) expiresBytes[i] = Number((expires >> BigInt((7-i)*8)) & 0xffn);
  payload.set(expiresBytes, 22);
  payload.set(hexToBytes(keccak256(request)), 30);
  payload.set(hexToBytes(keccak256(result)), 62);
  return keccak256(bytesToHex(payload));
}

const pk = process.env.RESOLVER_SIGNER_PRIVATE_KEY;
const account = privateKeyToAccount(pk);
console.log("signer:", account.address);

const sender = "0x1111111111111111111111111111111111111111";
const expires = 1800000000n;
const request = "0xdeadbeef";
const result = "0x00000000000000000000000033014845047C61CCF1672b7F6766C5Cc00999C09";

const h = makeSignatureHash(sender, expires, request, result);
console.log("hash:", h);

const sigObj = await sign({ hash: h, privateKey: pk });
const r = sigObj.r.slice(2).padStart(64,"0");
const s = sigObj.s.slice(2).padStart(64,"0");
const v = (27 + Number(sigObj.yParity ?? 0)).toString(16).padStart(2,"0");
const compact = "0x" + r + s + v;
console.log("sig:", compact);

const recovered = await recoverAddress({ hash: h, signature: compact });
console.log("recovered:", recovered, "match:", recovered.toLowerCase() === account.address.toLowerCase());
