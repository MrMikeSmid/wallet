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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Esplora-client met reserve-servers. Bij een netwerkfout, 429 of 5xx wordt het één keer opnieuw geprobeerd
 * en daarna de volgende server. Een server die werkt, blijft de eerste keus.
 */
export class Esplora {
  bases: string[];
  constructor(base: string | string[]) {
    this.bases = (Array.isArray(base) ? base : [base]).map((b) => b.replace(/\/+$/, ''));
  }
  get base() { return this.bases[0]; }
  private async request(path: string, init?: RequestInit): Promise<Response> {
    let last: unknown;
    for (let i = 0; i < this.bases.length; i++) {
      const base = this.bases[i];
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetch(base + path, { referrerPolicy: 'no-referrer', credentials: 'omit', cache: 'no-store', ...init });
          if (r.status === 429 || r.status >= 500) throw new Error(`${new URL(base).host} gaf ${r.status}`);
          if (i > 0) this.bases = [base, ...this.bases.filter((b) => b !== base)];
          return r;
        } catch (e) {
          last = e;
          if (attempt === 0) await wait(800);
        }
      }
    }
    const hosts = this.bases.map((b) => new URL(b).host).join(', ');
    throw new Error(`Server niet bereikbaar (${hosts}). ${last instanceof Error && !/fetch/i.test(last.message) ? last.message : 'Controleer je verbinding, adblocker of privé-DNS.'}`);
  }
  private async get<T>(path: string, text = false): Promise<T> {
    const r = await this.request(path);
    if (!r.ok) throw new Error(`Server gaf ${r.status} op ${path}`);
    return (text ? r.text() : r.json()) as Promise<T>;
  }
  address(a: string) { return this.get<AddrInfo>(`/address/${a}`); }
  utxos(a: string) { return this.get<Utxo[]>(`/address/${a}/utxo`); }
  txs(a: string) { return this.get<Tx[]>(`/address/${a}/txs`); }
  tipHeight() { return this.get<string>('/blocks/tip/height', true).then(Number); }
  fees() { return this.get<Record<string, number>>('/fee-estimates'); }
  async broadcast(hex: string): Promise<string> {
    const r = await this.request('/tx', { method: 'POST', body: hex });
    const t = await r.text();
    if (!r.ok) throw new Error('Versturen geweigerd: ' + t);
    return t.trim();
  }
}

export const DEFAULT_SERVER = { main: 'https://mempool.space/api', test: 'https://mempool.space/testnet4/api' } as const;
/** Reserve als de standaardserver faalt (alleen gebruikt zolang de standaardserver is ingesteld). */
export const FALLBACK_SERVERS = { main: ['https://blockstream.info/api'], test: [] as string[] } as const;
export function serversFor(net: 'main' | 'test', server: string): string[] {
  return server.replace(/\/+$/, '') === DEFAULT_SERVER[net] ? [DEFAULT_SERVER[net], ...FALLBACK_SERVERS[net]] : [server];
}
