# Wallet

Een self-custodial Bitcoin-wallet (alleen BTC). Hij draait als PWA en wordt met Capacitor verpakt als app voor Android en iOS. De sleutels worden op het apparaat gemaakt en verlaten het nooit. Er is geen account en geen eigen backend; de app praat alleen met een Esplora-server die je zelf kunt instellen.

> **Status:** fase 1 (aanmaken, herstellen, ontvangen, saldo, bericht ondertekenen) en fase 2 (versturen, fee-keuze, RBF, coin control) zijn gebouwd. Gebruik de wallet eerst op **testnet**. Volg de acceptatiecriteria hieronder (onder andere een kruiscontrole met Sparrow en een code review) voordat er echt geld in gaat.

## Installatie

Je hebt Node.js 22.18 of hoger nodig.

```bash
npm ci            # exacte versies uit package-lock.json
npm run dev       # ontwikkelserver op http://localhost:5173
npm test          # alle tests (node:test, zonder extra testframework)
npm run check     # npm audit + typecontrole + tests + build
npm run build     # productiebuild in dist/
```

### Uitrollen (PWA)

Een push naar `main` start `.github/workflows/deploy-ftp.yml`. Die doet het volgende, in deze volgorde:

1. `npm ci`;
2. `npm audit --audit-level=high`;
3. typecontrole;
4. tests;
5. build;
6. `dist/` via FTP uploaden met `mirror --delete`.

Faalt een stap, dan wordt er niets geüpload.

Nodige Actions-secrets: `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, `FTP_SERVER_DIR`.

De build maakt ook `dist/.htaccess` aan. Die zet de beveiligingsheaders (CSP met `frame-ancestors 'none'`, `nosniff`, `no-referrer`, HSTS) en dwingt https af. Een PWA met camera en service worker werkt alleen via https.

### Eigen Esplora-server toestaan

De Content Security Policy staat alleen verbindingen toe met `https://mempool.space` en `https://blockstream.info`. Een eigen server voeg je zo toe:

- **Lokaal bouwen:** `WALLET_CONNECT_SRC="https://node.voorbeeld.nl" npm run build`.
- **Uitrol via GitHub:** zet de repository-variabele `WALLET_CONNECT_SRC` (*Settings → Secrets and variables → Actions → Variables*). Meerdere servers scheid je met komma's.

Daarna vul je bij **Instellingen → Server** het volledige adres in, bijvoorbeeld `https://node.voorbeeld.nl/api`. De app waarschuwt als het domein niet in de CSP staat.

### Native app (Capacitor)

Zo maak je de native projecten aan:

```bash
npx cap add android      # eenmalig
npx cap add ios          # eenmalig, op een Mac
npm run cap:sync         # build + kopiëren naar de native projecten
npx cap open android
```

Wat in de native app anders is dan in de PWA:

- **Opslag:** de versleutelde seed staat in de Keychain (iOS) of Keystore (Android) via `@aparajita/capacitor-secure-storage`. Er is geen iCloud-synchronisatie en de sleutel blijft op het toestel (`whenUnlockedThisDeviceOnly`).
- **Screenshots:** die worden op de seed-schermen geblokkeerd via `@capacitor-community/privacy-screen` (Android `FLAG_SECURE`).
- **Camera:** voeg de camera-toestemming toe aan `AndroidManifest.xml` en `Info.plist` (`NSCameraUsageDescription`) voor de QR-scanner.

## Gebruik

Een nieuwe gebruiker kiest bij de eerste start tussen **Nieuwe wallet** en **Wallet herstellen**.

| Scherm | Wat |
|---|---|
| Welkom | Nieuwe wallet of wallet herstellen |
| Seed tonen | 12 of 24 woorden met een waarschuwing. In de app zijn screenshots geblokkeerd. |
| Seed bevestigen | 3 willekeurige woorden overtypen. Bij herstellen: woorden invoeren met autocomplete uit de BIP39-lijst, met een optionele passphrase. |
| Pincode | Twee keer invoeren, minimaal 6 cijfers |
| Home | Saldo in BTC en sats, bevestigd en onbevestigd apart, transacties, knoppen Ontvangen en Versturen |
| Ontvangen | QR-code (BIP21, optioneel met bedrag), adres, kopiëren, Nieuw adres. Een gebruikt adres wordt niet opnieuw getoond. |
| Versturen | Adres of QR (ook BIP21), bedrag of **Alles**, fee Laag/Normaal/Hoog/Eigen, coin control → overzicht → pincode → verzonden |
| Transactie | Details en een notitie. Een vastgelopen uitgaande transactie kun je **versnellen** (RBF). |
| Instellingen | Netwerk, server, thema en eenheid. Ook: pincode wijzigen, wissen na 10 pogingen, seed bekijken, bericht ondertekenen, coins en labels, en wallet wissen (dubbele bevestiging). |

### Beveiliging

- **Versleuteling:** PBKDF2-SHA256 (600.000 iteraties, willekeurige salt) leidt uit de pincode twee AES-256-GCM-sleutels af:
  - de **kluissleutel** ontsleutelt de seed. Die wordt alleen afgeleid bij versturen, seed bekijken en ondertekenen, en daarna weggegooid.
  - de **statussleutel** ontsleutelt de walletstatus (xpubs, adresindexen, labels, cache). Die blijft niet-exporteerbaar in het geheugen zolang de wallet open is.
