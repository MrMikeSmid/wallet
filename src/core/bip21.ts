// BIP21-URI's lezen en maken: bitcoin:<adres>?amount=0.001&label=…&message=…

import { formatBtc, parseBtc } from './format.ts';

export interface PaymentRequest {
  address: string;
  amount?: bigint; // sats
  label?: string;
  message?: string;
}

/** Leest een adres of een BIP21-URI. Geeft null als er geen adres in staat. */
export function parsePaymentUri(input: string): PaymentRequest | null {
  const raw = input.trim();
  if (!raw) return null;
  if (!/^bitcoin:/i.test(raw)) return { address: raw };

  const rest = raw.slice('bitcoin:'.length);
  const q = rest.indexOf('?');
  const address = decodeURIComponent(q === -1 ? rest : rest.slice(0, q)).trim();
  if (!address) return null;

  const req: PaymentRequest = { address };
  if (q !== -1) {
    const params = new URLSearchParams(rest.slice(q + 1));
    for (const [k, v] of params) {
      const key = k.toLowerCase();
      if (key === 'amount') {
        // BIP21 gebruikt altijd een punt; een komma of rare notatie keuren we af.
        if (!/^\d*\.?\d{0,8}$/.test(v) || v === '' || v === '.') return null;
        const sats = parseBtc(v);
        if (sats === null) return null;
        req.amount = sats;
      } else if (key === 'label') req.label = v;
      else if (key === 'message') req.message = v;
      else if (key.startsWith('req-')) return null; // onbekende verplichte parameter
    }
  }
  return req;
}

/** Maakt een BIP21-URI, bijvoorbeeld voor de QR-code bij ontvangen. */
export function makePaymentUri(address: string, amount?: bigint): string {
  if (!amount) return `bitcoin:${address}`;
  const btc = formatBtc(amount).replace(/\./g, '').replace(',', '.').replace(/\.?0+$/, '');
  return `bitcoin:${address}?amount=${btc}`;
}
