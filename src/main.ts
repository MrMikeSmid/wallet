import './style.css';
import encodeQR from '@paulmillr/qr';
import { isAddress, makeUri, parseUri } from './core/bip21.ts';
import { DEFAULT_SERVER, Esplora, serversFor } from './core/esplora.ts';
import { icon } from './icons.ts';
import { clearSession, extendSession, loadSession, saveSession } from './core/session.ts';
import { fetchHistory, fetchPrice, fetchPriceAt, formatEur, satsToEur, type Point, type Range } from './core/price.ts';
import { startScan } from './core/scanner.ts';
import { buildTx, type Draft } from './core/send.ts';
import { defaultMeta, loadMeta, loadVault, lockoutMs, saveMeta, saveVault, wipe, type Meta } from './core/store.ts';
import { scan, type Snapshot } from './core/sync.ts';
import { formatBtc, formatSats, parseBtc } from './core/units.ts';
import { open, seal, type Secret } from './core/vault.ts';
import { Account, isValidMnemonic, newMnemonic, normalizeMnemonic, words, type Net } from './core/wallet.ts';

// ---------- kleine DOM-hulp ----------
type Child = Node | string | null | undefined | false;
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* geen opslag */ } },
};
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}
const app = document.getElementById('app')!;
function screen(...kids: Child[]) {
  stopCamera();
  if (!acc) document.body.classList.remove('met-onderbalk', 'lade-open');
  app.replaceChildren(...kids.filter(Boolean) as Node[]);
  window.scrollTo(0, 0);
}
function toast(msg: string, bad = false) {
  const t = h('div', { className: 'toast' + (bad ? ' bad' : ''), role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}
async function copy(text: string, what = 'Gekopieerd') {
  try { await navigator.clipboard.writeText(text); toast(what); } catch { toast('Kopiëren lukte niet', true); }
}
function qr(text: string) {
  const box = h('div', { className: 'qr', 'aria-label': 'QR-code' });
  box.innerHTML = encodeQR(text, 'svg', { ecc: 'medium', border: 2 });
  return box;
}
function field(label: string, input: HTMLElement, hint?: string) {
  return h('label', { className: 'field' }, h('span', {}, label), input, hint && h('small', {}, hint));
}
function busy(btn: HTMLButtonElement, on: boolean, text?: string) {
  btn.disabled = on;
  if (text) btn.textContent = text;
}
const short = (s: string) => s.slice(0, 10) + '…' + s.slice(-8);
// Mainnet via blockchain.com; testnet4 kent blockchain.com niet, daarvoor blijft mempool.space.
const explorer = (net: Net, txid: string) => net === 'main' ? `https://www.blockchain.com/explorer/transactions/btc/${txid}` : `https://mempool.space/testnet4/tx/${txid}`;

// ---------- toestand ----------
let meta: Meta = loadMeta();
let secret: Secret | null = null;
let acc: Account | null = null;
let snap: Snapshot | null = null;
let tab: 'home' | 'receive' | 'send' | 'addresses' | 'settings' = 'home';
let lockTimer = 0;
let stopCamera: () => void = () => {};

let apiCache: Esplora | null = null;
let apiKey = '';
function api() {
  const key = meta.net + '|' + meta.server;
  if (!apiCache || apiKey !== key) { apiCache = new Esplora(serversFor(meta.net, meta.server)); apiKey = key; }
  return apiCache;
}
function setMeta(p: Partial<Meta>) { meta = { ...meta, ...p }; saveMeta(meta); }

function lock() {
  secret = null; acc = null; snap = null;
  clearSession();
  clearTimeout(lockTimer);
  clearInterval(priceTimer);
  start();
}
function touch() {
  if (!acc) return;
  clearTimeout(lockTimer);
  lockTimer = window.setTimeout(lock, meta.lockMinutes * 60_000);
  extendSession(meta.lockMinutes);
}
['pointerdown', 'keydown'].forEach((e) => addEventListener(e, touch, { passive: true }));

async function askPassword(title: string): Promise<Secret | null> {
  const vault = loadVault();
  if (!vault) return null;
  return new Promise((resolve) => {
    const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const err = h('p', { className: 'error' });
    const ok = h('button', { className: 'primary', type: 'submit' }, 'Bevestigen');
    const dlg = h('dialog', {},
      h('form', {
        onsubmit: async (e: Event) => {
          e.preventDefault();
          busy(ok, true, 'Controleren…');
          try { const s = await open(vault, pw.value); dlg.close(); dlg.remove(); resolve(s); }
          catch { err.textContent = 'Onjuist wachtwoord'; busy(ok, false, 'Bevestigen'); }
        },
      },
        h('h2', {}, title), field('Wachtwoord', pw), err,
        h('div', { className: 'row' },
          h('button', { type: 'button', onclick: () => { dlg.close(); dlg.remove(); resolve(null); } }, 'Annuleren'), ok)));
    document.body.append(dlg);
    dlg.showModal();
    pw.focus();
  });
}

// ---------- start ----------
async function start() {
  meta = loadMeta();
  if (!loadVault()) { welcome(); return; }
  const s = await loadSession();
  if (s) enter(s, true); else unlockScreen();
}

function welcome() {
  screen(
    h('main', { className: 'center' },
      h('div', { className: 'logo', 'aria-hidden': 'true' }, '₿'),
      h('h1', {}, 'Wallet'),
      h('p', { className: 'lead' }, 'Een Bitcoin-wallet die volledig op dit apparaat draait. Geen account, geen e-mail, geen server die je sleutels kent.'),
      h('div', { className: 'stack' },
        h('button', { className: 'primary', onclick: () => createWallet() }, 'Nieuwe wallet maken'),
        h('button', { onclick: () => restoreWallet() }, 'Wallet herstellen met herstelzin')),
    ));
}

// ---------- nieuw ----------
function createWallet(len: 12 | 24 = 12, net: Net = 'main') {
  const mnemonic = newMnemonic(len);
  const list = mnemonic.split(' ');
  const done = h('input', { type: 'checkbox' });
  const next = h('button', { className: 'primary', disabled: true, onclick: () => verifyWords(mnemonic, net) }, 'Verder');
  done.addEventListener('change', () => (next.disabled = !done.checked));
  const lenSel = h('select', { onchange: (e: Event) => createWallet(Number((e.target as HTMLSelectElement).value) as 12 | 24, net) },
    h('option', { value: '12', selected: len === 12 }, '12 woorden'), h('option', { value: '24', selected: len === 24 }, '24 woorden'));
  const netSel = h('select', { onchange: (e: Event) => createWallet(len, (e.target as HTMLSelectElement).value as Net) },
    h('option', { value: 'main', selected: net === 'main' }, 'Bitcoin (echt geld)'), h('option', { value: 'test', selected: net === 'test' }, 'Testnet (oefengeld)'));
  screen(
    h('main', {},
      h('button', { className: 'link', onclick: welcome }, '← Terug'),
      h('h1', {}, 'Je herstelzin'),
      h('p', {}, 'Schrijf deze woorden op papier, in deze volgorde. Wie deze woorden heeft, heeft je bitcoin. Maak geen foto of screenshot en bewaar ze nooit online.'),
      h('ol', { className: 'words' }, ...list.map((w) => h('li', {}, w))),
      h('details', {}, h('summary', {}, 'Opties'), h('div', { className: 'stack' }, field('Lengte', lenSel), field('Netwerk', netSel))),
      h('label', { className: 'check' }, done, ' Ik heb de woorden opgeschreven'),
      next));
}

function verifyWords(mnemonic: string, net: Net) {
  const list = mnemonic.split(' ');
  const picks = [...crypto.getRandomValues(new Uint32Array(12))].map((x) => x % list.length)
    .filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).sort((a, b) => a - b);
  const inputs = picks.map(() => h('input', { autocomplete: 'off', autocapitalize: 'none', spellcheck: false, list: 'bip39' }));
  inputs.forEach((i) => i.setAttribute('list', 'bip39'));
  const err = h('p', { className: 'error' });
  screen(
    h('main', {},
      h('button', { className: 'link', onclick: () => createWallet(list.length as 12 | 24, net) }, '← Woorden opnieuw tonen'),
      h('h1', {}, 'Controle'),
      h('p', {}, 'Vul ter controle deze woorden in.'),
      wordList(),
      h('form', {
        className: 'stack',
        onsubmit: (e: Event) => {
          e.preventDefault();
          const ok = picks.every((p, i) => inputs[i].value.trim().toLowerCase() === list[p]);
          if (ok) setPassword({ mnemonic, passphrase: '' }, net, true);
          else err.textContent = 'Niet juist. Kijk nog eens op je papier.';
        },
      }, ...picks.map((p, i) => field(`Woord ${p + 1}`, inputs[i])), err, h('button', { className: 'primary' }, 'Controleren'))));
  inputs[0].focus();
}

function wordList() {
  return h('datalist', { id: 'bip39' }, ...words.map((w) => h('option', { value: w })));
}

// ---------- herstellen ----------
function restoreWallet() {
  const ta = h('textarea', { rows: 4, autocomplete: 'off', autocapitalize: 'none', spellcheck: false, placeholder: 'woord1 woord2 woord3 …' });
  const pass = h('input', { type: 'password', autocomplete: 'off' });
  const netSel = h('select', {}, h('option', { value: 'main' }, 'Bitcoin (echt geld)'), h('option', { value: 'test' }, 'Testnet (oefengeld)'));
  const err = h('p', { className: 'error' });
  screen(
    h('main', {},
      h('button', { className: 'link', onclick: welcome }, '← Terug'),
      h('h1', {}, 'Wallet herstellen'),
      h('form', {
        className: 'stack',
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (!isValidMnemonic(ta.value)) { err.textContent = 'Deze herstelzin klopt niet. Controleer spelling en volgorde (12 of 24 woorden).'; return; }
          setPassword({ mnemonic: normalizeMnemonic(ta.value), passphrase: pass.value }, netSel.value as Net, false);
        },
      },
        field('Herstelzin (12 of 24 woorden)', ta),
        h('details', {}, h('summary', {}, 'Geavanceerd'), h('div', { className: 'stack' },
          field('Extra wachtwoordzin (BIP39-passphrase)', pass, 'Alleen invullen als je die bij het aanmaken hebt gebruikt.'),
          field('Netwerk', netSel))),
        err, h('button', { className: 'primary' }, 'Verder'))));
  ta.focus();
}