- **Opslag in de PWA:** versleutelde blobs in IndexedDB. In `localStorage` staat alleen de themakeuze.
- **Foute pincodes:** de eerste 4 fouten kosten niets. Daarna loopt de wachttijd op: 30 s, 1 min, 2 min, … tot maximaal 1 uur. **Wis na 10 pogingen** is optioneel en staat standaard uit.
- **Vergrendelen:** automatisch na 2 minuten zonder gebruik, en zodra de app naar de achtergrond gaat.
- **Lekken voorkomen:**
  - Sleutelbytes worden na gebruik gewist met `fill(0)`.
  - De seed wordt nooit gelogd en niet gekopieerd; alleen adressen, transactie-ID's en handtekeningen kunnen naar het klembord.
  - Er wordt geen cloud-back-up gemaakt.

### Privacy

- De app maakt alleen verzoeken naar de ingestelde Esplora-server.
- Bij een 429 of netwerkfout (openbare servers beperken het aantal verzoeken) wacht de app oplopend (2, 4, 8 … s) en probeert het opnieuw.
- Er zijn geen analytics, geen externe fonts, geen CDN en geen pushdiensten.
- Bij het scannen gaan adressen één voor één naar de server, in willekeurige volgorde en met een willekeurige pauze (gap limit 20, receive- en change-keten).
- Wisselgeld gaat naar een apart change-adres (BIP84 interne keten).
- Labels en notities staan alleen versleuteld op het apparaat.
- Verzoeken gaan zonder cookies en zonder referrer.

## Structuur

```
src/
  core/            pure logica, zonder DOM (volledig getest)
    wallet.ts      BIP39-seed, BIP32-sleutels, BIP84-adressen (m/84'/0'/0', testnet m/84'/1'/0')
    vault.ts       PBKDF2 + AES-GCM, pincode-eisen
    lockout.ts     wachttijd na foute pincodes
    esplora.ts     Esplora-client (adressen, transacties, UTXO's, fees, broadcast)
    scan.ts        gap-limit-scan, saldo, geschiedenis, RBF-herkenning
    tx.ts          coin selection, ondertekenen (PSBT-flow van @scure/btc-signer), RBF, fee-niveaus
    bip21.ts       bitcoin:-URI's lezen en maken
    message.ts     bericht ondertekenen/controleren (BIP137, SegWit-header)
    format.ts      BTC/sats weergeven en invoeren (bigint, nooit floats)
  app/
    storage.ts     IndexedDB (PWA) of Keychain/Keystore (Capacitor), privacy-scherm
    session.ts     aanmaken, ontgrendelen, kluis, pincode, instellingen, versleutelde status
    sync.ts        scannen via de server, ontvangst- en wisselgeldadressen
  ui/
    app.ts         router, bovenbalk, onderste menu, automatisch vergrendelen, thema
    dom.ts         veilige html``-sjablonen, toasts, bevestigingsvenster
    widgets.ts     pinpad, QR-code, QR-scanner
    icons.ts       iconen (inline SVG)
    screens/       onboarding, home + transactie, ontvangen, versturen + coins, instellingen
  styles/app.css   huisstijl (crème, terracotta, serif-koppen; licht en donker)
tests/             node:test — BIP39/BIP32/BIP84-testvectoren en de kernlogica
public/            manifest, service worker, thema-script, iconen
vite.config.ts     build, CSP en .htaccess
capacitor.config.ts
```

### Libraries

Er zit geen eigen cryptografie in de app. Gebruikt worden:

- `@scure/bip39`, `@scure/bip32`, `@scure/btc-signer`, `@scure/base`, `@noble/hashes` en `@noble/curves`: geaudit, zonder afhankelijkheden;
- `@paulmillr/qr` voor de QR-code en de scanner;
- Capacitor en twee plugins.

Alle versies staan exact vast in `package.json`; `package-lock.json` staat in git.

## Acceptatiecriteria (vóór gebruik met echt geld)

- [x] Unit tests met de officiële BIP39-, BIP32- en BIP84-testvectoren.
- [ ] Kruiscontrole: een seed uit deze app geeft in Sparrow of Electrum (Native SegWit) dezelfde adressen en hetzelfde saldo, en andersom.
- [ ] Ontvangen en versturen op testnet (of signet), inclusief RBF en wisselgeld.
- [ ] Netwerkverkeer gecontroleerd (DevTools of een proxy): alleen verzoeken naar de Esplora-server, zonder seed of xpub.
- [ ] De seed staat niet in logs of `localStorage`, en niet onversleuteld in IndexedDB.
- [ ] De wallet werkt na een herstart, en na herstellen op een ander apparaat met alleen de seed phrase.
- [ ] Code review door een tweede persoon.
- [ ] Eerste mainnet-test met een klein bedrag.

## Nog niet gebouwd

- **Biometrie om te ontgrendelen** (optioneel in de specificatie): dit vraagt een extra plugin en sleutelopslag achter biometrie.
- **BIP322-ondertekening:** de app ondertekent nu in het legacy-formaat (BIP137).
- **Uit de specificatie, "later":** Electrum-server, Tor, en een watch-only wallet of hardware wallet.
