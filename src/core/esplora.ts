// Client voor de Esplora-API (mempool.space, blockstream.info of een eigen server).
// We sturen alleen adressen en transacties; geen cookies, geen referrer.

import type { Net } from './wallet.ts';

export const DEFAULT_ENDPOINTS: Record<Net, string> = {
  main: 'https://mempool.space/api',
  test: 'https://mempool.space/testnet4/api',
};

export interface EsploraStats {
  funded_txo_sum: number;
  spent_txo_sum: number;
  tx_count: number;
}

export interface EsploraAddress {
  address: string;
  chain_stats: EsploraStats;
  mempool_stats: EsploraStats;
}

export interface EsploraVin {
  txid: string;
  vout: number;
  sequence: number;
  prevout: { scriptpubkey: string; scriptpubkey_address?: string; value: number } | null;
  is_coinbase?: boolean;
}

export interface EsploraVout {
  scriptpubkey: string;
  scriptpubkey_address?: string;
  value: number;
}

export interface EsploraTx {
  txid: string;
  version: number;
  locktime: number;
  vin: EsploraVin[];
  vout: EsploraVout[];
  weight: number;
  fee: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

export interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number };
}

export type FeeEstimates = Record<string, number>;

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class EsploraError extends Error {}

/** Haalt de schema+host uit een endpoint, voor de privacy-uitleg en de CSP-controle. */
export function endpointOrigin(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1' ? u.origin : null;
  } catch {
    return null;
  }
}

export interface RetryOptions {
  /** Aantal extra pogingen na een 429 of een netwerkfout (alleen bij GET). */
  retries: number;
  /** Eerste wachttijd in ms; verdubbelt per poging. */
  baseMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_RETRY: RetryOptions = {
  retries: 5,
  baseMs: 2_000,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const RATE_LIMITED =
  'De server beperkt het aantal verzoeken. Wacht een minuut en probeer het opnieuw, of stel een eigen server in.';

/** Leesbare foutmelding uit een foutantwoord (geen HTML-pagina tonen). */
function errorText(status: number, body: string): string {
  if (status === 429) return RATE_LIMITED;
  const t = body.trim();
  if (!t || t.startsWith('<') || t.length > 300) return `De server gaf een fout (${status}).`;
  return t;
}

export class Esplora {
  readonly base: string;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;
  private readonly retry: RetryOptions;

  constructor(base: string, fetchFn: FetchFn = (i, init) => fetch(i, init), timeoutMs = 20_000, retry: RetryOptions = DEFAULT_RETRY) {
    this.base = base.replace(/\/+$/, '');
    this.fetchFn = fetchFn;
    this.timeoutMs = timeoutMs;
    this.retry = retry;
  }

  private async once(path: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(this.base + path, {
        ...init,
        signal: ctrl.signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        mode: 'cors',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Eén verzoek, met nieuwe pogingen bij een 429 of een netwerkfout. Openbare
   * servers zoals mempool.space sturen bij te veel verzoeken een 429 zonder
   * CORS-header; de browser meldt dat als netwerkfout. Daarom wachten we dan
   * oplopend (2, 4, 8 … s) en proberen we het opnieuw.
   */
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const canRetry = (init.method ?? 'GET') === 'GET';
    let rateLimited = false;
    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      try {
        res = await this.once(path, init);
      } catch {
        res = null;
      }
      if (res?.ok) return res;
      const retryable = res === null || res.status === 429 || res.status >= 500;
      if (res?.status === 429) rateLimited = true;
      if (canRetry && retryable && attempt < this.retry.retries) {
        await this.retry.sleep(this.retry.baseMs * 2 ** attempt);
        continue;
      }
      if (res) throw new EsploraError(errorText(res.status, await res.text().catch(() => '')));
      throw new EsploraError(
        rateLimited
          ? RATE_LIMITED
          : 'De server is niet bereikbaar of beperkt het aantal verzoeken. Controleer je verbinding, wacht een minuut en probeer het opnieuw.',
      );
    }
  }

  private async json<T>(path: string): Promise<T> {
    return (await this.request(path)).json() as Promise<T>;
  }

  address(addr: string): Promise<EsploraAddress> {
    return this.json(`/address/${encodeURIComponent(addr)}`);
  }

  /** Alle transacties van een adres (mempool + bevestigd, met paginering). */
  async addressTxs(addr: string, max = 500): Promise<EsploraTx[]> {
    const a = encodeURIComponent(addr);
    const all: EsploraTx[] = await this.json(`/address/${a}/txs`);
    let confirmed = all.filter((t) => t.status.confirmed);
    // De eerste pagina bevat maximaal 25 bevestigde transacties.
    while (confirmed.length > 0 && confirmed.length % 25 === 0 && all.length < max) {
      const last = confirmed[confirmed.length - 1]!.txid;
      const page: EsploraTx[] = await this.json(`/address/${a}/txs/chain/${last}`);
      if (page.length === 0) break;
      all.push(...page);
      confirmed = page;
      if (page.length < 25) break;
    }
    return all;
  }

  utxos(addr: string): Promise<EsploraUtxo[]> {
    return this.json(`/address/${encodeURIComponent(addr)}/utxo`);
  }

  tx(txid: string): Promise<EsploraTx> {
    return this.json(`/tx/${encodeURIComponent(txid)}`);
  }

  feeEstimates(): Promise<FeeEstimates> {
    return this.json('/fee-estimates');
  }

  async tipHeight(): Promise<number> {
    return Number(await (await this.request('/blocks/tip/height')).text());
  }

  /** Verstuurt een ondertekende transactie; geeft de txid terug. */
  async broadcast(hex: string): Promise<string> {
    const res = await this.request('/tx', { method: 'POST', body: hex, headers: { 'Content-Type': 'text/plain' } });
    return (await res.text()).trim();
  }
}
