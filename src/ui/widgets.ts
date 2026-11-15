// Pinpad, QR-code en QR-scanner.

import encodeQR from '@paulmillr/qr';
import { MIN_PIN_LENGTH } from '../core/vault.ts';
import { formatWait } from '../core/lockout.ts';
import type { UnlockResult } from '../app/session.ts';
import { $, $$, esc, html, modal, raw, type Raw } from './dom.ts';
import { icon } from './icons.ts';

const MAX_PIN = 12;

/** Tekst bij een mislukte pincode. */
export function pinError(r: Exclude<UnlockResult, { ok: true }>): string {
  if (r.reason === 'wiped') return 'De wallet is gewist na te veel foute pogingen.';
  if (r.reason === 'wait') return `Te veel foute pogingen. Probeer het over ${formatWait(r.waitMs)} opnieuw.`;
  return r.waitMs
    ? `Onjuiste pincode. Wacht ${formatWait(r.waitMs)} voor de volgende poging.`
    : `Onjuiste pincode. Nog ${Math.max(0, 5 - r.failures)} poging${5 - r.failures === 1 ? '' : 'en'} zonder wachttijd.`;
}

export function pinpadHtml(title: string, sub = ''): Raw {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  return html`<div class="pinpad">
    <h2 class="pin-title">${title}</h2>
    ${sub ? html`<p class="sub pin-sub">${sub}</p>` : ''}
    <div class="pin-dots" aria-live="polite" aria-label="Ingevoerde cijfers"></div>
    <p class="pin-error" role="alert" hidden></p>
    <div class="pin-keys">
      ${keys.map((k) =>
        k === 'del'
          ? html`<button type="button" class="pin-key ghost" data-k="del" aria-label="Wis laatste cijfer">${icon('chevron-left')}</button>`
          : k === 'ok'
            ? html`<button type="button" class="pin-key ok" data-k="ok" aria-label="Bevestigen" disabled>${icon('check')}</button>`
            : html`<button type="button" class="pin-key" data-k="${k}">${k}</button>`,
      )}
    </div>
  </div>`;
}

export interface PinpadControl {
  setError(text: string): void;
  setBusy(busy: boolean, text?: string): void;
  reset(title?: string, sub?: string): void;
}

/** Koppelt het pinpad. `onSubmit` krijgt de pincode; de cijfers staan alleen in een lokale variabele. */
export function mountPinpad(root: HTMLElement, onSubmit: (pin: string, ctl: PinpadControl) => void): PinpadControl {
  let pin = '';
  let busy = false;
  const dots = $('.pin-dots', root);
  const err = $('.pin-error', root);
  const ok = $<HTMLButtonElement>('[data-k=ok]', root);

  const draw = () => {
    const n = Math.max(MIN_PIN_LENGTH, pin.length);
    dots.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('');
    dots.setAttribute('aria-label', `${pin.length} cijfers ingevoerd`);
    ok.disabled = busy || pin.length < MIN_PIN_LENGTH;
  };
  const ctl: PinpadControl = {
    setError(text) {
      err.textContent = text;
      err.hidden = !text;
      pin = '';
      draw();
    },
    setBusy(b, text) {
      busy = b;
      root.classList.toggle('busy', b);
      $$<HTMLButtonElement>('.pin-key', root).forEach((k) => (k.disabled = b));
      if (text !== undefined) {
        err.textContent = text;
        err.hidden = !text;
        err.classList.toggle('info', b);
      }
      draw();
    },
    reset(title, sub) {
      pin = '';
      if (title) $('.pin-title', root).textContent = title;
      const s = root.querySelector('.pin-sub');
      if (s && sub !== undefined) s.textContent = sub;
      ctl.setError('');
    },
  };
  const press = (k: string) => {
    if (busy) return;
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'ok') {
      if (pin.length >= MIN_PIN_LENGTH) {
        const p = pin;
        pin = '';
        draw();
        onSubmit(p, ctl);
        return;
      }
    } else if (/^\d$/.test(k) && pin.length < MAX_PIN) {
      pin += k;
      err.hidden = true;
    }
    draw();
  };
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-k]');
    if (b && root.contains(b)) press(b.dataset.k!);
  });
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) return document.removeEventListener('keydown', onKey);
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') press('ok');
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  draw();
  return ctl;
}

/**
 * Vraagt de pincode in een venster en voert `action` uit. Bij een foute pincode
 * blijft het venster open met een melding. Geeft de uitkomst van `action` of null.
 */
export function askPin<T>(
  title: string,
  sub: string,
  action: (pin: string) => Promise<{ ok: true; value: T } | Exclude<UnlockResult, { ok: true }>>,
  busyText = 'Controleren…',
): Promise<T | null> {
  return modal<T>(
    html`<button class="btn btn-ghost btn-icon modal-close" data-close aria-label="Sluiten">${icon('x')}</button>${pinpadHtml(title, sub)}`,
    (root, close) => {
      $('[data-close]', root).onclick = () => close(null);
      mountPinpad(root, async (pin, ctl) => {
        ctl.setBusy(true, busyText);
        try {
          const r = await action(pin);
          if (r.ok) return close(r.value);
          ctl.setBusy(false, '');
          ctl.setError(pinError(r));
          if (r.reason === 'wiped') setTimeout(() => close(null), 1500);
        } catch (e) {
          ctl.setBusy(false, '');
          ctl.setError(e instanceof Error ? e.message : 'Er ging iets mis.');
        }
      });
    },
    title,
  );
}

/** QR-code als SVG (één pad); donkere modules op wit, zodat hij ook in de donkere stand scant. */
export function qrSvg(text: string): Raw {
  const grid = encodeQR(text, 'raw', { ecc: 'medium', border: 2 });
  const n = grid.length;
  let d = '';
  grid.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
  return raw(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR-code: ${esc(text)}"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#141413"/></svg>`,
  );
}

/** Opent de camera en geeft de eerste gelezen QR-tekst terug (of null bij annuleren). */
export async function scanQr(): Promise<string | null> {
  const { QRCanvas, frontalCamera, frameLoop } = await import('@paulmillr/qr/dom.js');
  let stop: (() => void) | null = null;
  let camera: { stop(): void } | null = null;
  const result = await modal<string>(
    html`<h2>QR-code scannen</h2>
      <p class="muted small">Houd de QR-code in het kader.</p>
      <div class="scanner"><video playsinline muted></video><canvas class="scan-bitmap"></canvas></div>
      <p class="pin-error" role="alert" hidden></p>
      <div class="actions modal-actions"><button class="btn btn-secondary" data-close>Annuleren</button></div>`,
    (root, close) => {
      $('[data-close]', root).onclick = () => close(null);
      const video = $<HTMLVideoElement>('video', root);
      const bitmap = $<HTMLCanvasElement>('.scan-bitmap', root);
      const err = $('.pin-error', root);
      frontalCamera(video)
        .then((cam) => {
          camera = cam;
          const canvas = new QRCanvas({ bitmap });
          stop = frameLoop(() => {
            const res = cam.readFrame(canvas);
            if (res) close(res);
          });
        })
        .catch(() => {
          err.textContent = 'De camera is niet beschikbaar. Geef toestemming of plak het adres.';
          err.hidden = false;
        });
    },
    'QR-code scannen',
  );
  (stop as (() => void) | null)?.();
  (camera as { stop(): void } | null)?.stop();
  return result;
}
