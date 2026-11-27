import type { Esplora, Tx } from './esplora.ts';
import type { Coin } from './send.ts';
import type { Account } from './wallet.ts';

export const GAP = 20;
export type AddrState = { chain: 0 | 1; index: number; address: string; used: boolean; label?: string };
export type HistoryItem = { txid: string; delta: number; fee: number; confirmed: boolean; height?: number; time?: number };
export type Snapshot = {
  addresses: AddrState[];
  coins: Coin[];
  history: HistoryItem[];
  next: { 0: number; 1: number };
  confirmed: number;
  pending: number;
  updated: number;
};

/** Scant ontvang- (0) en wisseladressen (1) tot GAP ongebruikte adressen achter elkaar. */
export async function scan(acc: Account, api: Esplora, extraReceive = 0, onProgress?: (n: number) => void): Promise<Snapshot> {
  const addresses: AddrState[] = [];
  const coins: Coin[] = [];
  const txs = new Map<string, Tx>();
  const next = { 0: 0, 1: 0 };
  let checked = 0;
  for (const chain of [0, 1] as const) {
    let gap = 0;
    for (let index = 0; gap < GAP || (chain === 0 && index < extraReceive); index++) {
      const address = acc.address(chain, index);
      const info = await api.address(address);
      onProgress?.(++checked);
      const used = info.chain_stats.tx_count + info.mempool_stats.tx_count > 0;
      addresses.push({ chain, index, address, used });
      if (!used) { gap++; continue; }
      gap = 0;
      next[chain] = index + 1;
      const [u, t] = await Promise.all([api.utxos(address), api.txs(address)]);
      for (const x of u) coins.push({ txid: x.txid, vout: x.vout, value: x.value, chain, index, confirmed: x.status.confirmed });
      for (const x of t) txs.set(x.txid, x);
    }
  }
  const mine = new Set(addresses.filter((a) => a.used).map((a) => a.address));
  const history: HistoryItem[] = [...txs.values()].map((t) => {
    const out = t.vin.reduce((s, i) => s + (i.prevout?.scriptpubkey_address && mine.has(i.prevout.scriptpubkey_address) ? i.prevout.value : 0), 0);
    const inc = t.vout.reduce((s, o) => s + (o.scriptpubkey_address && mine.has(o.scriptpubkey_address) ? o.value : 0), 0);
    return { txid: t.txid, delta: inc - out, fee: t.fee, confirmed: t.status.confirmed, height: t.status.block_height, time: t.status.block_time };
  });
  history.sort((a, b) => (a.confirmed === b.confirmed ? (b.height ?? 0) - (a.height ?? 0) : a.confirmed ? 1 : -1));
  const confirmed = coins.filter((c) => c.confirmed).reduce((s, c) => s + c.value, 0);
  const pending = coins.filter((c) => !c.confirmed).reduce((s, c) => s + c.value, 0);
  return { addresses, coins, history, next, confirmed, pending, updated: Date.now() };
}
