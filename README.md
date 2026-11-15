# Mijn Notities — iCloud op Android

Mobiele **read-only iCloud Notes** webapp op `https://mikesmid.nl/wallet/`.
Een eigen backend gebruikt de PyiCloud-client voor Apple-aanmelding, 2FA, mappen en notities. De broncode staat in `connector/icloud_gateway.py`. De Notes API van Apple is privé/ongedocumenteerd: wijzigingen aan Apple kunnen de connector breken.

## Status

De app bevat nu een werkelijke backendimplementatie en frontend-API; **de Python-gateway is NIET door GitHub FTP-deploy geïnstalleerd**. Er is alleen een statische FTP-webhosting gecontroleerd, geen Python-proces op die hosting bevestigd. Zonder gateway werkt aanmelden bewust niet. Er is geen Apple-account live getest. De app is dus niet end-to-end bevestigd.

## Backend installeren op eigen Windows-server, Linux-server of Python-hosting

1. Installeer Python 3.11+.
2. `python -m pip install -r connector/requirements.txt`
3. Maak drie omgevingsvariabelen op de **server**, nooit in Git:
   - `NOTES_ACCESS_KEY`: geheime toegangscode van minimaal 24 tekens.
   - `NOTES_SESSION_KEY`: willekeurig geheim van minimaal 32 tekens.
   - `NOTES_PUBLIC_ORIGIN=https://mikesmid.nl`
4. Start `python connector/icloud_gateway.py`. Hij luistert uitsluitend op `127.0.0.1:7866`. Voor productie liever met waitress: `waitress-serve --listen=127.0.0.1:7866 connector.icloud_gateway:app`.
5. Stel een **HTTPS reverse proxy** in waardoor uitsluitend `https://mikesmid.nl/wallet/api/*` naar de backend `http://127.0.0.1:7866/api/*` gaat. De route moet op dezelfde publieke origin draaien. Voor een FTP-hosting op een ándere server is dit **niet automatisch** mogelijk: pas DNS/hosting of een gecontroleerde tunnel/reverse proxy aan.
6. Stel GitHub Actions FTP-secrets in en laat `FTP_SERVER_DIR` naar de map van `/wallet/` wijzen. Het bestaande deployscript is behouden; de frontend bouwt met Vite.
7. Test `/wallet/api/health` (JSON), ontgrendel met de toegangscode en meld je aan bij Apple. PyiCloud en Apple Notes kunnen per account verschillen.

## Beveiliging

- Alles via HTTPS. Geen wachtwoorden of tokens in GitHub of in de frontend.
- De API heeft een aparte eigenaarscode, rate limiting, secure HttpOnly sessiecookie en controleert de Origin op POST-verzoeken.
- Gebruik een niet-gedeelde privéserver. PyiCloud kan sessiecookies op schijf opslaan; behandel die als geheim.
- De code maakt geen notities aan en wijzigt ze niet.
- Zet geen willekeurige publieke Python-backend open. Bescherm ook `/wallet/` tegen onbevoegden.

## Referenties
- https://pyicloud.readthedocs.io/en/2026.10.0/guides/authentication/
- https://pyicloud.readthedocs.io/en/2026.10.0/services/notes/
