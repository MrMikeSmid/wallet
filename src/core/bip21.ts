import { Address } from '@scure/btc-signer';
import { formatBtc, parseBtc } from './units.ts';
import { network, type Net } from './wallet.ts';

export function isAddress(a: string, net: Net): boolean {
  try { Address(network(net)).decode(a); return true; } catch { return false; }
}
export function makeUri(address: string, amount?: bigint, label?: string): string {
  const q: string[] = [];
  if (amount && amount > 0n) q.push('amount=' + formatBtc(amount));
  if (label) q.push('label=' + encodeURIComponent(label));
  return 'bitcoin:' + address + (q.length ? '?' + q.join('&') : '');
}
export function parseUri(input: string): { address: string; amount?: bigint; label?: string } {
  const s = input.trim();
  if (!/^bitcoin:/i.test(s)) return { address: s };
  const [addr, query = ''] = s.slice(8).split('?');
  const p = new URLSearchParams(query);
  const amt = p.get('amount');
  return { address: addr, amount: amt ? parseBtc(amt) : undefined, label: p.get('label') ?? undefined };
}
