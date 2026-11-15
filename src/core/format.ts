// Bedragen weergeven en invoeren. Intern rekenen we altijd in sats (bigint),
// nooit met zwevendekommagetallen.

export const SATS_PER_BTC = 100_000_000n;

/** Groepeert cijfers per drie met een punt (Nederlandse notatie). */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 123456n → "0,00123456" (altijd 8 decimalen). */
export function formatBtc(sats: bigint): string {
  const neg = sats < 0n;
  const abs = neg ? -sats : sats;
  const whole = abs / SATS_PER_BTC;
  const frac = (abs % SATS_PER_BTC).toString().padStart(8, '0');
  return `${neg ? '−' : ''}${group(whole.toString())},${frac}`;
}

/** 123456n → "123.456" */
export function formatSats(sats: bigint): string {
  const neg = sats < 0n;
  return `${neg ? '−' : ''}${group((neg ? -sats : sats).toString())}`;
}

/** Met plus- of minteken, voor de transactielijst. */
export function formatSigned(sats: bigint, unit: 'btc' | 'sats'): string {
  const sign = sats > 0n ? '+' : '';
  return sign + (unit === 'btc' ? formatBtc(sats) : formatSats(sats));
}

/**
 * Leest een BTC-bedrag zoals de gebruiker het typt ("0,001", "0.001", ".5").
 * Geeft sats terug of null bij een ongeldige invoer of meer dan 8 decimalen.
 */
export function parseBtc(input: string): bigint | null {
  const s = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^(\d+)?(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
  const [w = '', f = ''] = s.split('.');
  if (f.length > 8) return null;
  return BigInt(w || '0') * SATS_PER_BTC + BigInt((f + '00000000').slice(0, 8));
}

/** Leest een bedrag in sats ("12.345" of "12345"). */
export function parseSats(input: string): bigint | null {
  const s = input.trim().replace(/[\s.]/g, '');
  if (!/^\d+$/.test(s)) return null;
  return BigInt(s);
}

/** Leest een bedrag in de gekozen eenheid. */
export function parseAmount(input: string, unit: 'btc' | 'sats'): bigint | null {
  return unit === 'btc' ? parseBtc(input) : parseSats(input);
}

/** Kort adres voor in lijsten: bc1qxy…k3l9 */
export function shortAddress(address: string, keep = 8): string {
  return address.length <= keep * 2 + 1 ? address : `${address.slice(0, keep)}…${address.slice(-keep)}`;
}
