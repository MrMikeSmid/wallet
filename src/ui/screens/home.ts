// Scherm 5: Home (saldo en transacties) en het detail van een transactie.

import * as session from '../../app/session.ts';
import { cached, isSyncing, locateOwn, onSync, sync, api } from '../../app/sync.ts';
import { formatBtc, formatSats, formatSigned } from '../../core/format.ts';
import type { ScanResult, TxSummary } from '../../core/scan.ts';
import { TxError, buildBump, feeLevels, signDraft } from '../../core/tx.ts';
import { accountKey } from '../../core/wallet.ts';
import { $, copyText, dateTime, html, relTime, setHtml, toast, type Raw } from '../dom.ts';
import { go, header, route } from '../app.ts';
import { icon } from '../icons.ts';
import { askPin } from '../widgets.ts';

export function money(sats: number | bigint, unit: 'btc' | 'sats', signed = false): Raw {
  const v = BigInt(sats);
  const text = signed ? formatSigned(v, unit) : unit === 'btc' ? formatBtc(v) : formatSats(v);
  return html`${text} <span class="muted small">${unit === 'btc' ? 'BTC' : 'sats'}</span>`;
}

function txRow(t: TxSummary, unit: 'btc' | 'sats', note: string | undefined): Raw {
  const incoming = t.net > 0;
  const when = t.confirmed ? (t.time ? dateTime(t.time) : 'Bevestigd') : 'Onbevestigd';
  return html`<a class="row" href="#/tx/${t.txid}">
    <span class="row-ico ${incoming ? 'in' : 'out'}">${icon(incoming ? 'receive' : 'send')}</span>
    <span class="row-main">
      <span class="row-title">${incoming ? 'Ontvangen' : 'Verzonden'}</span>
      <span class="row-sub">${note ? `${note} · ` : ''}${when}</span>
    </span>
    <span class="amount-col">
      <span class="amount ${incoming ? 'in' : ''}">${formatSigned(BigInt(t.net), unit)}</span>
      ${t.confirmed ? '' : html`<span class="badge warn">In mempool</span>`}
    </span>
  </a>`;
}

route('/home', {
  shell: 'app',
  nav: 'home',
  async render(root) {
    const { unit, net } = await session.settings();
    let error = '';
    const draw = (r: ScanResult | null, busy: boolean) => {
      if (!root.isConnected) return;
      const st = session.state();
      setHtml(
        root,
        html`<section class="card balance" aria-live="polite">
            <div class="actions"><span class="stat-label grow">Saldo${net === 'test' ? ' (testnet)' : ''}</span>
              <button class="btn btn-ghost btn-icon btn-sm" id="refresh" aria-label="Bijwerken" title="Bijwerken" ${busy ? 'disabled' : ''}>${icon('refresh', 'sm')}</button>
            </div>
            ${r
              ? html`<div class="stat-value">${unit === 'btc' ? formatBtc(BigInt(r.confirmed)) : formatSats(BigInt(r.confirmed))}<small>${unit === 'btc' ? 'BTC' : 'sats'}</small></div>
                  <div class="stat-sub">${unit === 'btc' ? `${formatSats(BigInt(r.confirmed))} sats` : `${formatBtc(BigInt(r.confirmed))} BTC`}</div>
                  ${r.unconfirmed !== 0 ? html`<div class="stat-sub">Onbevestigd: <b>${formatSigned(BigInt(r.unconfirmed), unit)}</b> ${unit === 'btc' ? 'BTC' : 'sats'}</div>` : ''}`
              : html`<div class="stat-value">—</div><div class="stat-sub">${busy ? 'Saldo ophalen…' : 'Nog niet opgehaald.'}</div>`}
            ${busy ? html`<div class="progress" aria-label="Bezig met bijwerken"><i></i></div>` : html`<div class="hint">${r ? `Bijgewerkt ${relTime(r.scannedAt)}` : ''}</div>`}
            <div class="balance-actions">
              <a class="btn btn-primary" href="#/ontvangen">${icon('receive')}Ontvangen</a>
              <a class="btn btn-secondary" href="#/versturen">${icon('send')}Versturen</a>
            </div>
          </section>
          ${error ? html`<div class="alert error">${icon('alert')}<span>${error}</span></div>` : ''}
          <h2 class="section-title">Transacties</h2>
          ${r && r.txs.length
            ? html`<div class="rows">${r.txs.map((t) => txRow(t, unit, st.notes[t.txid]))}</div>`
            : html`<div class="empty-state"><span class="ico">${icon('inbox')}</span><h3>Nog geen transacties</h3><p>Ontvang je eerste bitcoin via Ontvangen. Dat kan vanaf elk platform of elke wallet.</p></div>`}`,
      );
      $('#refresh', root).onclick = () => refresh();
    };
    const refresh = () => {
      error = '';
      sync().catch((e: Error) => {
        error = e.message;
        void cached().then((c) => draw(c, false));
      });
    };
    const off = onSync(draw);
    this.leave = off;
    const c = await cached();
    draw(c, isSyncing());
    // Automatisch bijwerken als de gegevens ouder zijn dan 1 minuut.
    if (!isSyncing() && (!c || Date.now() - c.scannedAt > 60_000)) refresh();
  },
});