// ---------- wachtwoord instellen ----------
function setPassword(s: Secret, net: Net, isNew: boolean) {
  const a = h('input', { type: 'password', autocomplete: 'new-password', minLength: 8, required: true });
  const b = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const pass = h('input', { type: 'password', autocomplete: 'off' });
  const err = h('p', { className: 'error' });
  const btn = h('button', { className: 'primary' }, 'Wallet openen');
  screen(
    h('main', {},
      h('h1', {}, 'Wachtwoord'),
      h('p', {}, 'Met dit wachtwoord wordt de wallet op dit apparaat versleuteld. Vergeet je het, dan herstel je de wallet met je herstelzin.'),
      h('form', {
        className: 'stack',
        onsubmit: async (e: Event) => {
          e.preventDefault();
          if (a.value.length < 8) { err.textContent = 'Minimaal 8 tekens.'; return; }
          if (a.value !== b.value) { err.textContent = 'De wachtwoorden zijn niet gelijk.'; return; }
          busy(btn, true, 'Versleutelen…');
          const secretFinal = isNew ? { ...s, passphrase: pass.value } : s;
          saveVault(await seal(secretFinal, a.value));
          meta = defaultMeta(net);
          saveMeta(meta);
          enter(secretFinal);
        },
      },
        field('Wachtwoord', a, 'Minimaal 8 tekens'), field('Herhaal wachtwoord', b),
        isNew && h('details', {}, h('summary', {}, 'Geavanceerd'),
          field('Extra wachtwoordzin (BIP39-passphrase)', pass, 'Optioneel. Maakt een andere wallet bij dezelfde woorden. Vergeet je hem, dan ben je alles kwijt.')),
        err, btn)));
  a.focus();
}

