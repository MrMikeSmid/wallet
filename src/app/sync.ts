// Saldo en geschiedenis bijwerken via de ingestelde Esplora-server.

import { Esplora } from '../core/esplora.ts';
import { GAP_LIMIT, type ScanResult, scanWallet } from '../core/scan.ts';
import type { Chain, DerivedAddress } from '../core/wallet.ts';
import * as session from './session.ts';

let running: Promise<ScanResult> | null = null;
let progress = 0;

/** Aantal verzoeken dat de lopende scan al heeft gedaan. */
export function syncProgress(): number {
  return progress;
}
const listeners = new Set<(r: ScanResult | null, busy: boolean) => void>();

export function onSync(fn: (r: ScanResult | null, busy: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function api(): Promise<Esplora> {
  const s = await session.settings();
  return new Esplora(s.endpoints[s.net]);
}

export async function cached(): Promise<ScanResult | null> {
  const { net } = await session.settings();
  return session.state().cache[net] ?? null;
}

export function isSyncing(): boolean {
  return running !== null;
}

export async function sync(): Promise<ScanResult> {
  if (running) return running;
  const emit = (r: ScanResult | null, busy: boolean) => listeners.forEach((fn) => fn(r, busy));
  running = (async () => {
    emit(await cached(), true);
    const { net } = await session.settings();
    const book = await session.addressBook();
    progress = 0;
    const current = await cached();
    const result = await scanWallet(book, await api(), {
      onProgress: (n) => {
        progress = n;
        emit(current, true);
      },
    });
    if (session.isUnlocked()) {
      await session.saveState((s) => {
        s.cache[net] = result;
        s.receiveIndex[net] = Math.max(s.receiveIndex[net], result.lastUsed[0] + 1);
      });
    }
    return result;
  })();
  try {
    const r = await running;
    emit(r, false);
    return r;
  } catch (e) {
    emit(await cached().catch(() => null), false);
    throw e;
  } finally {
    running = null;
  }
}

/** Huidig ontvangstadres: het eerste ongebruikte vanaf de opgeslagen index. */
export async function receiveAddress(): Promise<DerivedAddress> {
  const { net } = await session.settings();
  const st = session.state();
  const book = await session.addressBook();
  const used = new Set(st.cache[net]?.used ?? []);
  let i = Math.max(st.receiveIndex[net], (st.cache[net]?.lastUsed[0] ?? -1) + 1);
  while (used.has(book.at(0, i).address)) i++;
  if (i !== st.receiveIndex[net]) await session.saveState((s) => (s.receiveIndex[net] = i));
  return book.at(0, i);
}

/** Volgende nieuw adres; blijft binnen de gap limit zodat herstellen alles terugvindt. */
export async function nextReceiveAddress(): Promise<DerivedAddress | null> {
  const { net } = await session.settings();
  const st = session.state();
  const lastUsed = st.cache[net]?.lastUsed[0] ?? -1;
  const next = st.receiveIndex[net] + 1;
  if (next > lastUsed + GAP_LIMIT) return null;
  await session.saveState((s) => (s.receiveIndex[net] = next));
  return receiveAddress();
}

/** Ongebruikt change-adres (BIP84 interne keten). */
export async function changeAddress(): Promise<DerivedAddress> {
  const { net } = await session.settings();
  const st = session.state();
  const book = await session.addressBook();
  return book.at(1, (st.cache[net]?.lastUsed[1] ?? -1) + 1);
}

/** Zoekt keten en index van een eigen adres (binnen de bekende reeks plus gap). */
export async function locateOwn(): Promise<(address: string | undefined) => { chain: Chain; index: number } | null> {
  const { net } = await session.settings();
  const st = session.state();
  const book = await session.addressBook();
  const map = new Map<string, { chain: Chain; index: number }>();
  for (const chain of [0, 1] as const) {
    const top = Math.max(st.cache[net]?.lastUsed[chain] ?? -1, chain === 0 ? st.receiveIndex[net] : -1) + GAP_LIMIT;
    for (let i = 0; i <= top; i++) map.set(book.at(chain, i).address, { chain, index: i });
  }
  return (a) => (a ? (map.get(a) ?? null) : null);
}
