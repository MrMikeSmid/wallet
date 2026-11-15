// Opslag op het apparaat. In de browser (PWA) IndexedDB, in de Capacitor-app de
// Keychain (iOS) of Keystore (Android) via een Secure Storage-plugin.
// Er gaat nooit iets naar localStorage, behalve de themakeuze (geen gevoelige data).

import { Capacitor } from '@capacitor/core';

export interface Kv {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

const DB = 'wallet';
const STORE = 'kv';

class IndexedDbKv implements Kv {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async get<T>(key: string): Promise<T | null> {
    return ((await this.run<T | undefined>('readonly', (s) => s.get(key))) ?? null) as T | null;
  }

  async set(key: string, value: unknown): Promise<void> {
    // Via JSON zodat er nooit per ongeluk een levend object (CryptoKey e.d.) wordt opgeslagen.
    await this.run('readwrite', (s) => s.put(JSON.parse(JSON.stringify(value)), key));
  }

  async remove(key: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(key));
  }

  async clear(): Promise<void> {
    await this.run('readwrite', (s) => s.clear());
  }
}

class NativeKv implements Kv {
  private plugin = import('@aparajita/capacitor-secure-storage').then(async (m) => {
    // Niet synchroniseren met iCloud-sleutelhanger en alleen op dit toestel.
    await m.SecureStorage.setSynchronize(false);
    await m.SecureStorage.setDefaultKeychainAccess(m.KeychainAccess.whenUnlockedThisDeviceOnly);
    await m.SecureStorage.setKeyPrefix('wallet_');
    return m.SecureStorage;
  });

  async get<T>(key: string): Promise<T | null> {
    const v = await (await this.plugin).get(key);
    return v === null ? null : (JSON.parse(String(v)) as T);
  }

  async set(key: string, value: unknown): Promise<void> {
    await (await this.plugin).set(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    await (await this.plugin).remove(key);
  }

  async clear(): Promise<void> {
    await (await this.plugin).clear();
  }
}

export const isNative = (): boolean => Capacitor.isNativePlatform();

export const store: Kv = isNative() ? new NativeKv() : new IndexedDbKv();

/** Screenshots blokkeren (Android FLAG_SECURE, iOS afgeschermd in de app-switcher). */
export async function privacyScreen(on: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    const { PrivacyScreen } = await import('@capacitor-community/privacy-screen');
    await (on ? PrivacyScreen.enable() : PrivacyScreen.disable());
  } catch {
    // Plugin niet beschikbaar: geen blokkade mogelijk, de app blijft werken.
  }
}
