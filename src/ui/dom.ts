// Kleine DOM-hulpjes: veilige HTML-sjablonen, toasts en het bevestigingsvenster.

const RAW = Symbol('raw');
export interface Raw {
  [RAW]: string;
}

/** Markeert HTML die al veilig is (bijvoorbeeld uit een ander html``-sjabloon). */
export function raw(s: string): Raw {
  return { [RAW]: s };
}

export function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

type Part = string | number | bigint | boolean | null | undefined | Raw | Part[];

function render(v: Part): string {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (typeof v === 'object' && RAW in v) return v[RAW];
  return esc(v);
}

/** html`<p>${tekst}</p>`: alle waarden worden ge-escaped, behalve raw() en geneste html``. */
export function html(strings: TemplateStringsArray, ...values: Part[]): Raw {
  let out = strings[0]!;
  values.forEach((v, i) => (out += render(v) + strings[i + 1]!));
  return raw(out);
}

export function str(r: Raw): string {
  return r[RAW];
}

export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Element ${sel} niet gevonden`);
  return el;
}

export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(sel)];
}

export function setHtml(el: Element, content: Raw): void {
  el.innerHTML = str(content);
}

// ---- Toasts (design §9.3) ----

export function toast(text: string, kind: '' | 'ok' | 'err' = 'ok'): void {
  let wrap = document.querySelector('.toasts');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toasts';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-live', 'polite');
    document.body.append(wrap);
  }
  while (wrap.children.length >= 3) wrap.firstElementChild!.remove();
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = text;
  wrap.append(t);
  setTimeout(() => t.remove(), 4000);
}

// ---- Modals (design §11.6) ----

/** Opent een modal; de inhoud krijgt `close(value)` mee. Sluit met Escape of klik ernaast. */
export function modal<T>(content: Raw, mount: (root: HTMLElement, close: (v: T | null) => void) => void, label = 'Venster'): Promise<T | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(label)}">${str(content)}</div>`;
    const prev = document.activeElement as HTMLElement | null;
    let done = false;
    const close = (v: T | null) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      wrap.remove();
      document.body.classList.remove('no-scroll');
      prev?.focus?.();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null);
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) close(null);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    document.body.classList.add('no-scroll');
    const box = $('.modal', wrap);
    mount(box, close);
    box.querySelector<HTMLElement>('[autofocus], .btn-secondary, input, button')?.focus();
  });
}

/** "Weet je het zeker?" met Annuleren (focus) en Bevestigen. */
export async function confirmDialog(text: string, okLabel = 'Bevestigen', danger = true): Promise<boolean> {
  const r = await modal<boolean>(
    html`<h2>Weet je het zeker?</h2>
      <p class="muted">${text}</p>
      <div class="actions modal-actions">
        <button class="btn btn-secondary" data-no autofocus>Annuleren</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${okLabel}</button>
      </div>`,
    (root, close) => {
      $('[data-no]', root).onclick = () => close(false);
      $('[data-yes]', root).onclick = () => close(true);
    },
    'Bevestigen',
  );
  return r === true;
}

export async function copyText(text: string, what = 'Gekopieerd'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what}.`);
  } catch {
    toast('Kopiëren lukte niet. Selecteer de tekst en kopieer hem zelf.', 'err');
  }
}

export function relTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'zojuist';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min geleden`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} uur geleden`;
  const d = Math.round(h / 24);
  return d === 1 ? 'gisteren' : `${d} dagen geleden`;
}

export function dateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
