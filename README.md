# Wallet

Zelfbeheerde Bitcoin-wallet die volledig in de browser draait. Er is geen backend, geen account en geen opslag van gegevens buiten het apparaat.

## Functies
- Nieuwe wallet: herstelzin van 12 of 24 woorden (BIP39), controle van drie woorden, optionele extra wachtwoordzin.
- Herstellen met een bestaande herstelzin.
- Native SegWit-adressen (BIP84, `bc1q…`), onbeperkt nieuwe ontvangstadressen (tot 20 ongebruikt vooruit).
- Ontvangen met QR-code en optioneel bedrag (BIP21).
- Versturen met kostenkeuze, alles versturen, QR scannen en RBF aan.
- Per adres de publieke en privésleutel (WIF) tonen, herstelzin tonen, zpub voor alleen-kijken.
- Mainnet of testnet4.

## Beveiliging en privacy
- Sleutels worden alleen in de browser gemaakt (`crypto.getRandomValues`) en verlaten het apparaat nooit.
- Op het apparaat staat alleen de kluis, versleuteld met PBKDF2-SHA256 (600.000 rondes) en AES-256-GCM, plus instellingen. Saldo, adressen en geschiedenis staan alleen in het geheugen.
- Automatisch vergrendelen (instelbaar) en een oplopende wachttijd na verkeerde wachtwoorden.
- Saldo en versturen gaan via een Esplora-server (standaard mempool.space). Die ziet je adressen en IP-adres, maar nooit je sleutels. Voor de meeste privacy stel je in Instellingen je eigen node in.
- Strenge CSP en beveiligingsheaders (`public/.htaccess`).

## Ontwikkelen
```
npm ci
npm test        # BIP39/BIP32/BIP84-testvectoren, kluis, transacties
npm run dev
npm run build   # naar dist/
```
Bij een push naar `main` test, bouwt en uploadt `.github/workflows/deploy-ftp.yml` de inhoud van `dist/` naar de map uit de secret `FTP_SERVER_DIR` (`/wallet`).
