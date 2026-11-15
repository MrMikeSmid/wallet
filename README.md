# Mijn Notities — iCloud op Android

Mobielvriendelijke **alleen-lezen** interface voor `https://mikesmid.nl/wallet/`.

## Belangrijk
De frontend kan **niet zelfstandig** bij Apple Notities. Apple heeft geen publieke browser-API hiervoor. De optionele `connector/icloud_gateway.py` is gebaseerd op de onofficiële PyiCloud-library en vereist een **afgeschermde Python-dienst** plus een server-side reverse proxy. De huidige FTP-deploy bouwt en uploadt alleen de frontend. Zolang er geen connector draait, toont de app expliciet dat er geen notities zijn opgehaald.

## Deploy
`.github/workflows/deploy-ftp.yml` is ongewijzigd en gebruikt de bestaande FTP-secrets. `npm ci`, typecheck, test, en `npx vite build` bouwen `dist/`. FTP synchroniseert naar de bestaande `FTP_SERVER_DIR`; controleer of deze naar `/wallet/` verwijst. De upload gebruikt `--delete`: oude websitebestanden worden verwijderd.

## Beveiliging
De repository is openbaar. Zet hier **nooit** Apple-accountwachtwoorden, sessiecookies, seed phrases, private keys of tokens in. De voorbeeldconnector werkt bewust alleen via localhost; deze is **niet geschikt om rechtstreeks publiek bloot te stellen**. Voor productie zijn eigen authenticatie, HTTPS, CSRF-bescherming, rate limiting, veilige opslag van Apple-sessies en correcte reverse-proxyrestricties nodig. Verbonden notities zijn gevoelig: gebruik geen gedeelde backend zonder toegangscontrole.

PyiCloud-documentatie: https://pyicloud.readthedocs.io/en/latest/services/notes/
