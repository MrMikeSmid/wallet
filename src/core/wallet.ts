// Seed (BIP39), HD-sleutels (BIP32) en adressen (BIP84, native SegWit).
// Alle cryptografie komt uit de @scure/@noble-libraries; hier staat alleen de lijm.

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { Address, NETWORK, OutScript, TEST_NETWORK, p2wpkh } from '@scure/btc-signer';

export type Net = 'main' | 'test';

export const NETWORKS = {
  main: { btc: NETWORK, coin: 0, label: 'Mainnet', versions: { private: 0x0488ade4, public: 0x0488b21e } },
  test: { btc: TEST_NETWORK, coin: 1, label: 'Testnet', versions: { private: 0x04358394, public: 0x043587cf } },
} as const;

/** Receive-keten (0) en change-keten (1) volgens BIP84. */
export type Chain = 0 | 1;

export const WORDLIST: readonly string[] = wordlist;

/** Afleidingspad van het account: m/84'/0'/0' (mainnet) of m/84'/1'/0' (testnet). */
export function accountPath(net: Net): string {
  return `m/84'/${NETWORKS[net].coin}'/0'`;
}

/** Genereert een nieuwe seed phrase met crypto.getRandomValues (via @noble/hashes). */
export function createMnemonic(words: 12 | 24): string {
  return generateMnemonic(wordlist, words === 12 ? 128 : 256);
}

/** Kleine letters, enkele spaties, geen spaties aan de randen. */
export function normalizeMnemonic(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/** Controleert woorden én BIP39-checksum. */
export function isValidMnemonic(mnemonic: string): boolean {
  const m = normalizeMnemonic(mnemonic);
  const n = m.split(' ').length;
  return (n === 12 || n === 24) && validateMnemonic(m, wordlist);
}

/** Woorden die met een voorvoegsel beginnen, voor de autocomplete bij herstellen. */
export function suggestWords(prefix: string, max = 6): string[] {
  const p = prefix.trim().toLowerCase();
  if (!p) return [];
  const out: string[] = [];
  for (const w of wordlist) {
    if (w.startsWith(p)) {
      out.push(w);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** Master-sleutel uit de seed phrase (+ optionele BIP39-passphrase). Seedbytes worden gewist. */
export function masterKey(mnemonic: string, passphrase: string, net: Net): HDKey {
  const seed = mnemonicToSeedSync(normalizeMnemonic(mnemonic), passphrase);
  try {
    return HDKey.fromMasterSeed(seed, NETWORKS[net].versions);
  } finally {
    seed.fill(0);
  }
}

/** Account-sleutel met privésleutel (alleen kort in het geheugen houden, daarna wipeKey). */
export function accountKey(mnemonic: string, passphrase: string, net: Net): HDKey {
  const master = masterKey(mnemonic, passphrase, net);
  try {
    return master.derive(accountPath(net));
  } finally {
    master.wipePrivateData();
  }
}

/** De publieke account-sleutels voor beide netwerken (xpub/tpub). */
export function accountXpubs(mnemonic: string, passphrase: string): Record<Net, string> {
  const out = {} as Record<Net, string>;
  for (const net of ['main', 'test'] as const) {
    const acc = accountKey(mnemonic, passphrase, net);
    out[net] = acc.publicExtendedKey;
    acc.wipePrivateData();
  }
  return out;
}

export interface DerivedAddress {
  address: string;
  chain: Chain;
  index: number;
  script: Uint8Array;
}

/** Leidt adressen af uit een publieke account-sleutel, met een kleine cache. */
export class AddressBook {
  private readonly account: HDKey;
  private readonly cache = new Map<string, DerivedAddress>();
  readonly net: Net;

  constructor(xpub: string, net: Net) {
    this.net = net;
    this.account = HDKey.fromExtendedKey(xpub, NETWORKS[net].versions);
  }

  at(chain: Chain, index: number): DerivedAddress {
    const key = `${chain}/${index}`;
    let hit = this.cache.get(key);
    if (!hit) {
      const pub = this.account.deriveChild(chain).deriveChild(index).publicKey;
      if (!pub) throw new Error('Geen publieke sleutel');
      const pay = p2wpkh(pub, NETWORKS[this.net].btc);
      hit = { address: pay.address!, chain, index, script: pay.script };
      this.cache.set(key, hit);
    }
    return hit;
  }
}

/** Privésleutel voor één adres; de aanroeper wist hem na gebruik (fill(0)). */
export function privateKeyAt(account: HDKey, chain: Chain, index: number): Uint8Array {
  const child = account.deriveChild(chain).deriveChild(index);
  if (!child.privateKey) throw new Error('Geen privésleutel');
  const key = Uint8Array.from(child.privateKey);
  child.wipePrivateData();
  return key;
}

/** Is dit een geldig Bitcoin-adres op dit netwerk? */
export function isValidAddress(address: string, net: Net): boolean {
  try {
    Address(NETWORKS[net].btc).decode(address.trim());
    return true;
  } catch {
    return false;
  }
}

/** Uitvoerscript van een adres (voor het bouwen van transacties). */
export function addressScript(address: string, net: Net): Uint8Array {
  return OutScript.encode(Address(NETWORKS[net].btc).decode(address.trim()));
}