// ---------- ontgrendelen ----------
function unlockScreen() {
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { className: 'error' });
  const btn = h('button', { className: 'primary' }, 'Ontgrendelen');
  const wait = () => {
    const ms = meta.lockedUntil - Date.now();
    if (ms > 0) {
      busy(btn, true, `Wacht ${Math.ceil(ms / 1000)} s`);
      setTimeout(wait, 1000);
    } else busy(btn, false, 'Ontgrendelen');
  };
  screen(
    h('main', { className: 'center' },
      h('div', { className: 'logo', 'aria-hidden': 'true' }, '₿'),
      h('h1', {}, 'Wallet'),
      h('form', {
        className: 'stack',
        onsubmit: async (e: Event) => {
          e.preventDefault();
          if (meta.lockedUntil > Date.now()) return;
          busy(btn, true, 'Openen…');
          try {
            const s = await open(loadVault()!, pw.value);
            setMeta({ fails: 0, lockedUntil: 0 });
            enter(s);
          } catch {
            const fails = meta.fails + 1;
            setMeta({ fails, lockedUntil: Date.now() + lockoutMs(fails) });
            err.textContent = `Onjuist wachtwoord (${fails}×).`;
            pw.value = '';
            wait();
          }
        },
      }, field('Wachtwoord', pw), err, btn),
      h('button', { className: 'link', onclick: forgot }, 'Wachtwoord vergeten?')));
  wait();
  pw.focus();
}

function forgot() {
  if (confirm('Zonder wachtwoord kun je deze kluis niet openen. Je kunt de wallet van dit apparaat wissen en herstellen met je herstelzin. Heb je je herstelzin niet, dan ben je je bitcoin kwijt.\n\nWallet nu van dit apparaat wissen?')) {
    wipe(); clearSession(); start();
  }
}

// ---------- hoofdscherm ----------
function enter(s: Secret, resumed = false) {
  secret = s;
  acc = new Account(s.mnemonic, s.passphrase, meta.net);
  if (!resumed) saveSession(s, meta.lockMinutes);
  const saved = store.get('wallet.tab');
  tab = resumed && saved && NAV.some((n) => n.key === saved) ? saved as Tab : 'home';
  touch();
  render();
  refresh();
  startMarket();
}

let syncing = false;
async function refresh() {
  if (!acc || syncing) return;
  syncing = true;
  render();
  try {
    const a = acc;
    const result = await scan(a, api(), meta.issued, (n) => { const el = document.getElementById('sync'); if (el) el.textContent = `Bijwerken… ${n} adressen`; });
    if (acc !== a) return;
    snap = result;
    if (meta.issued < snap.next[0]) setMeta({ issued: snap.next[0] });
  } catch (e) {
    toast('Bijwerken mislukt: ' + (e as Error).message, true);
  } finally {
    syncing = false;
    if (acc) render();
  }
}

function receiveIndex(): number {
  // Eerstvolgende ongebruikte ontvangstadres, of het laatst zelf aangemaakte adres.
  const next = snap?.next[0] ?? 0;
  return Math.max(next, meta.issued - 1, 0);
}

type Tab = 'home' | 'receive' | 'send' | 'addresses' | 'settings';
const NAV: { key: Tab; label: string; icon: string }[] = [
  { key: 'home', label: 'Overzicht', icon: 'home' },
  { key: 'receive', label: 'Ontvangen', icon: 'inbox' },
  { key: 'send', label: 'Versturen', icon: 'send' },
  { key: 'addresses', label: 'Adressen', icon: 'list' },
  { key: 'settings', label: 'Instellingen', icon: 'settings' },
];
const TITLES: Record<Tab, string> = { home: 'Overzicht', receive: 'Ontvangen', send: 'Versturen', addresses: 'Adressen', settings: 'Instellingen' };

function go(k: Tab) { tab = k; store.set('wallet.tab', k); closeDrawer(); render(); }
function setDrawer(open: boolean) {
  document.body.classList.toggle('lade-open', open);
  document.getElementById('menu-btn')?.setAttribute('aria-expanded', String(open));
  if (open) document.querySelector<HTMLElement>('#drawer .nav-link[aria-current="page"]')?.focus();
}
function closeDrawer() { setDrawer(false); }
addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('lade-open')) { closeDrawer(); document.getElementById('menu-btn')?.focus(); } });

function brand() {
  return h('div', { className: 'brand' },
    h('span', { className: 'brand-mark', 'aria-hidden': 'true' }, '₿'),
    h('span', { className: 'brand-text' }, h('strong', {}, 'Wallet'), h('small', {}, meta.net === 'main' ? 'Bitcoin' : 'Testnet4')));
}

function navLink(n: (typeof NAV)[number]) {
  return h('button', { className: 'nav-link', 'aria-current': tab === n.key ? 'page' : null, title: n.label, onclick: () => go(n.key) },
    icon(n.icon), h('span', { className: 'nav-label' }, n.label));
}

