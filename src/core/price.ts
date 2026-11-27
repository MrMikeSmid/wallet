// Koers BTC-EUR via de openbare API van Bitvavo (geen sleutel, geen account).
const API = 'https://api.bitvavo.com/v2';
export type Range = 6 | 12 | 24;
export type Point = { t: number; p: number };

const opts: RequestInit = { referrerPolicy: 'no-referrer', credentials: 'omit', cache: 'no-store' };

export async function fetchPrice(): Promise<number> {
  const r = await fetch(`${API}/ticker/price?market=BTC-EUR`, opts);
  if (!r.ok) throw new Error(`Bitvavo gaf ${r.status}`);
  const j = (await r.json()) as { price: string };
  const p = Number(j.price);
  if (!(p > 0)) throw new Error('Ongeldige koers');
  return p;
}

/** Slotkoersen over de laatste 6, 12 of 24 uur, oud → nieuw. */
export async function fetchHistory(hours: Range): Promise<Point[]> {
  const interval = hours === 24 ? '15m' : '5m';
  const step = hours === 24 ? 15 : 5;
  const end = Date.now();
  const start = end - hours * 3600_000;
  const limit = Math.ceil((hours * 60) / step) + 1;
  const r = await fetch(`${API}/BTC-EUR/candles?interval=${interval}&start=${start}&end=${end}&limit=${limit}`, opts);
  if (!r.ok) throw new Error(`Bitvavo gaf ${r.status}`);
  const rows = (await r.json()) as [number, string, string, string, string, string][];
  return rows.map((c) => ({ t: c[0], p: Number(c[4]) })).filter((x) => x.p > 0).sort((a, b) => a.t - b.t);
}

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const formatEur = (v: number, whole = false) => (whole ? eur0 : eur).format(v);
/** Waarde in euro van een aantal sats. */
export const satsToEur = (sats: number, price: number) => (sats / 1e8) * price;
