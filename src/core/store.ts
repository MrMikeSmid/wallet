import type { Vault } from './vault.ts';
import type { Net } from './wallet.ts';
import { DEFAULT_SERVER } from './esplora.ts';

// Op het apparaat staat alleen: de versleutelde kluis en een paar instellingen. Geen adressen, saldo of geschiedenis.
export type Meta = { net: Net; server: string; issued: number; lockMinutes: number; fails: number; lockedUntil: number };
const K = { vault: 'wallet.vault', meta: 'wallet.meta' };

function get<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function set(k: string, v: unknown) {
  localStorage.setItem(k, JSON.stringify(v));
}
export const loadVault = () => get<Vault>(K.vault);
export const saveVault = (v: Vault) => set(K.vault, v);
export function defaultMeta(net: Net = 'main'): Meta {
  return { net, server: DEFAULT_SERVER[net], issued: 0, lockMinutes: 5, fails: 0, lockedUntil: 0 };
}
export const loadMeta = (): Meta => ({ ...defaultMeta(), ...(get<Meta>(K.meta) ?? {}) });
export const saveMeta = (m: Meta) => set(K.meta, m);
export function wipe() {
  localStorage.removeItem(K.vault);
  localStorage.removeItem(K.meta);
}
/** Oplopende wachttijd na verkeerde wachtwoorden: vanaf de 3e poging 30s, 60s, 120s ... max 1 uur. */
export function lockoutMs(fails: number): number {
  return fails < 3 ? 0 : Math.min(3600_000, 30_000 * 2 ** (fails - 3));
}
