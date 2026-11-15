// Schermen 1–4: welkom, seed tonen, seed bevestigen / herstellen, pincode instellen.
// Ook het ontgrendelscherm.

import * as session from '../../app/session.ts';
import { privacyScreen } from '../../app/storage.ts';
import { sync } from '../../app/sync.ts';
import { isValidMnemonic, normalizeMnemonic, suggestWords, WORDLIST, createMnemonic } from '../../core/wallet.ts';
import { $, $$, html, setHtml } from '../dom.ts';
import { go, route } from '../app.ts';
import { icon } from '../icons.ts';
import { mountPinpad, pinError, pinpadHtml } from '../widgets.ts';

/** Tijdelijke gegevens tijdens het aanmaken; alleen in het geheugen. */
let draft: { mnemonic: string; passphrase: string; words: 12 | 24; mode: 'new' | 'restore' } | null = null;

function clearDraft(): void {
  if (draft) {
    draft.mnemonic = '';
    draft.passphrase = '';
  }
  draft = null;
}

const WORDS = new Set(WORDLIST);

// 1. Welkom
route('/welkom', {
  shell: 'auth',
  public: true,
  render(root) {
    clearDraft();
    setHtml(
      root,
      html`<div class="auth-card">
        <div class="auth-head">
          <span class="logo lg" aria-hidden="true">₿</span>
          <h1>Je eigen Bitcoin-wallet</h1>
          <p class="muted">Je sleutels worden op dit apparaat gemaakt en verlaten het nooit. Geen account, geen e-mail.</p>
        </div>
        <div class="stack">
          <a class="btn btn-primary btn-block" href="#/nieuw">${icon('plus')}Nieuwe wallet</a>
          <a class="btn btn-secondary btn-block" href="#/herstellen">${icon('key')}Wallet herstellen</a>
        </div>
        <p class="hint center">Alleen Bitcoin. Geen analytics of tracking.</p>
      </div>`,
    );
  },
});

// 2. Seed tonen
route('/nieuw', {
  shell: 'auth',
  public: true,
  async render(root) {
    await privacyScreen(true);
    if (!draft || draft.mode !== 'new') draft = { mnemonic: createMnemonic(12), passphrase: '', words: 12, mode: 'new' };
    const d = draft;
    const draw = () => {
      setHtml(
        root,
        html`<div class="auth-card wide">
          <a class="back-link" href="#/welkom">${icon('chevron-left', 'sm')}Terug</a>
          <div class="auth-head">
            <h1>Je seed phrase</h1>
            <p class="muted">Met deze woorden herstel je je wallet op elk apparaat.</p>
          </div>
          <div class="seg full" role="radiogroup" aria-label="Aantal woorden">
            <label><input type="radio" name="n" value="12" ${d.words === 12 ? 'checked' : ''}><span>12 woorden</span></label>
            <label><input type="radio" name="n" value="24" ${d.words === 24 ? 'checked' : ''}><span>24 woorden</span></label>
          </div>
          <div class="alert warn">${icon('alert')}<span><b>Schrijf deze woorden op papier, op volgorde.</b> Deel ze met niemand en maak geen foto of screenshot. Wie de woorden heeft, heeft je bitcoin. De app maakt geen back-up.</span></div>
          <ol class="words" aria-label="Seed phrase">${d.mnemonic.split(' ').map((w) => html`<li>${w}</li>`)}</ol>
          <label class="check"><input type="checkbox" id="written">Ik heb de ${d.words} woorden op papier gezet.</label>
          <button class="btn btn-primary btn-block" id="next" disabled>Verder</button>
        </div>`,
      );
      $$<HTMLInputElement>('input[name=n]', root).forEach((r) =>
        r.addEventListener('change', () => {
          d.words = r.value === '24' ? 24 : 12;
          d.mnemonic = createMnemonic(d.words);
          draw();
        }),
      );
      const cb = $<HTMLInputElement>('#written', root);
      const next = $<HTMLButtonElement>('#next', root);
      cb.onchange = () => (next.disabled = !cb.checked);
      next.onclick = () => go('/bevestigen');
    };
    draw();
  },
  leave() {
    void privacyScreen(false);
  },
});