function render() {
  if (!acc) return;
  const body = tab === 'home' ? homeView() : tab === 'receive' ? receiveView() : tab === 'send' ? sendView()
    : tab === 'addresses' ? addressesView() : settingsView();
  if (store.get('sidebar') === 'in') document.documentElement.classList.add('collapsed');
  document.body.classList.add('met-onderbalk');
  const side = h('aside', { id: 'drawer', className: 'sidebar', 'aria-label': 'Menu' },
    h('div', { className: 'side-head' },
      brand(),
      h('button', { className: 'icon-btn drawer-close', 'aria-label': 'Menu sluiten', onclick: closeDrawer }, icon('x'))),
    h('button', {
      id: 'collapse', className: 'nav-link collapse-btn', title: 'Menu inklappen',
      onclick: () => {
        const c = document.documentElement.classList.toggle('collapsed');
        store.set('sidebar', c ? 'in' : 'uit');
      },
    }, icon('sidebar'), h('span', { className: 'nav-label' }, 'Menu inklappen')),
    h('nav', { className: 'nav-group' }, h('div', { className: 'overline' }, 'Wallet'), ...NAV.slice(0, 4).map(navLink)),
    h('nav', { className: 'nav-group' }, h('div', { className: 'overline' }, 'Beheer'), navLink(NAV[4])),
    h('div', { className: 'side-foot' },
      meta.net === 'test' && h('span', { className: 'badge warn' }, 'testnet'),
      h('button', { className: 'nav-link', onclick: lock }, icon('lock'), h('span', { className: 'nav-label' }, 'Vergrendelen'))));
  screen(
    h('div', { className: 'shell' },
      side,
      h('div', { className: 'scrim', onclick: closeDrawer }),
      h('div', { className: 'content' },
        h('header', { className: 'topbar' },
          brand(),
          h('div', { className: 'topbar-actions' },
            h('button', { className: 'icon-btn', 'aria-label': 'Vergrendelen', onclick: lock }, icon('lock')),
            h('button', { id: 'menu-btn', className: 'icon-btn', 'aria-label': 'Menu openen', 'aria-controls': 'drawer', 'aria-expanded': 'false', onclick: () => setDrawer(true) }, icon('menu')))),
        h('main', { id: 'main' }, h('h1', { className: 'page-title' }, TITLES[tab]), body))),
    h('nav', { className: 'bottombar', 'aria-label': 'Snelmenu' },
      ...NAV.map((n) => h('button', { className: 'bottom-link', 'aria-current': tab === n.key ? 'page' : null, onclick: () => go(n.key) },
        icon(n.icon), h('span', {}, n.label)))));
}

// ---------- koers (Bitvavo) ----------
let price: number | null = null;
let history: Point[] = [];
let range: Range = ([6, 12, 24] as const).find((r) => String(r) === store.get('koers')) ?? 24;
let priceTimer = 0;
let marketError = '';

async function loadMarket(withHistory = true) {
  try {
    const [p, hist] = await Promise.all([fetchPrice(), withHistory ? fetchHistory(range) : Promise.resolve(history)]);
    price = p;
    history = hist;
    marketError = '';
  } catch (e) {
    marketError = 'Koers niet beschikbaar: ' + (e as Error).message;
  }
  updateMarket();
}
function startMarket() {
  clearInterval(priceTimer);
  loadMarket();
  // Elke minuut de koers, elke 5 minuten ook de grafiek.
  let n = 0;
  priceTimer = window.setInterval(() => { if (acc && tab === 'home') loadMarket(++n % 5 === 0); }, 60_000);
}
function updateMarket() {
  document.getElementById('market')?.replaceWith(marketCard());
  document.getElementById('balance-eur')?.replaceWith(balanceEur());
  if (price) document.querySelectorAll<HTMLElement>('[data-sats]').forEach((el) => { el.textContent = formatEur(satsToEur(Number(el.dataset.sats), price!)); });
}

function balanceEur() {
  const total = (snap?.confirmed ?? 0) + (snap?.pending ?? 0);
  const text = meta.net !== 'main' ? 'Testnet-munten hebben geen waarde'
    : !snap ? '' : price ? '≈ ' + formatEur(satsToEur(total, price)) : 'Eurowaarde laden…';
  return h('div', { id: 'balance-eur', className: 'eur' }, text);
}

function balance() {
  const c = snap?.confirmed ?? 0, p = snap?.pending ?? 0;
  return h('section', { className: 'balance' },
    h('div', { className: 'overline' }, 'Saldo'),
    h('div', { className: 'amount' }, snap ? formatBtc(c + p) : '–', h('span', {}, ' BTC')),
    balanceEur(),
    h('div', { className: 'muted small' }, snap ? `${formatSats(c + p)} sats` : 'Nog niet bijgewerkt',
      p !== 0 && ` · ${formatBtc(p)} onbevestigd`),
    h('button', { id: 'sync', className: 'btn-secondary sm', disabled: syncing, onclick: refresh }, icon('refresh', 'sm'), syncing ? 'Bijwerken…' : 'Bijwerken'));
}

function marketCard() {
  const first = history[0]?.p;
  const now = price ?? history.at(-1)?.p;
  const diff = first && now ? now - first : null;
  const pct = diff != null && first ? (diff / first) * 100 : null;
  const up = (diff ?? 0) >= 0;
  const seg = h('div', { className: 'segment', role: 'group', 'aria-label': 'Periode' },
    ...([6, 12, 24] as const).map((r) => h('button', {
      type: 'button', className: 'seg', 'aria-pressed': String(range === r),
      onclick: () => { range = r; store.set('koers', String(r)); updateMarket(); loadMarket(); },
    }, `${r} uur`)));
  return h('section', { id: 'market', className: 'card market' },
    h('div', { className: 'market-head' },
      h('div', {},
        h('div', { className: 'overline' }, 'Koers bitcoin'),
        h('div', { className: 'price' }, now ? formatEur(now) : '–'),
        pct != null && h('div', { className: 'change ' + (up ? 'up' : 'down') },
          h('span', { 'aria-hidden': 'true' }, up ? '▲ ' : '▼ '),
          `${up ? '+' : '−'}${formatEur(Math.abs(diff!))} (${up ? '+' : '−'}${Math.abs(pct).toLocaleString('nl-NL', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%)`,
          h('span', { className: 'muted' }, ` in ${range} uur`))),
      seg),
    marketError ? h('p', { className: 'error' }, marketError)
      : history.length > 1 ? chart(history) : h('div', { className: 'chart-empty muted' }, 'Grafiek laden…'),
    h('p', { className: 'small' }, 'Bron: Bitvavo (BTC-EUR)'));
}

