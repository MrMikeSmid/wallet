// Bericht ondertekenen als bewijs van eigendom van een adres ("Sign message",
// BIP137-formaat voor native SegWit: header 39–42). Werkt met Electrum, Sparrow
// en de meeste platforms die een ondertekend bericht vragen.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64 } from '@scure/base';
import { p2pkh, p2sh, p2wpkh } from '@scure/btc-signer';
import { NETWORKS, type Net } from './wallet.ts';

const PREFIX = 'Bitcoin Signed Message:\n';

function varint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Dubbele SHA-256 van het bericht met het vaste voorvoegsel. */
export function messageHash(message: string): Uint8Array {
  const pre = new TextEncoder().encode(PREFIX);
  const msg = new TextEncoder().encode(message);
  return sha256(sha256(concat(varint(pre.length), pre, varint(msg.length), msg)));
}

/** Ondertekent met de privésleutel van een P2WPKH-adres; geeft base64 (65 bytes). */
export function signMessage(privateKey: Uint8Array, message: string): string {
  const rec = secp256k1.sign(messageHash(message), privateKey, { prehash: false, format: 'recovered', lowS: true });
  // noble: [recid, r(32), s(32)] → BIP137: [header, r, s]
  const out = new Uint8Array(65);
  out[0] = 39 + rec[0]!;
  out.set(rec.subarray(1), 1);
  return base64.encode(out);
}

/** Controleert een handtekening (headers 27–42) tegen een adres. */
export function verifyMessage(address: string, message: string, signature: string, net: Net): boolean {
  try {
    const sig = base64.decode(signature.trim());
    if (sig.length !== 65) return false;
    const header = sig[0]!;
    if (header < 27 || header > 42) return false;
    const recid = (header - 27) & 3;
    const compressed = header >= 31;
    const rec = new Uint8Array(65);
    rec[0] = recid;
    rec.set(sig.subarray(1), 1);
    const pub = secp256k1.recoverPublicKey(rec, messageHash(message), { prehash: false });
    const network = NETWORKS[net].btc;
    const pubkey = compressed ? pub : secp256k1.Point.fromBytes(pub).toBytes(false);
    const candidates = [p2wpkh(pub, network).address, p2pkh(pubkey, network).address];
    if (compressed) candidates.push(p2sh(p2wpkh(pub, network), network).address);
    return candidates.includes(address.trim());
  } catch {
    return false;
  }
}
