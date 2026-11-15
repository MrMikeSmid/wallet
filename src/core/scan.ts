// Wallet scannen: receive- en change-keten met gap limit 20, saldo, UTXO's en
// transactiegeschiedenis. Verzoeken gaan één voor één, in willekeurige volgorde
// en met een willekeurige pauze, zodat de server niet in één keer alle adressen ziet.

import type { Esplora, EsploraTx } from './esplora.ts';
import type { AddressBook, Chain } from './wallet.ts';

export const GAP_LIMIT = 20;

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
  address: string;
  chain: Chain;
  index: number;
}

export interface TxSummary {
  txid: string;
  /** Verandering van het saldo in sats (inclusief fee bij uitgaand). */
  net: number;
  fee: number;
  confirmed: boolean;
  height?: number;
  time?: number;
  /** Uitgaand, onbevestigd, alle inputs van ons en RBF aangezet: kan versneld worden. */
  bumpable: boolean;
  /** Ontvanger(s) die niet van ons zijn (bij uitgaand). */
  counterparties: string[];
  vsize: number;
}

export interface ScanResult {
  scannedAt: number;
  /** Hoogste gebruikte index per keten (-1 = nog niets). */
  lastUsed: Record<Chain, number>;
  confirmed: number;
  unconfirmed: number;
  utxos: Utxo[];
  txs: TxSummary[];
  /** Alle adressen die we tijdens het scannen hebben gezien en die gebruikt zijn. */
  used: string[];
}

export interface ScanOptions {
  gap?: number;
  /** Pauze tussen verzoeken; in tests 0. */
  pause?: () => Promise<void>;
  /** Willekeurige volgorde; in tests deterministisch te maken. */
  shuffle?: <T>(items: T[]) => T[];
  onProgress?: (done: number) => void;
}

export function randomPause(minMs = 80, maxMs = 350): () => Promise<void> {
  return () => {
    const r = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
    return new Promise((res) => setTimeout(res, minMs + r * (maxMs - minMs)));
  };
}

export function cryptoShuffle<T>(items: T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Netto bedrag, fee en tegenpartijen van een transactie vanuit onze wallet bekeken. */
export function summarizeTx(tx: EsploraTx, own: (address: string | undefined) => boolean): TxSummary {
  let received = 0;
  let sent = 0;
  let allOursIn = tx.vin.length > 0;
  let rbf = false;
  for (const vin of tx.vin) {
    if (vin.prevout && own(vin.prevout.scriptpubkey_address)) sent += vin.prevout.value;
    else allOursIn = false;
    if (vin.sequence < 0xfffffffe) rbf = true;
  }
  const counterparties: string[] = [];
  for (const vout of tx.vout) {
    if (own(vout.scriptpubkey_address)) received += vout.value;
    else if (vout.scriptpubkey_address) counterparties.push(vout.scriptpubkey_address);
  }
  const net = received - sent;
  return {
    txid: tx.txid,
    net,
    fee: tx.fee,
    confirmed: tx.status.confirmed,
    ...(tx.status.block_height !== undefined ? { height: tx.status.block_height } : {}),
    ...(tx.status.block_time !== undefined ? { time: tx.status.block_time } : {}),
    bumpable: !tx.status.confirmed && sent > 0 && allOursIn && rbf,
    counterparties: sent > 0 ? counterparties : [],
    vsize: Math.ceil(tx.weight / 4),
  };
}

/** Sorteert: onbevestigd bovenaan, daarna nieuwste blok eerst. */
export function sortTxs(txs: TxSummary[]): TxSummary[] {
  return txs.slice().sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1;
    return (b.height ?? 0) - (a.height ?? 0) || (b.time ?? 0) - (a.time ?? 0);
  });
}

export async function scanWallet(book: AddressBook, api: Esplora, opts: ScanOptions = {}): Promise<ScanResult> {
  const gap = opts.gap ?? GAP_LIMIT;
  const pause = opts.pause ?? randomPause();
  const shuffle = opts.shuffle ?? cryptoShuffle;
  let done = 0;

  let confirmed = 0;
  let unconfirmed = 0;
  const lastUsed: Record<Chain, number> = { 0: -1, 1: -1 };
  const usedAddrs: { address: string; chain: Chain; index: number }[] = [];

  // 1. Ketens doorlopen tot er `gap` ongebruikte adressen op rij zijn.
  for (const chain of [0, 1] as const) {
    let next = 0;
    while (next - 1 - lastUsed[chain] < gap) {
      const end = lastUsed[chain] + gap; // inclusief
      const batch: number[] = [];
      for (let i = next; i <= end; i++) batch.push(i);
      next = end + 1;
      for (const index of shuffle(batch)) {
        const { address } = book.at(chain, index);
        const info = await api.address(address);
        done++;
        opts.onProgress?.(done);
        const count = info.chain_stats.tx_count + info.mempool_stats.tx_count;
        if (count > 0) {
          lastUsed[chain] = Math.max(lastUsed[chain], index);
          usedAddrs.push({ address, chain, index });
          confirmed += info.chain_stats.funded_txo_sum - info.chain_stats.spent_txo_sum;
          unconfirmed += info.mempool_stats.funded_txo_sum - info.mempool_stats.spent_txo_sum;
        }
        await pause();
      }
    }
  }

  // 2. Transacties en UTXO's van de gebruikte adressen ophalen.
  const ownSet = new Set(usedAddrs.map((u) => u.address));
  // Ook adressen binnen de gap tellen als eigen (bijvoorbeeld wisselgeld in de mempool).
  for (const chain of [0, 1] as const) {
    for (let i = 0; i <= lastUsed[chain] + gap; i++) ownSet.add(book.at(chain, i).address);
  }
  const own = (a: string | undefined) => a !== undefined && ownSet.has(a);

  const txMap = new Map<string, EsploraTx>();
  const utxos: Utxo[] = [];
  for (const u of shuffle(usedAddrs)) {
    for (const tx of await api.addressTxs(u.address)) txMap.set(tx.txid, tx);
    await pause();
    for (const x of await api.utxos(u.address)) {
      utxos.push({ txid: x.txid, vout: x.vout, value: x.value, confirmed: x.status.confirmed, ...u });
    }
    await pause();
    done += 2;
    opts.onProgress?.(done);
  }

  const txs = sortTxs([...txMap.values()].map((t) => summarizeTx(t, own)));
  return {
    scannedAt: Date.now(),
    lastUsed,
    confirmed,
    unconfirmed,
    utxos: utxos.sort((a, b) => b.value - a.value),
    txs,
    used: usedAddrs.map((u) => u.address),
  };
}
