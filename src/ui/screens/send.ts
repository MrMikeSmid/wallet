// Scherm 7: Versturen — adres/QR, bedrag, fee, coin control → overzicht → pincode → verzonden.

import * as session from '../../app/session.ts';
import { api, cached, changeAddress, sync } from '../../app/sync.ts';
import { parsePaymentUri } from '../../core/bip21.ts';
import { formatBtc, formatSats, parseAmount, shortAddress } from '../../core/format.ts';
import type { Utxo } from '../../core/scan.ts';
import { type Draft, TxError, buildSend, feeLevels, signDraft, spendable, utxoKey } from '../../core/tx.ts';
import { accountKey, isValidAddress } from '../../core/wallet.ts';
import { $, $$, copyText, html, setHtml, toast } from '../dom.ts';
import { header, route } from '../app.ts';
import { icon } from '../icons.ts';
import { askPin, scanQr } from '../widgets.ts';
import { money } from './home.ts';

type FeeChoice = 'low' | 'normal' | 'high' | 'custom';

interface Form {
  to: string;
  amount: string;
  unit: 'btc' | 'sats';
  max: boolean;
  fee: FeeChoice;
  customRate: string;
  selected: Set<string>;
  label?: string;
}

let form: Form | null = null;

route('/versturen', {
  shell: 'app',
  nav: 'send',
  async render(root) {
    const settings = await session.settings();
    const { net } = settings;
    form ??= { to: '', amount: '', unit: settings.unit, max: false, fee: 'normal', customRate: '', selected: new Set() };
    const f = form;
    let levels: { low: number; normal: number; high: number } | null = null;
    let utxos: Utxo[] = spendable((await cached())?.utxos ?? []);

    const rate = (): number => {
      if (f.fee === 'custom') return Number(f.customRate.replace(',', '.'));
      return levels ? levels[f.fee] : NaN;
    };

    const drawForm = (error = '') => {
      const st = session.state();
      const total = utxos.reduce((a, u) => a + u.value, 0);
      const chosen = f.selected.size ? utxos.filter((u) => f.selected.has(utxoKey(u))) : utxos;
      const available = chosen.reduce((a, u) => a + u.value, 0);
      setHtml(
        root,
        html`${header('Versturen', `Beschikbaar: ${f.unit === 'btc' ? formatBtc(BigInt(available)) + ' BTC' : formatSats(BigInt(available)) + ' sats'}`)}
          <form class="card card-flow" novalidate id="f">
            <label>Naar adres
              <div class="inline">
                <input id="to" class="mono" value="${f.to}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${net === 'test' ? 'Bijvoorbeeld: tb1q…' : 'Bijvoorbeeld: bc1q…'}">
                <button type="button" class="btn btn-secondary btn-icon" id="scan" aria-label="QR-code scannen" title="QR-code scannen">${icon('scan')}</button>
              </div>
            </label>
            ${f.label ? html`<span class="hint">Label uit de QR-code: ${f.label}</span>` : ''}
            <div>
              <div class="actions"><span class="label grow">Bedrag</span>
                <div class="seg" role="radiogroup" aria-label="Eenheid">
                  <label><input type="radio" name="unit" value="btc" ${f.unit === 'btc' ? 'checked' : ''}><span>BTC</span></label>
                  <label><input type="radio" name="unit" value="sats" ${f.unit === 'sats' ? 'checked' : ''}><span>sats</span></label>
                </div>
              </div>
              <div class="inline spaced-sm">
                <input id="amount" inputmode="decimal" autocomplete="off" value="${f.max ? '' : f.amount}" ${f.max ? 'disabled' : ''} placeholder="${f.max ? 'Alles (min fee)' : f.unit === 'btc' ? 'Bijvoorbeeld: 0,001' : 'Bijvoorbeeld: 100000'}" aria-label="Bedrag">
                <button type="button" class="btn ${f.max ? 'btn-primary' : 'btn-secondary'}" id="max" aria-pressed="${f.max}">Alles</button>
              </div>
            </div>
            <div>
              <span class="label">Fee</span>
              <div class="seg full spaced-sm" role="radiogroup" aria-label="Fee">
                ${(['low', 'normal', 'high', 'custom'] as const).map(
                  (k) => html`<label><input type="radio" name="fee" value="${k}" ${f.fee === k ? 'checked' : ''}><span>${{ low: 'Laag', normal: 'Normaal', high: 'Hoog', custom: 'Eigen' }[k]}${k !== 'custom' && levels ? html`<br><small class="muted">${levels[k]} sat/vB</small>` : ''}</span></label>`,
                )}
              </div>
              ${f.fee === 'custom' ? html`<label class="spaced-sm">sat/vB<input id="rate" inputmode="decimal" value="${f.customRate}" placeholder="Bijvoorbeeld: 12"></label>` : ''}
              <span class="hint">${levels ? 'Laag ≈ binnen een dag, normaal ≈ binnen een uur, hoog ≈ volgend blok.' : 'Fee-schatting ophalen…'}</span>
            </div>
            <details ${f.selected.size ? 'open' : ''}>
              <summary>Coins kiezen${f.selected.size ? ` (${f.selected.size} gekozen)` : ' (automatisch)'}</summary>
              ${utxos.length
                ? html`<div>${utxos.map(
                    (u) => html`<label class="coin check"><input type="checkbox" data-coin="${utxoKey(u)}" ${f.selected.has(utxoKey(u)) ? 'checked' : ''}>
                      <span class="row-main"><b>${money(u.value, f.unit)}</b><span class="muted small">${st.labels[utxoKey(u)] ?? shortAddress(u.address)}${u.confirmed ? '' : ' · onbevestigd wisselgeld'}</span></span></label>`,
                  )}</div>
                  <a class="small" href="#/coins">Labels beheren</a>`
                : html`<p class="muted small">Geen bevestigde coins.</p>`}
            </details>
            ${total === 0 ? html`<div class="alert warn">${icon('alert')}<span>Je hebt nog geen bevestigd saldo om te versturen.</span></div>` : ''}
            ${error ? html`<div class="alert error">${icon('alert')}<span>${error}</span></div>` : ''}
            <button class="btn btn-primary btn-block">Overzicht</button>
          </form>`,
      );
      bind();
    };

    const bind = () => {
      const to = $<HTMLInputElement>('#to', root);
      const applyUri = (text: string) => {
        const req = parsePaymentUri(text);
        if (!req) return;
        f.to = req.address;
        if (req.amount !== undefined) {
          f.max = false;
          f.amount = f.unit === 'btc' ? formatBtc(req.amount) : formatSats(req.amount);
        }
        if (req.label) f.label = req.label;
        drawForm();
      };
      to.oninput = () => {
        f.to = to.value.trim();
        if (/^bitcoin:/i.test(f.to)) applyUri(f.to);
      };
      $('#scan', root).onclick = async () => {
        const text = await scanQr();
        if (text) applyUri(text);
      };
      const amount = $<HTMLInputElement>('#amount', root);
      amount.oninput = () => (f.amount = amount.value);
      $('#max', root).onclick = () => {
        f.max = !f.max;
        drawForm();
      };
      $$<HTMLInputElement>('input[name=unit]', root).forEach((r) =>
        r.addEventListener('change', () => {
          const old = parseAmount(f.amount, f.unit);
          f.unit = r.value === 'sats' ? 'sats' : 'btc';
          if (old !== null && f.amount) f.amount = f.unit === 'btc' ? formatBtc(old) : formatSats(old);
          drawForm();
        }),
      );
      $$<HTMLInputElement>('input[name=fee]', root).forEach((r) =>
        r.addEventListener('change', () => {
          f.fee = r.value as FeeChoice;
          drawForm();
        }),
      );
      root.querySelector<HTMLInputElement>('#rate')?.addEventListener('input', (e) => (f.customRate = (e.target as HTMLInputElement).value));
      $$<HTMLInputElement>('[data-coin]', root).forEach((c) =>
        c.addEventListener('change', () => {
          if (c.checked) f.selected.add(c.dataset.coin!);
          else f.selected.delete(c.dataset.coin!);
          drawForm();
        }),
      );
      $<HTMLFormElement>('#f', root).onsubmit = async (e) => {
        e.preventDefault();
        try {
          const draft = await makeDraft();
          drawReview(draft);
        } catch (err) {
          drawForm(err instanceof Error ? err.message : 'Er ging iets mis.');
        }
      };
    };

    const makeDraft = async (): Promise<Draft> => {
      const address = f.to.trim();
      if (!address) throw new TxError('Vul het adres van de ontvanger in.');
      if (!isValidAddress(address, net)) throw new TxError(net === 'test' ? 'Dit is geen geldig testnet-adres.' : 'Dit is geen geldig Bitcoin-adres.');
      let amount: number | 'max' = 'max';
      if (!f.max) {
        const v = parseAmount(f.amount, f.unit);
        if (v === null || v <= 0n) throw new TxError('Vul een geldig bedrag in.');
        amount = Number(v);
      }
      const r = rate();
      if (!(r >= 1)) throw new TxError(f.fee === 'custom' ? 'Vul een fee van minimaal 1 sat/vB in.' : 'De fee-schatting is nog niet binnen. Kies "Eigen" of probeer het opnieuw.');
      if (r > 1000) throw new TxError('Deze fee is onrealistisch hoog. Controleer de sat/vB.');
      const pool = f.selected.size ? utxos.filter((u) => f.selected.has(utxoKey(u))) : utxos;
      return buildSend({
        utxos: pool,
        to: address,
        amount,
        feeRate: r,
        changeAddress: (await changeAddress()).address,
        net,
        book: await session.addressBook(),
      });
    };

    const drawReview = (d: Draft) => {
      const feeHigh = d.fee > d.amount * 0.1;
      setHtml(
        root,
        html`${header('Controleer en verstuur', 'Kijk alles goed na: een verzonden transactie is niet terug te draaien.')}
          <section class="card card-flow">
            <ul class="facts">
              <li><span>Naar</span><span class="mono small">${d.to}</span></li>
              <li><span>Bedrag</span><b>${money(d.amount, f.unit)}</b></li>
              <li><span>Fee</span><b>${money(d.fee, f.unit)} · ${d.feeRate} sat/vB</b></li>
              ${d.change ? html`<li><span>Wisselgeld (naar jezelf)</span><b>${money(d.change.amount, f.unit)}</b></li>` : ''}
              <li class="total"><span>Totaal van je saldo</span><b>${money(d.amount + d.fee, f.unit)}</b></li>
              <li><span>Coins</span><span>${d.inputs.length}</span></li>
            </ul>
            ${feeHigh ? html`<div class="alert warn">${icon('alert')}<span>De fee is meer dan 10% van het bedrag.</span></div>` : ''}
            <p class="hint">Replace-By-Fee staat aan: blijft de transactie hangen, dan kun je hem later versnellen.</p>
            <div class="actions">
              <button class="btn btn-secondary" id="back">Wijzigen</button>
              <button class="btn btn-primary grow" id="send">${icon('send')}Versturen</button>
            </div>
          </section>`,
      );
      $('#back', root).onclick = () => drawForm();
      $('#send', root).onclick = async () => {
        const esplora = await api();
        const txid = await askPin(
          'Versturen bevestigen',
          `${f.unit === 'btc' ? formatBtc(BigInt(d.amount)) + ' BTC' : formatSats(BigInt(d.amount)) + ' sats'} naar ${shortAddress(d.to)}`,
          (pin) =>
            session.withSecret(pin, async (secret) => {
              const acc = accountKey(secret.mnemonic, secret.passphrase, net);
              try {
                const signed = signDraft(d.tx, d.inputs, acc);
                return await esplora.broadcast(signed.hex);
              } finally {
                acc.wipePrivateData();
              }
            }),
          'Ondertekenen en versturen…',
        ).catch((e: Error) => {
          toast(e.message, 'err');
          return null;
        });
        if (!txid) return;
        form = null;
        drawDone(txid, d);
        void sync().catch(() => {});
      };
    };

    const drawDone = (txid: string, d: Draft) => {
      setHtml(
        root,
        html`<section class="card card-flow center">
          <div class="empty-state"><span class="ico">${icon('check')}</span><h3>Verzonden</h3>
            <p>${money(d.amount, f.unit)} is onderweg naar ${shortAddress(d.to)}. Na de eerste bevestiging is hij definitief.</p></div>
          <div class="address-box small">${txid}</div>
          <div class="actions">
            <button class="btn btn-secondary grow" id="copy">${icon('copy')}Kopiëren</button>
            <a class="btn btn-primary grow" href="#/home">Naar home</a>
          </div>
        </section>`,
      );
      $('#copy', root).onclick = () => copyText(txid, 'Transactie-ID gekopieerd');
    };

    drawForm();
    // Fee-schatting en verse coins op de achtergrond ophalen.
    api()
      .then((a) => a.feeEstimates())
      .then((est) => {
        levels = feeLevels(est);
        if (root.isConnected && $('#f', root)) drawForm();
      })
      .catch(() => {
        if (f.fee !== 'custom') {
          f.fee = 'custom';
          if (root.isConnected) drawForm('De fee-schatting kon niet worden opgehaald. Vul zelf een fee in.');
        }
      });
    const c = await cached();
    if (!c || Date.now() - c.scannedAt > 60_000) {
      sync()
        .then((r) => {
          utxos = spendable(r.utxos);
          if (root.isConnected && root.querySelector('#f')) drawForm();
        })
        .catch(() => {});
    }
  },
});

