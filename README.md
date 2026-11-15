# Mijn Notities — PHP iCloud Notes prototype

## Belangrijke status
Dit project is een **onvoltooide experimentele PHP-port**. Het is geen werkende iCloud Notes-app. De PHP-backend kan een beveiligde sessie beheren, maar Apple kan de legacy JSON-login weigeren (moderne accounts gebruiken SRP-6a); de CloudKit Notes-recordparser en het omzetten van de versleutelde notities naar tekst zijn nog niet geïmplementeerd. De app mag geen succesvol inloggen of opgehaalde notities suggereren zonder een echte test.

## PHP
Broncode: `public/api/index.php` (PHP 8.2+, cURL, sessions), `public/api/.htaccess`.
Vite kopieert `public/` naar `dist/`. Bestaande `.github/workflows/deploy-ftp.yml` blijft behouden.
Configureer op de PHP-server de geheime omgevingsvariabele `NOTES_ACCESS_KEY` (minstens 24 willekeurige tekens). **Nooit** in GitHub-repository, HTML, JavaScript of FTP-artifacts plaatsen. De server moet HTTPS ondersteunen en PHP-sessies kunnen opslaan.

Endpoints: `GET /wallet/api/health` (geen authenticatie), `POST /wallet/api/unlock` (toegangscode), `GET /wallet/api/status`, `POST /wallet/api/login`, `POST /wallet/api/verify`, `POST /wallet/api/logout`, `GET /wallet/api/notes`, `GET /wallet/api/folders`.

## Beperkingen
- De Apple-login is compatibiliteitscode die een oudere onofficiële methode probeert; nieuwere SRP-login moet nog worden geporteerd en getest.
- CloudKit Notes synchronisatie, notitietekstdecode, attachments en versleutelde notities ontbreken.
- Zonder live Apple-accounttest en deploymentcontrole kan dit niet als werkend worden beschouwd.
- De oude Python-code in `connector/` is een los experiment en niet nodig voor PHP-deploy; de productieroute is `public/api/`.

PyiCloud API-documentatie: https://pyicloud.readthedocs.io/en/2026.10.0/api/services/notes/
