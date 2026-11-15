// Scherm 8: Instellingen, plus seed bekijken en bericht ondertekenen.

import * as session from '../../app/session.ts';
import { privacyScreen } from '../../app/storage.ts';
import { cached, receiveAddress } from '../../app/sync.ts';
import { DEFAULT_ENDPOINTS, Esplora, endpointOrigin } from '../../core/esplora.ts';
import { signMessage, verifyMessage } from '../../core/message.ts';
import { accountKey, accountPath, privateKeyAt, type Net } from '../../core/wallet.ts';
import { $, $$, confirmDialog, copyText, html, modal, setHtml, toast } from '../dom.ts';
import { type Theme, getTheme, go, header, render, route, setTheme } from '../app.ts';
import { icon } from '../icons.ts';
import { askPin, mountPinpad, pinpadHtml } from '../widgets.ts';
import { resetSendForm } from './send.ts';

declare const __CONNECT_SRC__: string[];
declare const __APP_VERSION__: string;
const allowedOrigins: string[] = typeof __CONNECT_SRC__ !== 'undefined' ? __CONNECT_SRC__ : [];

function cspAllows(url: string): boolean {
  const o = endpointOrigin(url);
  return o !== null && (allowedOrigins.length === 0 || allowedOrigins.includes(o));
}

