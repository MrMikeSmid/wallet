// Versleuteling van de seed en de walletstatus met WebCrypto:
// PBKDF2-SHA256 (600.000 iteraties, willekeurige salt) → AES-256-GCM.
//
// Uit de pincode worden twee sleutels afgeleid:
// - vaultKey: ontsleutelt de seed. Wordt alleen afgeleid wanneer de seed echt nodig is
//   (versturen, seed bekijken, bericht ondertekenen) en daarna weggegooid.
// - stateKey: ontsleutelt de walletstatus (xpubs, adresindexen, labels). Blijft als
//   niet-exporteerbare CryptoKey in het geheugen zolang de wallet ontgrendeld is.

import { base64 } from '@scure/base';

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PIN_LENGTH = 6;

export interface KdfParams {
  salt: string; // base64
  iterations: number;
}

export interface Sealed {
  iv: string; // base64, 12 bytes
  ct: string; // base64, ciphertext + GCM-tag
}

export interface Keys {
  vaultKey: CryptoKey;
  stateKey: CryptoKey;
}

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function newKdfParams(iterations = PBKDF2_ITERATIONS): KdfParams {
  return { salt: base64.encode(randomBytes(16)), iterations };
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${MIN_PIN_LENGTH},}$`).test(pin);
}

/** Leidt beide AES-sleutels af uit de pincode. Het tussenresultaat wordt gewist. */
export async function deriveKeys(pin: string, params: KdfParams): Promise<Keys> {
  const pinBytes = new TextEncoder().encode(pin);
  const base = await subtle().importKey('raw', pinBytes, 'PBKDF2', false, ['deriveBits']);
  pinBytes.fill(0);
  const bits = new Uint8Array(
    await subtle().deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: base64.decode(params.salt) as Uint8Array<ArrayBuffer>, iterations: params.iterations },
      base,
      512,
    ),
  );
  try {
    const imp = (part: Uint8Array<ArrayBuffer>) =>
      subtle().importKey('raw', part, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const vaultKey = await imp(bits.slice(0, 32));
    const stateKey = await imp(bits.slice(32, 64));
    return { vaultKey, stateKey };
  } finally {
    bits.fill(0);
  }
}

export async function seal(key: CryptoKey, plain: Uint8Array<ArrayBuffer>): Promise<Sealed> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { iv: base64.encode(iv), ct: base64.encode(ct) };
}

/** Gooit een fout bij een verkeerde sleutel (de GCM-tag klopt dan niet). */
export async function open(key: CryptoKey, box: Sealed): Promise<Uint8Array<ArrayBuffer>> {
  const iv = base64.decode(box.iv) as Uint8Array<ArrayBuffer>;
  const ct = base64.decode(box.ct) as Uint8Array<ArrayBuffer>;
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv }, key, ct));
}

export async function sealJson(key: CryptoKey, value: unknown): Promise<Sealed> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  try {
    return await seal(key, bytes);
  } finally {
    bytes.fill(0);
  }
}

export async function openJson<T>(key: CryptoKey, box: Sealed): Promise<T> {
  const bytes = await open(key, box);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } finally {
    bytes.fill(0);
  }
}

/** De inhoud van de kluis: alleen de seed phrase en de optionele passphrase. */
export interface Secret {
  mnemonic: string;
  passphrase: string;
}
