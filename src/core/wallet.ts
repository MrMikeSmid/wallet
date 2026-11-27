import { HDKey } from '@scure/bip32';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { NETWORK, TEST_NETWORK, WIF, p2wpkh } from '@scure/btc-signer';
import { createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';

export type Net = 'main' | 'test';
export const network = (n: Net) => (n === 'main' ? NETWORK : TEST_NETWORK);
const b58c = createBase58check(sha256);

export function newMnemonic(words: 12 | 24 = 12): string {
  return generateMnemonic(wordlist, words === 24 ? 256 : 128);
}
export function normalizeMnemonic(m: string): string {
  return m.trim().toLowerCase().normalize('NFKD').split(/\s+/).join(' ');
}
export function isValidMnemonic(m: string): boolean {
  return validateMnemonic(normalizeMnemonic(m), wordlist);
}
export const words = wordlist;

/** BIP84-account (Native SegWit, m/84'/coin'/0'). */
export class Account {
  readonly account: HDKey;
  readonly net: Net;
  private cache = new Map<string, string>();
  constructor(mnemonic: string, passphrase: string, net: Net) {
    this.net = net;
    const seed = mnemonicToSeedSync(normalizeMnemonic(mnemonic), passphrase);
    const root = HDKey.fromMasterSeed(seed);
    this.account = root.derive(`m/84'/${net === 'main' ? 0 : 1}'/0'`);
  }
  path(chain: 0 | 1, index: number): string {
    return `m/84'/${this.net === 'main' ? 0 : 1}'/0'/${chain}/${index}`;
  }
  key(chain: 0 | 1, index: number): HDKey {
    return this.account.deriveChild(chain).deriveChild(index);
  }
  address(chain: 0 | 1, index: number): string {
    const k = `${chain}/${index}`;
    let a = this.cache.get(k);
    if (!a) {
      a = p2wpkh(this.key(chain, index).publicKey!, network(this.net)).address!;
      this.cache.set(k, a);
    }
    return a;
  }
  privateKey(chain: 0 | 1, index: number): Uint8Array {
    return this.key(chain, index).privateKey!;
  }
  wif(chain: 0 | 1, index: number): string {
    return WIF(network(this.net)).encode(this.privateKey(chain, index));
  }
  /** Uitgebreide publieke sleutel in SLIP-132-notatie (zpub/vpub). */
  extendedPublic(): string {
    const raw = b58c.decode(this.account.publicExtendedKey);
    const ver = this.net === 'main' ? [0x04, 0xb2, 0x47, 0x46] : [0x04, 0x5f, 0x1c, 0xf6];
    const out = new Uint8Array(raw);
    out.set(ver, 0);
    return b58c.encode(out);
  }
}