route('/instellingen', {
  shell: 'app',
  nav: 'settings',
  async render(root) {
    const s = await session.settings();
    const meta = await session.getMeta();
    const st = session.state();
    const theme = getTheme();
    setHtml(
      root,
      html`${header('Instellingen')}
        <section class="card card-flow">
          <h2>Netwerk</h2>
          <div class="seg full" role="radiogroup" aria-label="Netwerk">
            <label><input type="radio" name="net" value="main" ${s.net === 'main' ? 'checked' : ''}><span>Mainnet</span></label>
            <label><input type="radio" name="net" value="test" ${s.net === 'test' ? 'checked' : ''}><span>Testnet</span></label>
          </div>
          ${s.net === 'test' ? html`<div class="alert warn">${icon('alert')}<span>Testnet-munten hebben geen waarde. Gebruik dit om de app uit te proberen.</span></div>` : ''}
        </section>

        <form class="card card-flow" id="server" novalidate>
          <h2>Server</h2>
          <label>Esplora-adres (${s.net === 'main' ? 'mainnet' : 'testnet'})
            <input id="endpoint" class="mono" value="${s.endpoints[s.net]}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Bijvoorbeeld: ${DEFAULT_ENDPOINTS[s.net]}">
          </label>
          <div class="alert">${icon('shield')}<span>De server ziet welke adressen je opvraagt en je IP-adres. Voor de beste privacy gebruik je een eigen node of server met een Esplora-API.</span></div>
          <div class="alert warn" id="csp" ${cspAllows(s.endpoints[s.net]) ? 'hidden' : ''}>${icon('alert')}<span>Deze server staat niet in de beveiligingsinstellingen (CSP) van deze versie; verzoeken worden geblokkeerd. Zie de README om een eigen server toe te voegen.</span></div>
          <div class="actions">
            <button class="btn btn-primary">Opslaan</button>
            <button type="button" class="btn btn-secondary" id="test">Verbinding testen</button>
            <button type="button" class="btn btn-ghost" id="default">Standaard</button>
          </div>
        </form>

        <section class="card card-flow">
          <h2>Weergave</h2>
          <div><span class="label">Thema</span>
            <div class="seg spaced-sm" role="radiogroup" aria-label="Thema">
              ${(['auto', 'light', 'dark'] as const).map((t) => html`<label><input type="radio" name="theme" value="${t}" ${theme === t ? 'checked' : ''}><span>${{ auto: 'Automatisch', light: 'Licht', dark: 'Donker' }[t]}</span></label>`)}
            </div>
          </div>
          <div><span class="label">Bedragen in</span>
            <div class="seg spaced-sm" role="radiogroup" aria-label="Eenheid">
              <label><input type="radio" name="unit" value="btc" ${s.unit === 'btc' ? 'checked' : ''}><span>BTC</span></label>
              <label><input type="radio" name="unit" value="sats" ${s.unit === 'sats' ? 'checked' : ''}><span>sats</span></label>
            </div>
          </div>
        </section>

        <section class="card card-flow">
          <h2>Beveiliging</h2>
          <div class="switch-row">
            <span><b>Wis wallet na 10 foute pogingen</b><small class="hint">Zonder je seed phrase ben je dan alles kwijt.</small></span>
            <label class="switch"><input type="checkbox" id="wipe10" ${meta?.wipeAfter10 ? 'checked' : ''} aria-label="Wis wallet na 10 foute pogingen"><i></i></label>
          </div>
          <hr>
          <div class="actions">
            <button class="btn btn-secondary" id="pin">${icon('key', 'sm')}Pincode wijzigen</button>
            <a class="btn btn-secondary" href="#/seed">${icon('eye', 'sm')}Seed bekijken</a>
          </div>
          <p class="hint">De app vergrendelt na 2 minuten zonder gebruik en zodra je hem verlaat.</p>
        </section>

        <section class="card card-flow">
          <h2>Gereedschap</h2>
          <div class="actions">
            <a class="btn btn-secondary" href="#/ondertekenen">${icon('pencil', 'sm')}Bericht ondertekenen</a>
            <a class="btn btn-secondary" href="#/coins">${icon('coins', 'sm')}Coins en labels</a>
          </div>
        </section>

        <section class="card card-flow">
          <h2>Over deze wallet</h2>
          <ul class="facts">
            <li><span>Type</span><span>Native SegWit (BIP84)</span></li>
            <li><span>Afleidingspad</span><span class="mono">${accountPath(s.net)}</span></li>
            <li><span>Seed</span><span>${st.words} woorden${st.hasPassphrase ? ' + passphrase' : ''}</span></li>
            <li><span>Versie</span><span>${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}</span></li>
          </ul>
          <p class="hint">Dezelfde seed geeft in Sparrow of Electrum (Native SegWit, BIP84) dezelfde adressen.</p>
        </section>

        <section class="card card-flow danger-card">
          <h2>Gevaarlijke zone</h2>
          <p class="muted">Wissen verwijdert de wallet van dit apparaat. Je bitcoin blijft op de blockchain; met je seed phrase herstel je de wallet.</p>
          <div class="actions"><button class="btn btn-danger" id="wipe">${icon('trash', 'sm')}Wallet wissen</button></div>
        </section>`,
    );

    $$<HTMLInputElement>('input[name=net]', root).forEach((r) =>
      r.addEventListener('change', async () => {
        await session.saveSettings({ net: r.value as Net });
        resetSendForm();
        toast(r.value === 'test' ? 'Testnet staat aan.' : 'Mainnet staat aan.');
        await render();
      }),
    );
    $$<HTMLInputElement>('input[name=theme]', root).forEach((r) => r.addEventListener('change', () => setTheme(r.value as Theme)));
    $$<HTMLInputElement>('input[name=unit]', root).forEach((r) =>
      r.addEventListener('change', async () => {
        await session.saveSettings({ unit: r.value === 'sats' ? 'sats' : 'btc' });
        resetSendForm();
      }),
    );

    const ep = $<HTMLInputElement>('#endpoint', root);
    ep.oninput = () => ($('#csp', root).hidden = cspAllows(ep.value));
    $<HTMLFormElement>('#server', root).onsubmit = async (e) => {
      e.preventDefault();
      const url = ep.value.trim().replace(/\/+$/, '');
      if (!endpointOrigin(url)) return toast('Gebruik een https-adres.', 'err');
      await session.saveSettings({ endpoints: { ...s.endpoints, [s.net]: url } });
      toast('Server opgeslagen.');
    };
    $('#default', root).onclick = () => {
      ep.value = DEFAULT_ENDPOINTS[s.net];
      $('#csp', root).hidden = true;
    };
    $('#test', root).onclick = async () => {
      try {
        const h = await new Esplora(ep.value.trim()).tipHeight();
        if (!Number.isFinite(h) || h <= 0) throw new Error('Onverwacht antwoord van de server.');
        toast(`Verbonden. Laatste blok: ${h}.`);
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Geen verbinding.', 'err');
      }
    };

    const wipe10 = $<HTMLInputElement>('#wipe10', root);
    wipe10.onchange = async () => {
      if (wipe10.checked && !(await confirmDialog('Na 10 foute pincodes wordt de wallet van dit apparaat gewist. Heb je je seed phrase veilig op papier?', 'Aanzetten'))) {
        wipe10.checked = false;
        return;
      }
      await session.setWipeAfter10(wipe10.checked);
      toast(wipe10.checked ? 'Wissen na 10 pogingen staat aan.' : 'Wissen na 10 pogingen staat uit.');
    };

    $('#pin', root).onclick = () => void changePinFlow();

    $('#wipe', root).onclick = async () => {
      if (!(await confirmDialog('De wallet wordt van dit apparaat verwijderd. Zonder je seed phrase krijg je hem niet terug.', 'Doorgaan'))) return;
      const ok = await modal<boolean>(
        html`<h2>Laatste controle</h2>
          <p class="muted">Typ <b>WISSEN</b> om de wallet definitief van dit apparaat te verwijderen.</p>
          <input id="word" autocomplete="off" autocapitalize="characters" placeholder="WISSEN" aria-label="Typ WISSEN">
          <div class="actions modal-actions"><button class="btn btn-secondary" data-no>Annuleren</button><button class="btn btn-danger" data-yes disabled>Wallet wissen</button></div>`,
        (m, close) => {
          const w = $<HTMLInputElement>('#word', m);
          const yes = $<HTMLButtonElement>('[data-yes]', m);
          w.oninput = () => (yes.disabled = w.value.trim() !== 'WISSEN');
          $('[data-no]', m).onclick = () => close(false);
          yes.onclick = () => close(true);
          setTimeout(() => w.focus());
        },
        'Wallet wissen',
      );
      if (!ok) return;
      await session.wipeWallet();
      toast('De wallet is van dit apparaat verwijderd.');
      go('/welkom');
    };
  },
});

