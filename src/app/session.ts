// De wallet op dit apparaat: aanmaken, ontgrendelen, vergrendelen, pincode,
// instellingen en de versleutelde walletstatus.

import { DEFAULT_ENDPOINTS } from '../core/esplora.ts';
import { delayAfter, shouldWipe } from '../core/lockout.ts';
import type { ScanResult } from '../core/scan.ts';
import { type Keys, type KdfParams, type Sealed, type Secret, deriveKeys, newKdfParams, openJson, sealJson } from '../core/vault.ts';
import { AddressBook, type Net, accountXpubs } from '../core/wallet.ts';
import { store } from './storage.ts';

export interface Meta {
  version: 1;
  kdf: KdfParams;
  failures: number;
  lockedUntil: number;
  wipeAfter10: boolean;
}

export interface WalletState {
  xpubs: Record<Net, string>;
  words: 12 | 24;
  hasPassphrase: boolean;
  /** Volgende receive-index die we tonen, per netwerk. */
  receiveIndex: Record<Net, number>;
  /** Labels per UTXO (txid:vout) en notities per transactie, alleen lokaal. */
  labels: Record<string, string>;
  notes: Record<string, string>;
  cache: Partial<Record<Net, ScanResult>>;
  createdAt: number;
}

export interface Settings {
  net: Net;
  endpoints: Record<Net, string>;
  unit: 'btc' | 'sats';
}

export const DEFAULT_SETTINGS: Settings = { net: 'main', endpoints: { ...DEFAULT_ENDPOINTS }, unit: 'btc' };

export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'wrong'; failures: number; waitMs: number }
  | { ok: false; reason: 'wait'; waitMs: number }
  | { ok: false; reason: 'wiped' };

interface Live {
  stateKey: CryptoKey;
  state: WalletState;
}

let live: Live | null = null;
let settingsCache: Settings | null = null;
const listeners = new Set<() => void>();

/** Wordt aangeroepen bij vergrendelen, zodat de UI het scherm kan wissen. */
export function onLock(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function hasWallet(): Promise<boolean> {
  return (await store.get<Meta>('meta')) !== null;
}

export function isUnlocked(): boolean {
  return live !== null;
}

export function state(): WalletState {
  if (!live) throw new Error('Wallet is vergrendeld');
  return live.state;
}

export async function getMeta(): Promise<Meta | null> {
  return store.get<Meta>('meta');
}

export async function settings(): Promise<Settings> {
  if (!settingsCache) {
    const s = await store.get<Partial<Settings>>('settings');
    settingsCache = { ...DEFAULT_SETTINGS, ...s, endpoints: { ...DEFAULT_SETTINGS.endpoints, ...s?.endpoints } };
  }
  return settingsCache;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await settings()), ...patch };
  settingsCache = next;
  await store.set('settings', next);
  return next;
}

/** Adresboek van het actieve netwerk. */
export async function addressBook(): Promise<AddressBook> {
  const { net } = await settings();
  return new AddressBook(state().xpubs[net], net);
}

export async function saveState(mutate?: (s: WalletState) => void): Promise<void> {
  if (!live) return;
  mutate?.(live.state);
  await store.set('state', await sealJson(live.stateKey, live.state));
}

/** Maakt de wallet aan: seed in de kluis, xpubs in de versleutelde status. */
export async function createWallet(secret: Secret, pin: string, words: 12 | 24): Promise<void> {
  const kdf = newKdfParams();
  const keys = await deriveKeys(pin, kdf);
  const st: WalletState = {
    xpubs: accountXpubs(secret.mnemonic, secret.passphrase),
    words,
    hasPassphrase: secret.passphrase !== '',
    receiveIndex: { main: 0, test: 0 },
    labels: {},
    notes: {},
    cache: {},
    createdAt: Date.now(),
  };
  await store.set('vault', await sealJson(keys.vaultKey, secret));
  await store.set('state', await sealJson(keys.stateKey, st));
  await store.set('meta', { version: 1, kdf, failures: 0, lockedUntil: 0, wipeAfter10: false } satisfies Meta);
  live = { stateKey: keys.stateKey, state: st };
}

/** Controleert de pincode met wachttijd en optioneel wissen; geeft de sleutels bij succes. */
async function checkPin(pin: string): Promise<{ keys: Keys; meta: Meta } | Exclude<UnlockResult, { ok: true }>> {
  const meta = await getMeta();
  if (!meta) return { ok: false, reason: 'wiped' };
  const now = Date.now();
  if (meta.lockedUntil > now) return { ok: false, reason: 'wait', waitMs: meta.lockedUntil - now };

  const keys = await deriveKeys(pin, meta.kdf);
  const box = await store.get<Sealed>('state');
  try {
    if (!box) throw new Error('geen status');
    const st = await openJson<WalletState>(keys.stateKey, box);
    if (meta.failures !== 0) await store.set('meta', { ...meta, failures: 0, lockedUntil: 0 });
    if (!live) live = { stateKey: keys.stateKey, state: st };
    return { keys, meta: { ...meta, failures: 0, lockedUntil: 0 } };
  } catch {
    const failures = meta.failures + 1;
    if (shouldWipe(failures, meta.wipeAfter10)) {
      await wipeWallet();
      return { ok: false, reason: 'wiped' };
    }
    const waitMs = delayAfter(failures);
    await store.set('meta', { ...meta, failures, lockedUntil: waitMs ? Date.now() + waitMs : 0 });
    return { ok: false, reason: 'wrong', failures, waitMs };
  }
}

export async function unlock(pin: string): Promise<UnlockResult> {
  const r = await checkPin(pin);
  return 'keys' in r ? { ok: true } : r;
}

/**
 * Ontsleutelt de seed alleen voor de duur van `fn` (versturen, seed bekijken,
 * ondertekenen). De vaultKey wordt daarna niet bewaard.
 */
export async function withSecret<T>(pin: string, fn: (secret: Secret) => T | Promise<T>): Promise<{ ok: true; value: T } | Exclude<UnlockResult, { ok: true }>> {
  const r = await checkPin(pin);
  if (!('keys' in r)) return r;
  const box = await store.get<Sealed>('vault');
  if (!box) return { ok: false, reason: 'wiped' };
  const secret = await openJson<Secret>(r.keys.vaultKey, box);
  try {
    return { ok: true, value: await fn(secret) };
  } finally {
    secret.mnemonic = '';
    secret.passphrase = '';
  }
}

export async function changePin(oldPin: string, newPin: string): Promise<UnlockResult> {
  const r = await withSecret(oldPin, async (secret) => {
    const kdf = newKdfParams();
    const keys = await deriveKeys(newPin, kdf);
    const st = state();
    await store.set('vault', await sealJson(keys.vaultKey, secret));
    await store.set('state', await sealJson(keys.stateKey, st));
    const meta = (await getMeta())!;
    await store.set('meta', { ...meta, kdf, failures: 0, lockedUntil: 0 });
    live = { stateKey: keys.stateKey, state: st };
  });
  return r.ok ? { ok: true } : r;
}

export async function setWipeAfter10(on: boolean): Promise<void> {
  const meta = await getMeta();
  if (meta) await store.set('meta', { ...meta, wipeAfter10: on });
}

export function lock(): void {
  if (!live) return;
  live = null;
  for (const fn of listeners) fn();
}

/** Verwijdert alles van dit apparaat. */
export async function wipeWallet(): Promise<void> {
  live = null;
  settingsCache = null;
  await store.clear();
  for (const fn of listeners) fn();
}
