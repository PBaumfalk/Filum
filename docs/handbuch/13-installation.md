# 13 — Installation (IT)

> Dieses Kapitel richtet sich an die IT bzw. an Administratoren des Servers.

Diese Anleitung führt von einem leeren Linux-Server zu einem laufenden Filum hinter Ihrem Reverse Proxy. Sie brauchen etwa 20 Minuten.

## Voraussetzungen

- Linux-Server (amd64 oder arm64) mit **Docker 24+** und **Docker Compose 2.24 oder neuer** (`docker compose version`; ältere Versionen kennen die Pflichtangabe der `.env` in `docker-compose.yml` nicht)
- 1 CPU-Kern und 512 MB RAM reichen für Zehntausende Links
- Ein Reverse Proxy (Caddy, nginx, Traefik …), der TLS-Zertifikate bereitstellt
- Zwei Hostnamen im DNS, die auf den Proxy zeigen:
  - einen für die **Verwaltung**, z. B. `filum.intranet.firma.de`
  - einen (oder mehrere) für die **Kurzlinks**, z. B. `go.firma.de`

Die beiden Hostnamen müssen verschieden sein. Filum trennt Verwaltung und öffentliche Weiterleitung auf zwei Ports; der Proxy verbindet jeden Hostnamen mit genau einem davon (siehe [reverse-proxy.md](14-reverse-proxy.md)).

## 1. Dateien auf den Server bringen

```bash
sudo mkdir -p /opt/filum && sudo chown "$USER" /opt/filum
```

**Mit git:**

```bash
git clone https://github.com/PBaumfalk/Filum.git /opt/filum
cd /opt/filum
```

**Mit rsync** vom eigenen Rechner aus dem Projektordner heraus:

```bash
rsync -av --delete \
  --exclude node_modules --exclude dist --exclude data \
  --exclude test-results --exclude playwright-report --exclude e2e/.auth \
  --exclude .env \
  ./ server:/opt/filum/
```

Der abschließende Schrägstrich bei `./` ist wichtig: Er kopiert den *Inhalt* des Ordners nach `/opt/filum/`. Ohne ihn entstünde `/opt/filum/link-shortener/`. Nicht kopieren sollten Sie `node_modules` (wird im Image gebaut, enthält plattformabhängige Teile), lokale Testdaten (`data`, Testberichte, Anmeldezustände der Browser-Tests) und Ihre lokale `.env`. Mit `--delete` entfernt rsync auf dem Server Dateien, die es lokal nicht mehr gibt; die `.env` auf dem Server bleibt dank `--exclude` erhalten.

## 2. Konfiguration anlegen

```bash
cp .env.example .env
nano .env
```

Ohne `.env` startet Compose nicht (Meldung `APP_URL in .env setzen`). Mindestens diese beiden Werte anpassen:

```ini
APP_URL=https://filum.intranet.firma.de      # Adresse der Verwaltung
DEFAULT_DOMAIN=go.intranet.firma.de          # erste Kurzlink-Domain
```

Alle weiteren Variablen erklärt [konfiguration.md](15-konfiguration.md).

## 3. Bauen und starten

```bash
docker compose up -d --build
docker compose ps          # Status sollte nach ~20 s "healthy" sein
docker compose logs filum  # zeigt den Einrichtungscode
```

Im Log steht eine Zeile wie:

```
Einrichtungscode: 863-622-429 – unter https://filum.intranet.firma.de eingeben, um das erste Admin-Konto anzulegen.
```

Den Code können Sie jederzeit erneut anzeigen:

```bash
docker compose exec filum filum setup-code
```

Es gibt **keine Standardzugangsdaten**. Solange kein Konto existiert, kann nur anlegen, wer den Code aus dem Log kennt.

## 4. Reverse Proxy einrichten

Standardmäßig bietet Docker die Container-Ports nur auf `127.0.0.1` an:

| Host-Port | Container-Port | Inhalt | Proxy-Ziel für |
| --- | --- | --- | --- |
| `127.0.0.1:8080` | 8080 | nur Kurzlink-Weiterleitungen | `go.firma.de` (und weitere Kurzlink-Domains) |
| `127.0.0.1:8081` | 8081 | Oberfläche und API | `filum.intranet.firma.de` |

Fertige Beispiele für Caddy, nginx und Traefik: [reverse-proxy.md](14-reverse-proxy.md). Läuft der Proxy in einem anderen Container, binden Sie Filum stattdessen an dessen Docker-Netz (Beispiel in der gleichen Datei).

## 5. Ersteinrichtung im Browser

1. `https://filum.intranet.firma.de` öffnen.
2. Einrichtungscode, Name, E-Mail und Passwort (mindestens 10 Zeichen) eingeben. Das Konto erhält Admin-Rechte.
3. Unter **Domains** prüfen, ob die Standarddomain aktiv ist, und mit **Prüfen** die Erreichbarkeit über den Proxy testen.
4. Unter **Einstellungen → Allgemein** den Namen der Organisation eintragen.
5. Einen ersten Link anlegen: Adresse einfügen, Enter. Der Kurzlink liegt in der Zwischenablage.

## 6. Öffentliche Domain hinzufügen (optional)

Soll ein Kurzlink-Hostname aus dem Internet erreichbar sein:

1. DNS-Eintrag auf die öffentliche Adresse des Proxys setzen.
2. Im Proxy nur diesen Hostnamen nach außen freigeben, verbunden mit Port 8080.
3. In Filum unter **Domains → Domain hinzufügen** „Öffentlich“ wählen.
4. Besitz nachweisen: TXT-Eintrag `_filum-challenge.go.firma.de` mit dem angezeigten Wert, oder **Über HTTP prüfen**, sobald DNS und Proxy stehen.

Details: [domains.md](09-domains.md).

## 7. Sicherung einplanen

Filum sichert sich alle 24 Stunden selbst in das Volume (`/data/backups`). Kopieren Sie diese Dateien zusätzlich auf ein anderes System. Anleitung und getestete Wiederherstellung: [sicherung.md](17-sicherung.md).

## Ohne eigenes Build

Jedes Release erscheint als fertiges Image für amd64 und arm64 unter `ghcr.io/pbaumfalk/filum`. Tags: `1.0.0` (genau diese Version), `1.0` und `1` (jeweils neueste passende), `latest` (Stand des Hauptzweigs).

```bash
# in .env
FILUM_IMAGE=ghcr.io/pbaumfalk/filum:1

docker compose pull
docker compose up -d          # ohne --build
```

Vom Repository brauchen Sie dann nur `docker-compose.yml` und `.env.example`.

### Eigenes Image in eine eigene Registry

```bash
# einmalig: ein Builder, der mehrere Plattformen kann (der Standard-Builder kann es nicht)
docker buildx create --name filum-multi --use
docker buildx build --platform linux/amd64,linux/arm64 \
  --build-arg FILUM_VERSION=1.0.0 \
  -t registry.firma.de/filum:1.0.0 --push .
```

Für die fremde Plattform läuft der Build unter Emulation (QEMU) und dauert deutlich länger. Fehlt die Emulation, richten Sie sie einmalig mit `docker run --privileged --rm tonistiigi/binfmt --install all` ein. Ein Server ohne Internetzugang: siehe [betrieb.md](18-betrieb.md#ohne-internetzugang).

---

Weiter: [14 — Reverse Proxy, HTTPS und Trennung](14-reverse-proxy.md) · [Zur Übersicht](README.md)