async function changePinFlow(): Promise<void> {
  let oldPin = '';
  const ok = await askPin('Huidige pincode', 'Voer eerst je huidige pincode in.', async (pin) => {
    const r = await session.withSecret(pin, () => true);
    if (r.ok) oldPin = pin;
    return r;
  });
  if (!ok) return;
  const done = await modal<boolean>(
    html`<button class="btn btn-ghost btn-icon modal-close" data-close aria-label="Sluiten">${icon('x')}</button>${pinpadHtml('Nieuwe pincode', 'Minimaal 6 cijfers.')}`,
    (m, close) => {
      $('[data-close]', m).onclick = () => close(false);
      let first = '';
      mountPinpad(m, async (pin, ctl) => {
        if (!first) {
          first = pin;
          return ctl.reset('Herhaal nieuwe pincode', 'Typ dezelfde pincode nog een keer.');
        }
        if (pin !== first) {
          first = '';
          ctl.reset('Nieuwe pincode', 'Minimaal 6 cijfers.');
          return ctl.setError('De pincodes waren niet gelijk. Begin opnieuw.');
        }
        ctl.setBusy(true, 'Opnieuw versleutelen…');
        const r = await session.changePin(oldPin, pin);
        first = '';
        if (r.ok) return close(true);
        ctl.setBusy(false, '');
        ctl.setError('Wijzigen lukte niet. Probeer het opnieuw.');
      });
    },
    'Nieuwe pincode',
  );
  oldPin = '';
  if (done) toast('Pincode gewijzigd.');
}

// Seed opnieuw bekijken (na pincode)
route('/seed', {
  shell: 'app',
  nav: 'settings',
  async render(root) {
    const words = await askPin('Seed bekijken', 'Voer je pincode in om de woorden te tonen.', (pin) =>
      session.withSecret(pin, (secret) => ({ words: secret.mnemonic.split(' '), pass: secret.passphrase !== '' })),
    );
    if (!words || !root.isConnected) return go('/instellingen');
    await privacyScreen(true);
    setHtml(
      root,
      html`${header('Je seed phrase', undefined, { href: '/instellingen', label: 'Instellingen' })}
        <section class="card card-flow">
          <div class="alert warn">${icon('alert')}<span><b>Deel deze woorden met niemand.</b> Geen enkele dienst of helpdesk vraagt er ooit om.</span></div>
          <ol class="words" aria-label="Seed phrase">${words.words.map((w) => html`<li>${w}</li>`)}</ol>
          ${words.pass ? html`<p class="hint">Deze wallet gebruikt ook een BIP39-passphrase. Die is nodig bij herstellen en wordt hier niet getoond.</p>` : ''}
          <div class="actions"><a class="btn btn-primary" href="#/instellingen">Verbergen</a></div>
        </section>`,
    );
    words.words.fill('');
  },
  leave() {
    void privacyScreen(false);
  },
});

