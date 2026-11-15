// App-schil: router, bovenbalk, onderste menu, automatisch vergrendelen en thema.

import * as session from '../app/session.ts';
import { $, html, setHtml, type Raw } from './dom.ts';
import { icon } from './icons.ts';

export type NavKey = 'home' | 'receive' | 'send' | 'settings';

export interface Screen {
  /** 'auth' = gecentreerde kaart zonder menu; 'app' = bovenbalk en onderste menu. */
  shell: 'auth' | 'app';
  nav?: NavKey;
  /** Mag zonder ontgrendelde wallet (onboarding en ontgrendelen). */
  public?: boolean;
  render(root: HTMLElement, param: string): void | Promise<void>;
  /** Wordt aangeroepen bij het verlaten van het scherm (opruimen, privacy-scherm uit). */
  leave?(): void;
}

const routes = new Map<string, Screen>();
let current: Screen | null = null;
let rendering = 0;

export function route(path: string, screen: Screen): void {
  routes.set(path, screen);
}

export function go(path: string): void {
  if (location.hash === `#${path}`) void render();
  else location.hash = path;
}

function parse(): { path: string; param: string } {
  const h = location.hash.replace(/^#/, '') || '/';
  const [, a = '', b = ''] = h.split('/');
  return { path: `/${a}`, param: decodeURIComponent(b) };
}

const NAV: { key: NavKey; path: string; label: string; ico: string }[] = [
  { key: 'home', path: '/home', label: 'Home', ico: 'home' },
  { key: 'receive', path: '/ontvangen', label: 'Ontvangen', ico: 'receive' },
  { key: 'send', path: '/versturen', label: 'Versturen', ico: 'send' },
  { key: 'settings', path: '/instellingen', label: 'Instellingen', ico: 'settings' },
];

async function shell(screen: Screen): Promise<HTMLElement> {
  const app = $('#app');
  document.body.className = screen.shell === 'auth' ? 'auth' : 'with-nav';
  if (screen.shell === 'auth') {
    setHtml(app, html`<main id="main" class="auth-main"></main>`);
    return $<HTMLElement>('#main');
  }
  const { net } = await session.settings();
  setHtml(
    app,
    html`<header class="topbar">
        <a class="brand" href="#/home"><span class="logo" aria-hidden="true">₿</span><span class="brand-name">Wallet</span></a>
        ${net === 'test' ? html`<span class="badge warn">Testnet</span>` : ''}
        <button class="btn btn-ghost btn-icon" id="lock" aria-label="Vergrendelen" title="Vergrendelen">${icon('lock')}</button>
      </header>
      <main id="main" class="main"></main>
      <nav class="bottom-nav" aria-label="Hoofdmenu">
        ${NAV.map((n) => html`<a href="#${n.path}" ${screen.nav === n.key ? html`aria-current="page"` : ''}>${icon(n.ico)}<span>${n.label}</span></a>`)}
      </nav>`,
  );
  $('#lock').onclick = () => session.lock();
  return $<HTMLElement>('#main');
}

export async function render(): Promise<void> {
  const id = ++rendering;
  const { path, param } = parse();
  const exists = await session.hasWallet();
  let target = path;

  if (!exists) {
    if (!routes.get(path)?.public || path === '/ontgrendelen') target = '/welkom';
  } else if (!session.isUnlocked()) {
    target = '/ontgrendelen';
  } else if (routes.get(path)?.public || !routes.has(path)) {
    target = '/home';
  }
  if (target !== path) {
    history.replaceState(null, '', `#${target}`);
    return render();
  }
  if (id !== rendering) return;

  current?.leave?.();
  const screen = routes.get(target)!;
  current = screen;
  const root = await shell(screen);
  await screen.render(root, param);
  root.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/** Paginakop met optionele terug-link en knoppen rechts. */
export function header(title: string, sub?: string, back?: { href: string; label: string }, actions?: Raw): Raw {
  return html`${back ? html`<a class="back-link" href="#${back.href}">${icon('chevron-left', 'sm')}${back.label}</a>` : ''}
    <div class="page-header"><div><h1>${title}</h1>${sub ? html`<p class="sub">${sub}</p>` : ''}</div>${actions ?? ''}</div>`;
}

// ---- Thema (licht/donker/automatisch, alleen in deze browser) ----

export type Theme = 'auto' | 'light' | 'dark';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function setTheme(t: Theme): void {
  try {
    if (t === 'auto') localStorage.removeItem('theme');
    else localStorage.setItem('theme', t);
  } catch {
    /* geen opslag: alleen voor deze sessie */
  }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
}

// ---- Automatisch vergrendelen ----

const IDLE_MS = 2 * 60_000;

export function startAutoLock(): void {
  let last = Date.now();
  const bump = () => (last = Date.now());
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) addEventListener(ev, bump, { passive: true });
  setInterval(() => {
    if (session.isUnlocked() && Date.now() - last > IDLE_MS) session.lock();
  }, 5_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') session.lock();
  });
  session.onLock(() => {
    // Alles van het scherm halen, ook open vensters.
    document.querySelectorAll('.modal-wrap').forEach((m) => m.remove());
    document.body.classList.remove('no-scroll');
    current?.leave?.();
    current = null;
    $('#app').textContent = '';
    void render();
  });
}

export function start(): void {
  addEventListener('hashchange', () => void render());
  startAutoLock();
  void render();
}
