// Minimale Esplora-client (mempool.space-compatibel). Er wordt geen account of sleutel verstuurd, alleen adressen.
export type Utxo = { txid: string; vout: number; value: number; status: { confirmed: boolean; block_height?: number } };
export type Tx = {
  txid: string;
  fee: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
  vin: { prevout: { scriptpubkey_address?: string; value: number } | null }[];
  vout: { scriptpubkey_address?: string; value: number }[];
};
export type AddrInfo = {
  chain_stats: { tx_count: number; funded_txo_sum: number; spent_txo_sum: number };
  mempool_stats: { tx_count: number; funded_txo_sum: number; spent_txo_sum: number };
};

export class Esplora {
  constructor(public base: string) { this.base = base.replace(/\/+$/, ''); }
  private async get<T>(path: string, text = false): Promise<T> {
    const r = await fetch(this.base + path, { referrerPolicy: 'no-referrer', credentials: 'omit', cache: 'no-store' });
    if (!r.ok) throw new Error(`Server gaf ${r.status} op ${path}`);
    return (text ? r.text() : r.json()) as Promise<T>;
  }
  address(a: string) { return this.get<AddrInfo>(`/address/${a}`); }
  utxos(a: string) { return this.get<Utxo[]>(`/address/${a}/utxo`); }
  txs(a: string) { return this.get<Tx[]>(`/address/${a}/txs`); }
  tipHeight() { return this.get<string>('/blocks/tip/height', true).then(Number); }
  fees() { return this.get<Record<string, number>>('/fee-estimates'); }
  async broadcast(hex: string): Promise<string> {
    const r = await fetch(this.base + '/tx', { method: 'POST', body: hex, referrerPolicy: 'no-referrer', credentials: 'omit' });
    const t = await r.text();
    if (!r.ok) throw new Error('Versturen geweigerd: ' + t);
    return t.trim();
  }
}

export const DEFAULT_SERVER = { main: 'https://mempool.space/api', test: 'https://mempool.space/testnet4/api' } as const;