function chart(pts: Point[]) {
  const W = 600, H = 200;
  const ps = pts.map((x) => x.p);
  const lo = Math.min(...ps), hi = Math.max(...ps);
  const pad = (hi - lo) * 0.08 || hi * 0.001;
  const y0 = lo - pad, y1 = hi + pad;
  const t0 = pts[0].t, t1 = pts.at(-1)!.t;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const y = (p: number) => H - ((p - y0) / (y1 - y0)) * H;
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${x(q.t).toFixed(1)},${y(q.p).toFixed(1)}`).join('');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const mk = (tag: string, a: Record<string, string>) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); svg.append(e); return e; };
  for (const f of [0.25, 0.5, 0.75]) mk('line', { x1: '0', x2: String(W), y1: String(H * f), y2: String(H * f), class: 'grid' });
  mk('path', { d: d + `L${W},${H}L0,${H}Z`, class: 'area' });
  mk('path', { d, class: 'line' });
  const cross = mk('line', { x1: '0', x2: '0', y1: '0', y2: String(H), class: 'cross', visibility: 'hidden' });
  const dot = h('div', { className: 'dot', hidden: true });
  const tip = h('div', { className: 'tip', hidden: true });
  const time = (t: number) => new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  const plot = h('div', { className: 'plot' }, svg, dot, tip,
    h('span', { className: 'axis-y hi' }, formatEur(hi, true)),
    h('span', { className: 'axis-y lo' }, formatEur(lo, true)));
  const show = (clientX: number) => {
    const r = plot.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const tt = t0 + fx * (t1 - t0);
    let best = pts[0];
    for (const q of pts) if (Math.abs(q.t - tt) < Math.abs(best.t - tt)) best = q;
    const px = x(best.t) / W * 100, py = y(best.p) / H * 100;
    cross.setAttribute('x1', String(x(best.t))); cross.setAttribute('x2', String(x(best.t))); cross.setAttribute('visibility', 'visible');
    dot.hidden = false; dot.style.left = px + '%'; dot.style.top = py + '%';
    tip.hidden = false; tip.textContent = `${time(best.t)} · ${formatEur(best.p)}`;
    tip.style.left = Math.min(Math.max(px, 18), 82) + '%';
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); dot.hidden = true; tip.hidden = true; };
  plot.addEventListener('pointermove', (e) => show(e.clientX));
  plot.addEventListener('pointerdown', (e) => show(e.clientX));
  plot.addEventListener('pointerleave', hide);
  const table = h('details', { className: 'table-view' }, h('summary', {}, 'Toon als tabel'),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Tijd'), h('th', {}, 'Koers'))),
      h('tbody', {}, ...pts.filter((_, i) => i % Math.ceil(pts.length / 12) === 0 || i === pts.length - 1)
        .map((q) => h('tr', {}, h('td', {}, time(q.t)), h('td', {}, formatEur(q.p)))))));
  return h('div', { className: 'chart', role: 'img', 'aria-label': `Koers van ${formatEur(pts[0].p)} naar ${formatEur(pts.at(-1)!.p)} in ${range} uur` },
    plot,
    h('div', { className: 'axis-x' }, h('span', {}, time(t0)), h('span', {}, time(t0 + (t1 - t0) / 2)), h('span', {}, 'nu')),
    table);
}

// ---------- koers op het moment van de transactie ----------
const priceAtTx = new Map<string, number | null>();
let loadingTxPrices = false;
const txDate = (sec: number) => new Date(sec * 1000).toLocaleString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function txThen(txid: string, sats: number): string {
  if (!priceAtTx.has(txid)) return 'Koers toen laden…';
  const p = priceAtTx.get(txid);
  return p ? `Koers toen ${formatEur(p, true)} · waarde toen ${formatEur(satsToEur(sats, p))}` : 'Koers toen onbekend';
}
async function loadTxPrices() {
  if (loadingTxPrices || meta.net !== 'main' || !snap) return;
  loadingTxPrices = true;
  try {
    for (const t of snap.history) {
      if (priceAtTx.has(t.txid) || !t.time) continue; // onbevestigd: nog geen moment bekend
      try { priceAtTx.set(t.txid, await fetchPriceAt(t.time)); } catch { continue; }
      const el = document.querySelector<HTMLElement>(`[data-tx="${t.txid}"]`);
      if (el) el.textContent = txThen(t.txid, Math.abs(t.delta));
    }
  } finally { loadingTxPrices = false; }
}

function homeView() {
  queueMicrotask(loadTxPrices);
  const items = snap?.history ?? [];
  return h('div', {},
    balance(),
    marketCard(),
    h('div', { className: 'row' },
      h('button', { className: 'primary', onclick: () => go('receive') }, 'Ontvangen'),
      h('button', { className: 'primary', onclick: () => go('send') }, 'Versturen')),
    h('h2', {}, 'Transacties'),
    items.length ? h('ul', { className: 'list' }, ...items.map((t) => {
      const abs = Math.abs(t.delta);
      const main = meta.net === 'main';
      return h('li', {},
        h('a', { href: explorer(meta.net, t.txid), target: '_blank', rel: 'noopener noreferrer' },
          h('span', { className: 'tx-top' },
            h('span', { className: t.delta >= 0 ? 'in' : 'out' }, (t.delta >= 0 ? '+' : '') + formatBtc(t.delta) + ' BTC'),
            main && h('span', { className: 'muted small', 'data-sats': String(abs), title: 'Waarde nu' }, price ? formatEur(satsToEur(abs, price)) : '')),
          h('span', { className: 'tx-date' }, t.confirmed && t.time ? txDate(t.time) : t.confirmed ? `Blok ${t.height}` : 'Onbevestigd'),
          main && !!t.time && h('span', { className: 'tx-then', 'data-tx': t.txid }, txThen(t.txid, abs)),
          h('small', {}, short(t.txid))));
    }))
      : h('p', { className: 'muted' }, snap ? 'Nog geen transacties.' : 'Druk op Bijwerken om saldo en transacties op te halen.'));
}

function receiveView() {
  const a = acc!;
  const idx = receiveIndex();
  const address = a.address(0, idx);
  const amt = h('input', { inputMode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
  const code = h('div', {}, qr(address));
  const uriText = h('code', { className: 'addr' }, address);
  amt.addEventListener('input', () => {
    let amount: bigint | undefined;
    try { amount = amt.value ? parseBtc(amt.value) : undefined; } catch { return; }
    const uri = amount ? makeUri(address, amount) : address;
    code.replaceChildren(qr(amount ? uri : address));
    uriText.textContent = uri;
  });
  const used = snap?.addresses.find((x) => x.chain === 0 && x.index === idx)?.used;
  return h('div', { className: 'stack' },
    h('p', { className: 'muted' }, `Adres #${idx + 1} · ${a.path(0, idx)}`, used && ' · al gebruikt'),
    code, uriText,
    h('div', { className: 'row' },
      h('button', { onclick: () => copy(uriText.textContent!, 'Adres gekopieerd') }, 'Kopiëren'),
      h('button', { onclick: newAddress }, 'Nieuw adres')),
    field('Bedrag aanvragen (optioneel, BTC)', amt),
    h('p', { className: 'muted' }, 'Gebruik voor elke betaling een nieuw adres. Dat is beter voor je privacy. Alle adressen horen bij dezelfde herstelzin.'));
}

