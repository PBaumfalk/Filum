# 15 — Konfiguration (IT)

> Dieses Kapitel richtet sich an die IT bzw. an Administratoren des Servers.

Filum liest seine Grundeinstellungen aus Umgebungsvariablen (in Docker Compose aus der Datei `.env`). Alles, was sich im laufenden Betrieb ändern lässt (Statistikmodus, Sperrliste, Zeitzone …), stellen Admins in der Oberfläche unter **Einstellungen** ein. Diese Werte liegen in der Datenbank und sind Teil jeder Sicherung.

Nach einer Änderung an `.env`: `docker compose up -d` (startet den Container neu).

Filum prüft die Werte beim Start streng und startet bei einem Fehler nicht, statt still einen Standard zu verwenden. Die Meldung nennt die Variable (`docker compose logs filum`).

- **Ja/Nein-Werte:** `true`, `1`, `yes`, `ja`, `on` bzw. `false`, `0`, `no`, `nein`, `off`; Groß- und Kleinschreibung ist egal (`True` geht).
- **Zahlen:** nur Ziffern, ohne Einheit (`24`, nicht `24h`).

## Grundlagen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `APP_URL` | `http://localhost:8081` | Adresse, unter der Benutzer die Verwaltung öffnen. Mit `https://` werden Cookies als `Secure` markiert und HSTS gesendet. Basis für Einladungslinks und die OIDC-Rückkehradresse. |
| `DEFAULT_DOMAIN` | – | Hostname der ersten Kurzlink-Domain. Wird beim allerersten Start als **interne, aktive Standarddomain** angelegt; danach ohne Wirkung (Domains verwalten Sie in der Oberfläche). |
| `DATA_DIR` | `/data` (im Image) | Ablage für Datenbank (`filum.db`) und Sicherungen (`backups/`). Muss ein Volume sein. |
| `PUBLIC_PORT` | `8080` | Port des öffentlichen Weiterleitungsdienstes im Container. |
| `ADMIN_PORT` | `8081` | Port von Oberfläche und API im Container. |
| `HOST` | `0.0.0.0` | Bind-Adresse im Container. |
| `TRUST_PROXY` | `loopback,linklocal,uniquelocal` | Welchen Proxys Filum `X-Forwarded-*` glaubt. Kommagetrennte Adressen/Netze, `true` (allen – nur hinter einem Proxy!) oder `false`. Empfohlen: genau die Proxy-Adresse oder das Subnetz des gemeinsamen Docker-Netzes; ohne Proxy (`PUBLIC_BIND=0.0.0.0`) `false`. Siehe [reverse-proxy.md](14-reverse-proxy.md#echte-absender-adresse-trust_proxy). |
| `STRICT_ADMIN_HOST` | `false` | `true`: Port 8081 antwortet nur unter dem Hostnamen aus `APP_URL` (und `localhost` für den Healthcheck). |
| `SECURE_COOKIES` | aus `APP_URL` abgeleitet | Erzwingt `Secure`-Cookies (`true`) oder schaltet sie ab (`false`, nur für reine HTTP-Testumgebungen). |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` oder `silent`. Logs sind JSON auf stdout, Zeitstempel in UTC. Andere Werte verhindern den Start. |
| `SETUP_CODE` | zufällig | Einrichtungscode für das erste Konto selbst festlegen (z. B. für automatisierte Installationen). Ohne Wirkung, sobald ein Konto existiert. |
| `FILUM_VERSION` | Version aus `package.json` | Angezeigte Versionsbezeichnung (Einstellungen → System, Startmeldung im Log). Nur setzen, wenn Sie eigene Builds kennzeichnen wollen, z. B. `1.0.0-firma.2`. |
| `NODE_EXTRA_CA_CERTS` | – | Pfad zu einer PEM-Datei mit zusätzlichen Zertifizierungsstellen, denen Filum bei ausgehenden HTTPS-Abrufen vertraut (OIDC, Tessera, Domainprüfung, Vorschau). Für interne CAs, Beispiel in [reverse-proxy.md](14-reverse-proxy.md#interne-zertifizierungsstelle-auch-für-filum). |

## Docker Compose (nur `docker-compose.yml`)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `FILUM_IMAGE` | `filum:latest` | Welches Image Compose startet. Standard ist das eigene Build; für das fertige Image `ghcr.io/pbaumfalk/filum:1` (folgt allen 1.x-Versionen) oder eine feste Version wie `ghcr.io/pbaumfalk/filum:1.0.0`. Dann ohne `--build` starten. |
| `PUBLIC_BIND` | `127.0.0.1` | Host-Adresse, auf der Port 8080 angeboten wird. `0.0.0.0` nur, wenn kein Proxy davor steht. |
| `PUBLIC_HOST_PORT` | `8080` | Host-Port für die Weiterleitung. |
| `ADMIN_BIND` | `127.0.0.1` | Host-Adresse für die Verwaltung. |
| `ADMIN_HOST_PORT` | `8081` | Host-Port für die Verwaltung. |
| `TZ` | `Europe/Berlin` | Zeitzone der Container-Umgebung. Zeitstempel in Logs und Sicherungsnamen sind unabhängig davon immer UTC. Die fachliche Zeitzone (Zeitpläne, Tageswerte) steht in **Einstellungen → Allgemein**. |

## Anmeldung über OIDC (z. B. authentik)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `OIDC_ISSUER` | – | Issuer-URL des Anbieters, z. B. `https://auth.firma.de/application/o/filum/`. Ohne diesen Wert ist OIDC aus. |
| `OIDC_CLIENT_ID` | – | Client-ID. |
| `OIDC_CLIENT_SECRET` | – | Client-Secret (Typ *Confidential*). |
| `OIDC_SCOPES` | `openid profile email groups` | Angeforderte Scopes. |
| `OIDC_GROUPS_CLAIM` | `groups` | Claim mit den Gruppen des Kontos. |
| `OIDC_ADMIN_GROUPS` | – | Gruppen, die Admin werden (kommagetrennt). |
| `OIDC_EDITOR_GROUPS` | – | Gruppen für die Rolle Redaktion. |
| `OIDC_MEMBER_GROUPS` | – | Gruppen für die Rolle Mitglied. |
| `OIDC_DEFAULT_ROLE` | `member` | Rolle für Konten ohne passende Gruppe: `admin`, `editor`, `member`, `viewer` oder `none` (= keine Anmeldung). |
| `OIDC_BUTTON_LABEL` | `Mit Firmenkonto anmelden` | Beschriftung der Schaltfläche. |
| `DISABLE_LOCAL_LOGIN` | `false` | `true`: nur noch Anmeldung über OIDC. Die Ersteinrichtung funktioniert trotzdem. |

Die Rolle wird bei jeder Anmeldung aus den Gruppen neu bestimmt, wenn eine Gruppe passt. Einrichtung in authentik: [oidc-authentik.md](16-anmeldung-oidc.md).

## Vorschau und Zielprüfung

Filum ruft Zieladressen ab, um Titel und Vorschaubild zu lesen und regelmäßig zu prüfen, ob das Ziel noch erreichbar ist. Diese Abrufe sind gegen Server-Side Request Forgery geschützt: Interne Netze, Loopback und Cloud-Metadaten werden nie abgerufen (Details: [sicherheit.md](20-sicherheit.md)).

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `FETCH_ALLOW_HOSTS` | – | Ausnahmen für Intranet-Ziele: Hostnamen (inkl. Subdomains), IP-Adressen oder Netze, z. B. `wiki.intranet.firma.de,10.20.0.0/16`. |
| `FETCH_ALLOW_PRIVATE` | `false` | `true`: private Netze (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7) dürfen abgerufen werden. Loopback, Link-Local und Metadaten bleiben gesperrt. |
| `FETCH_TIMEOUT_MS` | `6000` | Zeitlimit je Abruf. |
| `FETCH_USER_AGENT` | `Filum-Linkpruefung/1.0 (+self-hosted)` | User-Agent der Abrufe. |
| `HEALTH_CHECK_INTERVAL_MIN` | `360` | Wie oft jedes Ziel geprüft wird (Minuten, mindestens 15). `0` schaltet die Prüfung ab, z. B. auf Servern ohne Internetzugang (Filum unterstützt keinen ausgehenden HTTP-Proxy, siehe [betrieb.md](18-betrieb.md#ohne-internetzugang)). |

## Sicherungen

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `BACKUP_INTERVAL_HOURS` | `24` | Abstand automatischer Sicherungen. `0` = aus. |
| `BACKUP_KEEP` | `14` | Anzahl aufbewahrter automatischer Sicherungen. |

## Tessera

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `TESSERA_URL` | – | Adresse des QR-Studios Tessera, z. B. `https://qr.intranet.firma.de`. |
| `TESSERA_TOKEN` | – | API-Token aus Tessera (Rolle *Bearbeiten*). |

Ohne diese Werte funktioniert alles; nur die Schaltfläche „In Tessera gestalten“ fehlt. Siehe [tessera.md](07-qr-codes.md).

---

Weiter: [16 — Anmeldung über authentik (OIDC)](16-anmeldung-oidc.md) · [Zur Übersicht](README.md)
