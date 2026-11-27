// Versleutelde opslag van de seed: PBKDF2-SHA256 (600.000 rondes) + AES-256-GCM via WebCrypto.
export type Vault = { v: 1; salt: string; iv: string; data: string; iter: number };
export type Secret = { mnemonic: string; passphrase: string };

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function seal(secret: Secret, password: string, iter = 600_000): Promise<Vault> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(secret))));
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(ct), iter };
}

export async function open(vault: Vault, password: string): Promise<Secret> {
  const key = await deriveKey(password, unb64(vault.salt), vault.iter);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) as BufferSource }, key, unb64(vault.data) as BufferSource);
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new Error('Onjuist wachtwoord');
  }
}