function newAddress() {
  // Maximaal 20 ongebruikte adressen vooruit (gap limit), zodat elke andere wallet ze bij herstel ook vindt.
  const current = receiveIndex();
  if (current - (snap?.next[0] ?? 0) + 1 >= 20) { toast('Er staan al 20 ongebruikte adressen klaar. Gebruik eerst een daarvan.', true); return; }
  setMeta({ issued: current + 2 });
  render();
  toast('Nieuw adres aangemaakt');
}

// ---------- versturen ----------
function sendView() {
  const a = acc!;
  const to = h('input', { autocomplete: 'off', autocapitalize: 'none', spellcheck: false, placeholder: meta.net === 'main' ? 'bc1…' : 'tb1…' });
  const amt = h('input', { inputMode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
  const max = h('input', { type: 'checkbox' });
  const fee = h('select', {});
  const custom = h('input', { type: 'number', min: 1, step: 1, value: 5, hidden: true });
  const err = h('p', { className: 'error' });
  const video = h('video', { className: 'scan', hidden: true, muted: true });
  const btn = h('button', { className: 'primary' }, 'Controleren');
  const available = (snap?.confirmed ?? 0) + (snap?.pending ?? 0);
  max.addEventListener('change', () => { amt.disabled = max.checked; if (max.checked) amt.value = ''; });
  fee.addEventListener('change', () => (custom.hidden = fee.value !== 'custom'));

  const fill = (text: string) => {
    try {
      const p = parseUri(text);
      to.value = p.address;
      if (p.amount) { amt.value = formatBtc(p.amount); max.checked = false; amt.disabled = false; }
    } catch { to.value = text.trim(); }
  };

  api().fees().then((f) => {
    const opt = (label: string, rate: number) => h('option', { value: String(rate) }, `${label} · ${Math.ceil(rate)} sat/vB`);
    fee.replaceChildren(opt('Snel (±10 min)', f['1'] ?? f['2'] ?? 10), opt('Normaal (±30 min)', f['3'] ?? 5), opt('Zuinig (±1 uur)', f['6'] ?? 3), opt('Goedkoop (±1 dag)', f['144'] ?? 1),
      h('option', { value: 'custom' }, 'Eigen tarief'));
    fee.selectedIndex = 1;
  }).catch(() => {
    fee.replaceChildren(h('option', { value: 'custom' }, 'Eigen tarief'));
    custom.hidden = false;
  });

  return h('div', {},
    !snap && h('p', { className: 'muted' }, 'Saldo is nog niet bijgewerkt.'),
    snap && h('p', { className: 'muted' }, `Beschikbaar: ${formatBtc(available)} BTC`),
    h('form', {
      className: 'stack',
      onsubmit: (e: Event) => {
        e.preventDefault();
        err.textContent = '';
        try {
          if (!snap) throw new Error('Werk eerst het saldo bij.');
          const dest = to.value.trim();
          if (!isAddress(dest, a.net)) throw new Error(meta.net === 'main' ? 'Ongeldig Bitcoin-adres.' : 'Ongeldig testnet-adres.');
          const rate = fee.value === 'custom' ? Number(custom.value) : Number(fee.value);
          if (!(rate >= 1)) throw new Error('Kies een geldig tarief (minimaal 1 sat/vB).');
          const amount = max.checked ? 'max' : parseBtc(amt.value);
          if (amount !== 'max' && amount < 546n) throw new Error('Bedrag is te klein (minimaal 546 sats).');
          const changeIdx = snap.next[1];
          const draft = buildTx(a, snap.coins, dest, amount, rate, changeIdx);
          confirmSend(draft, dest, rate);
        } catch (x) { err.textContent = (x as Error).message; }
      },
    },
      field('Naar adres', to),
      h('div', { className: 'row' },
        h('button', { type: 'button', onclick: async () => { try { fill(await navigator.clipboard.readText()); } catch { toast('Plakken lukte niet', true); } } }, 'Plakken'),
        h('button', {
          type: 'button',
          onclick: async () => {
            try {
              video.hidden = false;
              stopCamera = await startScan(video, (t) => { video.hidden = true; fill(t); });
            } catch { video.hidden = true; toast('Camera niet beschikbaar', true); }
          },
        }, 'QR scannen')),
      video,
      field('Bedrag (BTC)', amt),
      h('label', { className: 'check' }, max, ' Alles versturen'),
      field('Transactiekosten', fee), custom,
      err, btn));
}

function confirmSend(d: Draft, to: string, rate: number) {
  const send = h('button', { className: 'primary' }, 'Nu versturen');
  const dlg = h('dialog', {},
    h('h2', {}, 'Klopt dit?'),
    h('dl', { className: 'summary' },
      h('dt', {}, 'Naar'), h('dd', {}, h('code', { className: 'addr' }, to)),
      h('dt', {}, 'Bedrag'), h('dd', {}, `${formatBtc(d.amount)} BTC`),
      h('dt', {}, 'Kosten'), h('dd', {}, `${formatBtc(d.fee)} BTC (${formatSats(d.fee)} sats, ${rate} sat/vB)`),
      h('dt', {}, 'Totaal'), h('dd', {}, h('strong', {}, `${formatBtc(d.amount + d.fee)} BTC`)),
      d.change > 0n && h('dt', {}, 'Wisselgeld'), d.change > 0n && h('dd', {}, `${formatBtc(d.change)} BTC terug naar jezelf`)),
    h('p', { className: 'muted' }, 'Een Bitcoin-transactie kan niet worden teruggedraaid.'),
    h('div', { className: 'row' },
      h('button', { onclick: () => { dlg.close(); dlg.remove(); } }, 'Annuleren'),
      send));
  send.addEventListener('click', async () => {
    busy(send, true, 'Versturen…');
    try {
      const txid = await api().broadcast(d.tx.hex);
      dlg.close(); dlg.remove();
      sentScreen(txid);
      setTimeout(refresh, 1500);
    } catch (e) {
      toast((e as Error).message, true);
      busy(send, false, 'Nu versturen');
    }
  });
  document.body.append(dlg);
  dlg.showModal();
}

function sentScreen(txid: string) {
  tab = 'home';
  screen(h('main', { className: 'center' },
    h('div', { className: 'logo', 'aria-hidden': 'true' }, '✓'),
    h('h1', {}, 'Verstuurd'),
    h('p', {}, h('a', { href: explorer(meta.net, txid), target: '_blank', rel: 'noopener noreferrer' }, 'Bekijk transactie ', short(txid))),
    h('button', { className: 'primary', onclick: render }, 'Terug naar overzicht')));
}

// ---------- adressen ----------
function addressesView() {
  const a = acc!;
  const list = snap?.addresses ?? Array.from({ length: Math.max(meta.issued, 1) }, (_, i) => ({ chain: 0 as const, index: i, address: a.address(0, i), used: false }));
  const balances = new Map<string, number>();
  for (const c of snap?.coins ?? []) { const k = a.address(c.chain, c.index); balances.set(k, (balances.get(k) ?? 0) + c.value); }
  const shown = list.filter((x) => x.used || (x.chain === 0 && x.index <= receiveIndex()));
  return h('div', {},
    h('p', { className: 'muted' }, 'Alle adressen komen uit je herstelzin (BIP84, Native SegWit). Wisseladressen ontvangen het wisselgeld van je eigen betalingen.'),
    h('ul', { className: 'list' }, ...shown.map((x) =>
      h('li', {},
        h('div', { className: 'addrrow' },
          h('div', {},
            h('small', {}, (x.chain === 0 ? 'Ontvangen' : 'Wissel') + ` #${x.index + 1}`, x.used ? ' · gebruikt' : ' · ongebruikt',
              balances.get(x.address) ? ` · ${formatBtc(balances.get(x.address)!)} BTC` : ''),
            h('code', { className: 'addr' }, x.address)),
          h('div', { className: 'row tight' },
            h('button', { onclick: () => copy(x.address, 'Adres gekopieerd') }, 'Kopiëren'),
            h('button', { onclick: () => showKey(x.chain, x.index) }, 'Sleutel')))))));
}

async function showKey(chain: 0 | 1, index: number) {
  if (!(await askPassword('Privésleutel tonen'))) return;
  const a = acc!;
  const wif = a.wif(chain, index);
  const pub = Array.from(a.key(chain, index).publicKey!, (b) => b.toString(16).padStart(2, '0')).join('');
  const dlg = h('dialog', {},
    h('h2', {}, 'Sleutels van dit adres'),
    h('p', { className: 'warn' }, 'Iedereen met de privésleutel kan het geld op dit adres uitgeven. Deel hem nooit.'),
    h('dl', { className: 'summary' },
      h('dt', {}, 'Adres'), h('dd', {}, h('code', { className: 'addr' }, a.address(chain, index))),
      h('dt', {}, 'Pad'), h('dd', {}, a.path(chain, index)),
      h('dt', {}, 'Publieke sleutel'), h('dd', {}, h('code', { className: 'addr' }, pub)),
      h('dt', {}, 'Privésleutel (WIF)'), h('dd', {}, h('code', { className: 'addr secret' }, wif))),
    h('div', { className: 'row' },
      h('button', { onclick: () => copy(wif, 'Privésleutel gekopieerd') }, 'Kopiëren'),
      h('button', { className: 'primary', onclick: () => { dlg.close(); dlg.remove(); } }, 'Sluiten')));
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- instellingen ----------
function settingsView() {
  const a = acc!;
  const server = h('input', { type: 'url', value: meta.server, autocomplete: 'off', spellcheck: false });
  const lockSel = h('select', {}, ...[1, 5, 15, 30, 60, 240, 1440].map((m) => h('option', { value: String(m), selected: meta.lockMinutes === m }, m < 60 ? `${m} min` : m === 1440 ? '1 dag' : `${m / 60} uur`)));
  lockSel.addEventListener('change', () => { setMeta({ lockMinutes: Number(lockSel.value) }); touch(); toast('Opgeslagen'); });
  return h('div', { className: 'stack' },

    h('section', { className: 'card stack' },
      h('h3', {}, 'Herstelzin'),
      h('p', { className: 'muted' }, 'Je enige back-up. Met deze woorden herstel je de wallet op elk apparaat.'),
      h('button', { onclick: showSeed }, 'Herstelzin tonen')),

    h('section', { className: 'card stack' },
      h('h3', {}, 'Publieke sleutel (alleen kijken)'),
      h('p', { className: 'muted' }, 'Hiermee kan een andere app je saldo zien, maar niets uitgeven. Deel hem toch zo min mogelijk: hij verraadt al je adressen.'),
      h('code', { className: 'addr' }, a.extendedPublic()),
      h('button', { onclick: () => copy(a.extendedPublic()) }, 'Kopiëren')),

    h('section', { className: 'card stack' },
      h('h3', {}, 'Server'),
      h('p', { className: 'muted' }, 'Voor saldo en versturen vraagt de app een Esplora-server naar je adressen. Je sleutels gaan nooit naar de server. Voor de meeste privacy gebruik je je eigen node (bijvoorbeeld mempool of Esplora op een Umbrel/Start9).'),
      field('Esplora-adres', server),
      h('div', { className: 'row' },
        h('button', { onclick: () => { server.value = DEFAULT_SERVER[meta.net]; } }, 'Standaard'),
        h('button', {
          className: 'primary',
          onclick: async () => {
            const url = server.value.trim().replace(/\/+$/, '');
            if (!/^https:\/\//.test(url)) { toast('Gebruik een https-adres', true); return; }
            try { await new Esplora(url).tipHeight(); setMeta({ server: url }); toast('Server opgeslagen'); }
            catch { toast('Server niet bereikbaar', true); }
          },
        }, 'Opslaan'))),

    h('section', { className: 'card stack' },
      h('h3', {}, 'Beveiliging'),
      field('Automatisch vergrendelen na', lockSel),
      h('button', { onclick: changePassword }, 'Wachtwoord wijzigen')),

    h('section', { className: 'card stack danger' },
      h('h3', {}, 'Wallet wissen'),
      h('p', { className: 'muted' }, 'Verwijdert de wallet van dit apparaat. Je bitcoin blijft bestaan en is terug te halen met je herstelzin.'),
      h('button', { className: 'bad', onclick: wipeWallet }, 'Wallet van dit apparaat wissen')),

    h('p', { className: 'muted small' }, `Netwerk: ${meta.net === 'main' ? 'Bitcoin mainnet' : 'Testnet4'} · Pad m/84'/${meta.net === 'main' ? 0 : 1}'/0'`));
}

async function showSeed() {
  const s = await askPassword('Herstelzin tonen');
  if (!s) return;
  const dlg = h('dialog', {},
    h('h2', {}, 'Herstelzin'),
    h('p', { className: 'warn' }, 'Zorg dat niemand meekijkt. Maak geen screenshot.'),
    h('ol', { className: 'words' }, ...s.mnemonic.split(' ').map((w) => h('li', {}, w))),
    s.passphrase && h('p', {}, 'Let op: deze wallet gebruikt ook een extra wachtwoordzin.'),
    h('button', { className: 'primary', onclick: () => { dlg.close(); dlg.remove(); } }, 'Sluiten'));
  document.body.append(dlg);
  dlg.showModal();
}

async function changePassword() {
  const s = await askPassword('Huidig wachtwoord');
  if (!s) return;
  const a = h('input', { type: 'password', autocomplete: 'new-password' });
  const b = h('input', { type: 'password', autocomplete: 'new-password' });
  const err = h('p', { className: 'error' });
  const ok = h('button', { className: 'primary' }, 'Opslaan');
  const dlg = h('dialog', {},
    h('form', {
      className: 'stack',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        if (a.value.length < 8) { err.textContent = 'Minimaal 8 tekens.'; return; }
        if (a.value !== b.value) { err.textContent = 'De wachtwoorden zijn niet gelijk.'; return; }
        busy(ok, true, 'Versleutelen…');
        saveVault(await seal(s, a.value));
        dlg.close(); dlg.remove();
        toast('Wachtwoord gewijzigd');
      },
    },
      h('h2', {}, 'Nieuw wachtwoord'), field('Nieuw wachtwoord', a), field('Herhaal', b), err,
      h('div', { className: 'row' }, h('button', { type: 'button', onclick: () => { dlg.close(); dlg.remove(); } }, 'Annuleren'), ok)));
  document.body.append(dlg);
  dlg.showModal();
}

async function wipeWallet() {
  if (!(await askPassword('Wallet wissen'))) return;
  const word = prompt('Typ WISSEN om de wallet van dit apparaat te verwijderen. Zonder herstelzin ben je je bitcoin kwijt.');
  if (word?.trim().toUpperCase() !== 'WISSEN') return;
  wipe();
  clearSession();
  secret = null; acc = null; snap = null;
  start();
}

void secret;
start();