// 3. Seed bevestigen (3 willekeurige woorden)
route('/bevestigen', {
  shell: 'auth',
  public: true,
  render(root) {
    if (!draft || draft.mode !== 'new') return go('/welkom');
    const words = draft.mnemonic.split(' ');
    const picks = new Set<number>();
    while (picks.size < 3) picks.add(crypto.getRandomValues(new Uint32Array(1))[0]! % words.length);
    const order = [...picks].sort((a, b) => a - b);
    setHtml(
      root,
      html`<form class="auth-card" novalidate>
        <a class="back-link" href="#/nieuw">${icon('chevron-left', 'sm')}Woorden opnieuw tonen</a>
        <div class="auth-head">
          <h1>Controleer je woorden</h1>
          <p class="muted">Vul de gevraagde woorden in vanaf je papier.</p>
        </div>
        <div class="alert error" id="err" hidden>${icon('alert')}<span>Een of meer woorden kloppen niet. Kijk je papier na.</span></div>
        ${order.map((i) => html`<label>Woord ${i + 1}<input name="w${i}" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="text" placeholder="Bijvoorbeeld: ${WORDLIST[(i * 97) % 2048]!}" required></label>`)}
        <button class="btn btn-primary btn-block">Controleren</button>
      </form>`,
    );
    const form = $<HTMLFormElement>('form', root);
    form.onsubmit = (e) => {
      e.preventDefault();
      const ok = order.every((i) => $<HTMLInputElement>(`[name=w${i}]`, form).value.trim().toLowerCase() === words[i]);
      $('#err', root).hidden = ok;
      if (ok) go('/pincode');
    };
  },
});

