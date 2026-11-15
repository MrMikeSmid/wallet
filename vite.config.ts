import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Servers waar de app mee mag praten (connect-src). Een eigen server voeg je toe
// bij het bouwen: WALLET_CONNECT_SRC="https://node.voorbeeld.nl,https://andere.nl" npm run build
const DEFAULT_CONNECT = ['https://mempool.space', 'https://blockstream.info'];
const extra = (process.env.WALLET_CONNECT_SRC ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter((s) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s));
const CONNECT = [...new Set([...DEFAULT_CONNECT, ...extra])];
const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  `connect-src 'self' ${CONNECT.join(' ')}`,
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

/** Strenge Content Security Policy in de HTML en als header (.htaccess), alleen bij de build. */
function security(): Plugin {
  return {
    name: 'wallet-security',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n    <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '.htaccess',
        source: [
          '# Gegenereerd bij de build (vite.config.ts). Niet met de hand wijzigen.',
          'Options -Indexes',
          '<IfModule mod_headers.c>',
          `  Header always set Content-Security-Policy "${CSP}; frame-ancestors 'none'"`,
          '  Header always set X-Content-Type-Options "nosniff"',
          '  Header always set Referrer-Policy "no-referrer"',
          '  Header always set X-Frame-Options "DENY"',
          '  Header always set Permissions-Policy "camera=(self), microphone=(), geolocation=(), payment=(), usb=()"',
          '  Header always set Strict-Transport-Security "max-age=31536000"',
          '  <FilesMatch "\\.(html|webmanifest|js)$">',
          '    Header set Cache-Control "no-cache"',
          '  </FilesMatch>',
          '  <FilesMatch "-[A-Za-z0-9_-]{8}\\.(js|css)$">',
          '    Header set Cache-Control "public, max-age=31536000, immutable"',
          '  </FilesMatch>',
          '</IfModule>',
          '<IfModule mod_rewrite.c>',
          '  RewriteEngine On',
          '  RewriteCond %{HTTPS} off',
          '  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]',
          '</IfModule>',
          'AddType application/manifest+json .webmanifest',
          '',
        ].join('\n'),
      });
    },
    closeBundle() {
      // Nieuwe cachenaam per build, zodat de service worker oude bestanden opruimt.
      const sw = resolve('dist/sw.js');
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD__', `${version}-${Date.now().toString(36)}`));
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    __CONNECT_SRC__: JSON.stringify(CONNECT),
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  plugins: [security()],
});