// Coins en labels (coin control)
route('/coins', {
  shell: 'app',
  nav: 'send',
  async render(root) {
    const { unit } = await session.settings();
    const list = (await cached())?.utxos ?? [];
    const st = session.state();
    setHtml(
      root,
      html`${header('Coins', 'Labels staan alleen op dit apparaat.', { href: '/versturen', label: 'Versturen' })}
        ${list.length
          ? html`<div class="rows">${list.map(
              (u) => html`<div class="row"><span class="row-main">
                <span class="row-title">${money(u.value, unit)}</span>
                <span class="row-sub mono">${shortAddress(u.address)}${u.confirmed ? '' : ' · onbevestigd'}</span>
                <input class="spaced-sm" data-label="${utxoKey(u)}" maxlength="60" value="${st.labels[utxoKey(u)] ?? ''}" placeholder="Bijvoorbeeld: Bisq-trade maart" aria-label="Label">
              </span></div>`,
            )}</div>`
          : html`<div class="empty-state"><span class="ico">${icon('coins')}</span><h3>Geen coins</h3><p>Zodra je bitcoin ontvangt, zie je hier de afzonderlijke coins (UTXO's).</p></div>`}`,
    );
    $$<HTMLInputElement>('[data-label]', root).forEach((inp) =>
      inp.addEventListener('change', () =>
        void session
          .saveState((s) => {
            const k = inp.dataset.label!;
            if (inp.value.trim()) s.labels[k] = inp.value.trim();
            else delete s.labels[k];
          })
          .then(() => toast('Label opgeslagen.')),
      ),
    );
  },
});

export function resetSendForm(): void {
  form = null;
}