route('/tx', {
  shell: 'app',
  nav: 'home',
  async render(root, txid) {
    const { unit, net } = await session.settings();
    const st = session.state();
    const c = await cached();
    const t = c?.txs.find((x) => x.txid === txid);
    if (!t) return go('/home');
    const incoming = t.net > 0;
    const amount = incoming ? t.net : -t.net - t.fee;
    setHtml(
      root,
      html`${header(incoming ? 'Ontvangen' : 'Verzonden', t.confirmed ? `Bevestigd${t.height ? ` in blok ${t.height}` : ''}` : 'Wacht op bevestiging', { href: '/home', label: 'Home' })}
        <section class="card card-flow">
          <ul class="facts">
            <li><span>Bedrag</span><b>${money(amount, unit)}</b></li>
            ${incoming ? '' : html`<li><span>Fee</span><b>${money(t.fee, unit)} · ${(t.fee / t.vsize).toFixed(1)} sat/vB</b></li>`}
            ${incoming ? '' : html`<li class="total"><span>Totaal van je saldo</span><b>${money(-t.net, unit)}</b></li>`}
            ${t.counterparties.map((a) => html`<li><span>Naar</span><span class="mono small">${a}</span></li>`)}
            <li><span>Datum</span><span>${t.time ? dateTime(t.time) : 'Nog niet bevestigd'}</span></li>
            <li><span>Status</span><span>${t.confirmed ? html`<span class="badge success">Bevestigd</span>` : html`<span class="badge warn">In mempool</span>`}</span></li>
            <li><span>Transactie-ID</span><span class="mono small">${t.txid}</span></li>
          </ul>
          <div class="actions"><button class="btn btn-secondary btn-sm" id="copy">${icon('copy', 'sm')}Transactie-ID kopiëren</button></div>
        </section>
        <section class="card card-flow">
          <label>Notitie (alleen op dit apparaat)
            <input id="note" maxlength="120" value="${st.notes[t.txid] ?? ''}" placeholder="Bijvoorbeeld: Peach-trade met Anna">
          </label>
        </section>
        ${t.bumpable
          ? html`<section class="card card-flow">
              <h2>Versnellen</h2>
              <p class="muted">Deze transactie wacht nog. Met Replace-By-Fee vervang je hem door dezelfde transactie met een hogere fee, betaald uit je wisselgeld.</p>
              <label>Nieuwe fee (sat/vB)<input id="rate" inputmode="decimal" placeholder="Bijvoorbeeld: 20"></label>
              <div class="hint" id="rate-hint">Huidig: ${(t.fee / t.vsize).toFixed(1)} sat/vB</div>
              <div class="alert error" id="bump-err" hidden>${icon('alert')}<span></span></div>
              <div class="actions"><button class="btn btn-primary" id="bump">${icon('zap')}Versnellen</button></div>
            </section>`
          : ''}`,
    );
    $('#copy', root).onclick = () => copyText(t.txid, 'Transactie-ID gekopieerd');
    const note = $<HTMLInputElement>('#note', root);
    note.onchange = () =>
      void session.saveState((s) => {
        if (note.value.trim()) s.notes[t.txid] = note.value.trim();
        else delete s.notes[t.txid];
      }).then(() => toast('Notitie opgeslagen.'));

    if (!t.bumpable) return;
    const rateIn = $<HTMLInputElement>('#rate', root);
    api()
      .then((a) => a.feeEstimates())
      .then((est) => {
        const lv = feeLevels(est);
        if (!rateIn.value) rateIn.value = String(Math.max(lv.high, Math.ceil(t.fee / t.vsize) + 1));
        $('#rate-hint', root).textContent = `Huidig: ${(t.fee / t.vsize).toFixed(1)} sat/vB · nu snel: ${lv.high} sat/vB`;
      })
      .catch(() => {});
    $('#bump', root).onclick = async () => {
      const err = $('#bump-err', root);
      err.hidden = true;
      const rate = Number(rateIn.value.replace(',', '.'));
      try {
        if (!(rate > t.fee / t.vsize)) throw new TxError('Kies een hogere fee dan de huidige.');
        const esplora = await api();
        const orig = await esplora.tx(t.txid);
        const locate = await locateOwn();
        const book = await session.addressBook();
        const bump = buildBump(orig, rate, locate, book);
        const txid2 = await askPin(
          'Versnellen bevestigen',
          `Nieuwe fee ${formatSats(BigInt(bump.newFee))} sats (${bump.feeRate.toFixed(1)} sat/vB). Voer je pincode in.`,
          (pin) =>
            session.withSecret(pin, async (secret) => {
              const acc = accountKey(secret.mnemonic, secret.passphrase, net);
              try {
                const signed = signDraft(bump.tx, bump.inputs, acc);
                return await esplora.broadcast(signed.hex);
              } finally {
                acc.wipePrivateData();
              }
            }),
          'Ondertekenen en versturen…',
        );
        if (!txid2) return;
        toast('Transactie versneld.');
        await sync().catch(() => {});
        go(`/tx/${txid2}`);
      } catch (e) {
        $('span', err).textContent = e instanceof Error ? e.message : 'Versnellen lukte niet.';
        err.hidden = false;
      }
    };
  },
});