// 3b. Wallet herstellen
route('/herstellen', {
  shell: 'auth',
  public: true,
  render(root) {
    clearDraft();
    let count: 12 | 24 = 12;
    const values: string[] = [];
    let focus = 0;
    const draw = () => {
      setHtml(
        root,
        html`<form class="auth-card wide" novalidate>
          <a class="back-link" href="#/welkom">${icon('chevron-left', 'sm')}Terug</a>
          <div class="auth-head">
            <h1>Wallet herstellen</h1>
            <p class="muted">Vul je seed phrase in. Je kunt ook alle woorden tegelijk in het eerste vak plakken.</p>
          </div>
          <div class="seg full" role="radiogroup" aria-label="Aantal woorden">
            <label><input type="radio" name="n" value="12" ${count === 12 ? 'checked' : ''}><span>12 woorden</span></label>
            <label><input type="radio" name="n" value="24" ${count === 24 ? 'checked' : ''}><span>24 woorden</span></label>
          </div>
          <ol class="words inputs">
            ${Array.from({ length: count }, (_, i) => html`<li><input data-i="${i}" value="${values[i] ?? ''}" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Woord ${i + 1}"></li>`)}
          </ol>
          <div class="suggest" id="suggest" aria-label="Suggesties"></div>
          <details>
            <summary>BIP39-passphrase (optioneel)</summary>
            <div class="stack">
              <p class="hint">Alleen invullen als je wallet een extra passphrase heeft (het "25e woord"). Een andere passphrase geeft een andere wallet.</p>
              <input type="password" id="pass" autocomplete="off" placeholder="Bijvoorbeeld: laat leeg als je er geen hebt">
            </div>
          </details>
          <div class="alert error" id="err" hidden>${icon('alert')}<span></span></div>
          <button class="btn btn-primary btn-block">Herstellen</button>
        </form>`,
      );
      const form = $<HTMLFormElement>('form', root);
      const inputs = $$<HTMLInputElement>('[data-i]', form);
      const sug = $('#suggest', root);
      const showSuggest = (inp: HTMLInputElement) => {
        const opts = inp.value.length >= 1 && !WORDS.has(inp.value.trim()) ? suggestWords(inp.value) : [];
        setHtml(sug, html`${opts.map((w) => html`<button type="button" class="chip" data-w="${w}">${w}</button>`)}`);
        $$<HTMLButtonElement>('[data-w]', sug).forEach((b) => {
          b.onpointerdown = (e) => e.preventDefault(); // focus in het veld houden
          b.onclick = () => {
            inp.value = b.dataset.w!;
            values[Number(inp.dataset.i)] = inp.value;
            inp.classList.remove('bad');
            sug.textContent = '';
            inputs[Number(inp.dataset.i) + 1]?.focus();
          };
        });
      };
      inputs.forEach((inp) => {
        inp.addEventListener('input', () => {
          const parts = normalizeMnemonic(inp.value).split(' ');
          if (parts.length > 1) {
            // Hele zin geplakt.
            if (parts.length === 24 && count === 12) count = 24;
            parts.slice(0, count).forEach((w, j) => (values[Number(inp.dataset.i) + j] = w));
            focus = Math.min(count - 1, Number(inp.dataset.i) + parts.length);
            return draw();
          }
          values[Number(inp.dataset.i)] = inp.value.trim().toLowerCase();
          inp.classList.toggle('bad', inp.value.length > 3 && suggestWords(inp.value, 1).length === 0);
          showSuggest(inp);
        });
        inp.addEventListener('focus', () => showSuggest(inp));
        inp.addEventListener('blur', () => inp.classList.toggle('bad', inp.value.trim() !== '' && !WORDS.has(inp.value.trim().toLowerCase())));
      });
      $$<HTMLInputElement>('input[name=n]', root).forEach((r) =>
        r.addEventListener('change', () => {
          count = r.value === '24' ? 24 : 12;
          draw();
        }),
      );
      inputs[focus]?.focus();
      form.onsubmit = (e) => {
        e.preventDefault();
        const phrase = normalizeMnemonic(values.slice(0, count).join(' '));
        const err = $('#err', root);
        const unknown = phrase.split(' ').filter((w) => !WORDS.has(w));
        let msg = '';
        if (phrase.split(' ').length !== count) msg = `Vul alle ${count} woorden in.`;
        else if (unknown.length) msg = `Onbekend woord: ${unknown[0]}. Kies een woord uit de suggesties.`;
        else if (!isValidMnemonic(phrase)) msg = 'De woorden kloppen niet (controlegetal ongeldig). Controleer de volgorde en de spelling.';
        if (msg) {
          $('span', err).textContent = msg;
          err.hidden = false;
          return;
        }
        draft = { mnemonic: phrase, passphrase: $<HTMLInputElement>('#pass', root).value, words: count, mode: 'restore' };
        values.fill('');
        go('/pincode');
      };
    };
    draw();
  },
});

// 4. Pincode instellen (twee keer)
route('/pincode', {
  shell: 'auth',
  public: true,
  render(root) {
    if (!draft) return go('/welkom');
    const d = draft;
    setHtml(
      root,
      html`<div class="auth-card">
        ${pinpadHtml('Kies een pincode', 'Minimaal 6 cijfers. Hiermee ontgrendel je de wallet op dit apparaat.')}
        <p class="hint center">Vergeten? Dan herstel je de wallet met je seed phrase.</p>
      </div>`,
    );
    let first = '';
    mountPinpad($('.pinpad', root), async (pin, ctl) => {
      if (!first) {
        first = pin;
        ctl.reset('Herhaal je pincode', 'Typ dezelfde pincode nog een keer.');
        return;
      }
      if (pin !== first) {
        first = '';
        ctl.reset('Kies een pincode', 'Minimaal 6 cijfers. Hiermee ontgrendel je de wallet op dit apparaat.');
        ctl.setError('De pincodes waren niet gelijk. Begin opnieuw.');
        return;
      }
      ctl.setBusy(true, 'Wallet versleutelen…');
      try {
        await session.createWallet({ mnemonic: d.mnemonic, passphrase: d.passphrase }, pin, d.words);
        const restored = d.mode === 'restore';
        clearDraft();
        first = '';
        go('/home');
        if (restored) void sync().catch(() => {});
      } catch {
        ctl.setBusy(false, '');
        ctl.setError('Opslaan lukte niet. Staat privé-browsen aan? Probeer het opnieuw.');
      }
    });
  },
});

// Ontgrendelen
route('/ontgrendelen', {
  shell: 'auth',
  public: true,
  render(root) {
    setHtml(
      root,
      html`<div class="auth-card">
        <div class="center"><span class="logo lg" aria-hidden="true">₿</span></div>
        ${pinpadHtml('Ontgrendelen', 'Voer je pincode in.')}
      </div>`,
    );
    mountPinpad($('.pinpad', root), async (pin, ctl) => {
      ctl.setBusy(true, 'Ontgrendelen…');
      const r = await session.unlock(pin);
      if (r.ok) return go('/home');
      ctl.setBusy(false, '');
      ctl.setError(pinError(r));
      if (r.reason === 'wiped') setTimeout(() => go('/welkom'), 1500);
    });
  },
});
