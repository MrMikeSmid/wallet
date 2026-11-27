export const SAT = 100_000_000n;

/** "0.0012" → 120000n. Max 8 decimalen. */
export function parseBtc(s: string): bigint {
  const t = s.trim().replace(',', '.');
  if (!/^\d+(\.\d{0,8})?$/.test(t) && !/^\.\d{1,8}$/.test(t)) throw new Error('Ongeldig bedrag');
  const [i, f = ''] = t.split('.');
  return BigInt(i || '0') * SAT + BigInt((f + '00000000').slice(0, 8));
}
export function formatBtc(sats: bigint | number): string {
  const v = BigInt(sats);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const f = (a % SAT).toString().padStart(8, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + (a / SAT).toString() + (f ? '.' + f : '');
}
export function formatSats(sats: bigint | number): string {
  return BigInt(sats).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