// Bericht ondertekenen (bewijs van eigendom van een adres)
route('/ondertekenen', {
  shell: 'app',
  nav: 'settings',
  async render(root) {
    const { net } = await session.settings();
    const book = await session.addressBook();
    const c = await cached();
    const current = await receiveAddress();
    const options = new Map<string, { chain: 0 | 1; index: number }>();
    options.set(current.address, { chain: 0, index: current.index });
    for (let i = 0; i <= (c?.lastUsed[0] ?? -1); i++) options.set(book.at(0, i).address, { chain: 0, index: i });

    setHtml(
      root,
      html`${header('Bericht ondertekenen', 'Bewijs dat een adres van jou is, bijvoorbeeld voor een P2P-platform.', { href: '/instellingen', label: 'Instellingen' })}
        <form class="card card-flow" id="sign" novalidate>
          <label>Adres
            <select id="addr">${[...options.keys()].map((a) => html`<option value="${a}">${a}</option>`)}</select>
          </label>
          <label>Bericht<textarea id="msg" placeholder="Bijvoorbeeld: Ik ben eigenaar van dit adres - 15-11-2026"></textarea></label>
          <button class="btn btn-primary">${icon('pencil')}Ondertekenen</button>
          <div id="out" hidden class="stack">
            <label>Handtekening (BIP137)<textarea id="sig" class="mono" readonly></textarea></label>
            <div class="actions"><button type="button" class="btn btn-secondary" id="copy">${icon('copy', 'sm')}Handtekening kopiëren</button></div>
          </div>
        </form>
        <details class="card">
          <summary>Handtekening controleren</summary>
          <form class="stack" id="verify" novalidate>
            <label>Adres<input id="v-addr" class="mono" autocomplete="off" placeholder="Bijvoorbeeld: bc1q…"></label>
            <label>Bericht<textarea id="v-msg"></textarea></label>
            <label>Handtekening<textarea id="v-sig" class="mono"></textarea></label>
            <button class="btn btn-secondary">Controleren</button>
          </form>
        </details>`,
    );
    $<HTMLFormElement>('#sign', root).onsubmit = async (e) => {
      e.preventDefault();
      const address = $<HTMLSelectElement>('#addr', root).value;
      const message = $<HTMLTextAreaElement>('#msg', root).value;
      if (!message.trim()) return toast('Vul een bericht in.', 'err');
      const loc = options.get(address)!;
      const sig = await askPin('Ondertekenen', 'Voer je pincode in.', (pin) =>
        session.withSecret(pin, (secret) => {
          const acc = accountKey(secret.mnemonic, secret.passphrase, net);
          const key = privateKeyAt(acc, loc.chain, loc.index);
          try {
            return signMessage(key, message);
          } finally {
            key.fill(0);
            acc.wipePrivateData();
          }
        }),
      );
      if (!sig) return;
      $<HTMLTextAreaElement>('#sig', root).value = sig;
      $('#out', root).hidden = false;
    };
    $('#copy', root).onclick = () => copyText($<HTMLTextAreaElement>('#sig', root).value, 'Handtekening gekopieerd');
    $<HTMLFormElement>('#verify', root).onsubmit = (e) => {
      e.preventDefault();
      const ok = verifyMessage(
        $<HTMLInputElement>('#v-addr', root).value,
        $<HTMLTextAreaElement>('#v-msg', root).value,
        $<HTMLTextAreaElement>('#v-sig', root).value,
        net,
      );
      toast(ok ? 'De handtekening klopt.' : 'De handtekening klopt niet.', ok ? 'ok' : 'err');
    };
  },
});
