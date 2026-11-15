// Scherm 6: Ontvangen — QR-code, adres, kopiëren en een nieuw adres.

import * as session from '../../app/session.ts';
import { nextReceiveAddress, receiveAddress } from '../../app/sync.ts';
import { makePaymentUri } from '../../core/bip21.ts';
import { parseAmount } from '../../core/format.ts';
import { $, copyText, html, setHtml, toast } from '../dom.ts';
import { header, route } from '../app.ts';
import { icon } from '../icons.ts';
import { qrSvg } from '../widgets.ts';

/** Adres in blokjes van 4, met begin en eind benadrukt (makkelijker te controleren). */
function chunked(address: string) {
  const parts = address.match(/.{1,4}/g) ?? [address];
  return html`${parts.map((p, i) => (i === 0 || i === parts.length - 1 ? html`<b>${p}</b> ` : html`${p} `))}`;
}

route('/ontvangen', {
  shell: 'app',
  nav: 'receive',
  async render(root) {
    const { net, unit } = await session.settings();
    let addr = await receiveAddress();
    let amount: bigint | undefined;
    setHtml(
      root,
      html`${header('Ontvangen', net === 'test' ? 'Alleen testnet-bitcoin naar dit adres sturen.' : 'Deel dit adres met de verzender of het platform.')}
        <section class="card card-flow">
          <div class="qr" id="qr"></div>
          <div class="address-box" id="addr" aria-label="Ontvangstadres"></div>
          <div class="actions">
            <button class="btn btn-primary grow" id="copy">${icon('copy')}Kopiëren</button>
            <button class="btn btn-secondary" id="new">${icon('refresh')}Nieuw adres</button>
          </div>
          <details>
            <summary>Bedrag vragen (optioneel)</summary>
            <label>Bedrag in ${unit === 'btc' ? 'BTC' : 'sats'}
              <input id="amount" inputmode="decimal" autocomplete="off" placeholder="${unit === 'btc' ? 'Bijvoorbeeld: 0,001' : 'Bijvoorbeeld: 100000'}">
            </label>
            <span class="hint">Het bedrag komt in de QR-code (BIP21). De verzender kan het nog aanpassen.</span>
          </details>
        </section>
        <div class="alert spaced">${icon('shield')}<span>Voor elke ontvangst een nieuw adres is beter voor je privacy. Een gebruikt adres tonen we niet opnieuw.</span></div>`,
    );
    const draw = () => {
      setHtml($('#qr', root), qrSvg(makePaymentUri(addr.address, amount)));
      setHtml($('#addr', root), chunked(addr.address));
    };
    draw();
    $('#copy', root).onclick = () => copyText(addr.address, 'Adres gekopieerd');
    $('#new', root).onclick = async () => {
      const next = await nextReceiveAddress();
      if (!next) return toast('Je hebt al 20 ongebruikte adressen. Gebruik eerst een daarvan.', 'err');
      addr = next;
      draw();
      toast('Nieuw adres gemaakt.');
    };
    const amt = $<HTMLInputElement>('#amount', root);
    amt.oninput = () => {
      const v = amt.value.trim() ? parseAmount(amt.value, unit) : null;
      amount = v && v > 0n ? v : undefined;
      amt.setCustomValidity(amt.value.trim() && v === null ? 'Ongeldig bedrag' : '');
      draw();
    };
  },
});
