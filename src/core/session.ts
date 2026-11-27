// Ontgrendeld blijven na een refresh, zonder de seed leesbaar op te slaan.
// - Een AES-256-GCM-sleutel die niet te exporteren is (extractable: false), bewaard in IndexedDB.
// - De versleutelde seed staat in sessionStorage: weg zodra de tab sluit.
// - Een vervaltijd die bij elke activiteit opschuift (de auto-vergrendeltijd uit Instellingen).
import type { Secret } from './vault.ts';

const DB = 'wallet', STORE = 'keys', KEY_ID = 'session';
const S_DATA = 'wallet.session', S_EXP = 'wallet.session.exp';
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { req.result.close(); resolve(r.result as T); };
      tx.onerror = () => { req.result.close(); reject(tx.error); };
    };
  });
}

async function sessionKey(create: boolean): Promise<CryptoKey | null> {
  const k = await idb<CryptoKey | undefined>('readonly', (s) => s.get(KEY_ID));
  if (k || !create) return k ?? null;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await idb('readwrite', (s) => s.put(key, KEY_ID));
  return key;
}

export async function saveSession(secret: Secret, minutes: number): Promise<void> {
  try {
    const key = (await sessionKey(true))!;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(secret))));
    sessionStorage.setItem(S_DATA, JSON.stringify({ iv: b64(iv), data: b64(ct) }));
    extendSession(minutes);
  } catch { /* geen opslag: dan gewoon opnieuw inloggen na refresh */ }
}

export function extendSession(minutes: number): void {
  try { if (sessionStorage.getItem(S_DATA)) sessionStorage.setItem(S_EXP, String(Date.now() + minutes * 60_000)); } catch { /* */ }
}

export async function loadSession(): Promise<Secret | null> {
  try {
    const raw = sessionStorage.getItem(S_DATA);
    const exp = Number(sessionStorage.getItem(S_EXP));
    if (!raw || !(exp > Date.now())) { await clearSession(); return null; }
    const key = await sessionKey(false);
    if (!key) { await clearSession(); return null; }
    const { iv, data } = JSON.parse(raw);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) as BufferSource }, key, unb64(data) as BufferSource);
    return JSON.parse(new TextDecoder().decode(pt)) as Secret;
  } catch {
    await clearSession();
    return null;
  }
}

/** Sessie beëindigen: versleutelde data weg én de sleutel vernietigen. */
export async function clearSession(): Promise<void> {
  try { sessionStorage.removeItem(S_DATA); sessionStorage.removeItem(S_EXP); } catch { /* */ }
  try { await idb('readwrite', (s) => s.delete(KEY_ID)); } catch { /* */ }
}
