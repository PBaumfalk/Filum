<img src="src/web/public/favicon.svg" width="64" alt="Filum">

# Filum

[![CI](https://github.com/PBaumfalk/Filum/actions/workflows/ci.yml/badge.svg)](https://github.com/PBaumfalk/Filum/actions/workflows/ci.yml)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-blue.svg)](LICENSE)
[![Docker-Image](https://img.shields.io/badge/ghcr.io-pbaumfalk%2Ffilum-blue?logo=docker)](https://ghcr.io/pbaumfalk/filum)

**Kurzlinks, eigene Domains und ehrliche Statistik, auf dem eigenen Server.**

Filum ist ein selbst gehostetes Link-Management-Studio. Lange Adresse einfügen, Enter: Der Kurzlink liegt in der Zwischenablage. Dahinter steckt, was professionelle Linkverwaltung braucht: mehrere Domains, Kampagnen mit UTM-Parametern, Zeitpläne, Passwortschutz, Regeln nach Gerät, Sprache oder Uhrzeit, A/B-Varianten, QR-Codes, Import und Export, eine REST-API, Rollen und OIDC-Anmeldung. Ohne Cloud, ohne Abo, ohne Tracking durch Dritte.

*Filum* ist lateinisch für **Faden**. Ein Kurzlink ist der rote Faden zwischen einer kurzen Adresse und ihrem Ziel: Er bleibt derselbe, auch wenn sich das Ziel ändert, und man kann ihm jederzeit folgen. Das Schwesterprojekt im Intranet heißt Tessera, „Mosaiksteinchen“.

> **English abstract:** Self-hosted link management studio: short links on your own domains, campaigns with UTM parameters, schedules, password protection, device/language/time rules, A/B variants, QR codes, import/export, REST API, roles and OIDC login. Privacy-friendly aggregate-only statistics (no IPs, no cookies). Node.js 24, Fastify, SQLite, React; ships as one Docker image (amd64/arm64) with redirects and admin strictly separated on two ports. UI and documentation are in German.

![Linkliste mit geöffnetem Link-Editor](docs/screenshots/link-editor.png)

## Was Filum besonders macht

- **Schneller Anfang:** Einfügen, Enter, fertig und kopiert. Mehrere Adressen auf einmal. Lesezeichen „Mit Filum kürzen“. Hinweis, wenn es für ein Ziel schon einen Link gibt.
- **Gedruckte Links bleiben verlässlich:** Gelöschte Kurzadressen werden nie neu vergeben. Links lassen sich als *verteilt* schützen. Jede Zieländerung steht im Verlauf und lässt sich mit einem Klick zurückholen.
- **Saubere Weiterleitungen:** 302 als Standard, 301/308 mit begrenztem Browser-Cache; Links mit Zeitplan, Regeln, Limit oder Passwort werden automatisch temporär ausgeliefert, damit kein Browser ein veraltetes Ziel festhält. Rund 46 000 Weiterleitungen pro Sekunde in einem Prozess.
- **Vertipper-Radar:** zeigt Kurzadressen, die aufgerufen werden, aber nicht existieren, etwa weil ein Flyer falsch abgetippt wird, und leitet sie mit einem Klick auf den gemeinten Link.
- **Zielprüfung:** Filum prüft regelmäßig, ob Ziele noch erreichbar sind, und meldet gestörte Links, über einen gegen SSRF gehärteten Abruf.
- **QR mit Herkunft:** Codes enthalten auf Wunsch `?qr`. Filum entfernt das vor der Weiterleitung und zeigt, wie viele Besucher über das Plakat kamen. Gestaltung übernimmt bei Bedarf Tessera.
- **Datensparsame Statistik:** nur Summen, keine IP-Adressen, keine Cookies bei Besuchern, keine Profile. Drei Stufen (aus, Grund, erweitert), Aufbewahrungsfristen, Löschen auf Knopfdruck und ein passender Textbaustein für die Datenschutzerklärung.
- **Vorschau für Empfänger:** `go.firma.de/abc+` zeigt das Ziel, statt weiterzuleiten, mit Meldemöglichkeit bei Missbrauch.
- **Getrennte Welten:** Kurzlinks und Verwaltung laufen auf zwei Ports. Über eine Kurzlink-Domain ist die Verwaltung technisch nicht erreichbar.

## Schnellstart

```bash
git clone https://github.com/PBaumfalk/Filum.git && cd Filum
cp .env.example .env          # APP_URL und DEFAULT_DOMAIN anpassen (Pflicht)
docker compose up -d --build  # Docker Compose 2.24 oder neuer
docker compose logs filum     # Einrichtungscode ablesen
```

Ohne eigenes Bauen: in `.env` `FILUM_IMAGE=ghcr.io/pbaumfalk/filum:1` setzen und `docker compose up -d` (ohne `--build`) aufrufen. Fertige Images für amd64 und arm64 entstehen bei jedem Release.

Dann `APP_URL` im Browser öffnen, Einrichtungscode eingeben, erstes Konto anlegen. Ausführlich: [Handbuch, Kapitel 13](docs/handbuch/13-installation.md).

| Port | Inhalt | Proxy-Ziel für |
| --- | --- | --- |
| 8080 | nur Kurzlink-Weiterleitungen | Kurzlink-Domains, z. B. `go.firma.de` |
| 8081 | Oberfläche und API | Verwaltungsadresse, z. B. `filum.intranet.firma.de` (nur intern) |

## 📖 Handbuch

Die vollständige Dokumentation, verständlich für Anwenderinnen und Anwender wie für die IT, steht im **[Handbuch](docs/handbuch/README.md)**, in 23 Kapiteln mit Bildschirmfotos:

- **Arbeiten mit Filum:** [Was ist Filum?](docs/handbuch/01-was-ist-filum.md) · [Erste Schritte](docs/handbuch/02-erste-schritte.md) · [Links anlegen](docs/handbuch/03-links-anlegen.md) · [Links finden und bearbeiten](docs/handbuch/04-links-verwalten.md) · [Zeitplan, Schutz und Regeln](docs/handbuch/05-zeitplan-schutz-regeln.md) · [Kampagnen](docs/handbuch/06-kampagnen-sammlungen.md) · [QR-Codes](docs/handbuch/07-qr-codes.md) · [Analyse](docs/handbuch/08-analyse.md)
- **Administration:** [Domains](docs/handbuch/09-domains.md) · [Team und Rechte](docs/handbuch/10-team-und-rechte.md) · [Einstellungen](docs/handbuch/11-einstellungen.md) · [Datenschutz](docs/handbuch/12-datenschutz.md)
- **Installation und Betrieb:** [Installation](docs/handbuch/13-installation.md) · [Reverse Proxy](docs/handbuch/14-reverse-proxy.md) · [Konfiguration](docs/handbuch/15-konfiguration.md) · [OIDC](docs/handbuch/16-anmeldung-oidc.md) · [Sicherung](docs/handbuch/17-sicherung.md) · [Betrieb und Updates](docs/handbuch/18-betrieb.md) · [REST-API](docs/handbuch/19-rest-api.md) · [Sicherheit](docs/handbuch/20-sicherheit.md) · [Architektur](docs/handbuch/21-architektur.md) · [Tests](docs/handbuch/22-tests.md) · [Einschränkungen](docs/handbuch/23-einschraenkungen.md)

Änderungen je Version: [CHANGELOG.md](CHANGELOG.md). Die API beschreibt sich selbst unter `/api/v1/openapi.json`.

## Entwicklung

```bash
npm install
npm run dev:server   # API und Weiterleitung auf 18081/18080 (Daten in ./data)
npm run dev:web      # Oberfläche mit Hot Reload auf 5173
npm test             # Server-Tests (vitest)
npm run typecheck
scripts/e2e-local.sh # Browser-Tests gegen frischen Build
npm run docs:check   # Links und Anker in README und Handbuch prüfen
scripts/docker-lifecycle-test.sh   # Container: Persistenz, Sicherung, Wiederherstellung (eigene Testkonfiguration, nutzt nicht .env)
```

Für `dev:server` die Ports setzen: `PUBLIC_PORT=18080 ADMIN_PORT=18081 APP_URL=http://localhost:5173 DEFAULT_DOMAIN=localhost:18080`.

## Bildschirmfotos

| Analyse | Domains |
| --- | --- |
| ![Analyse](docs/screenshots/analyse.png) | ![Domains](docs/screenshots/domains.png) |

Neu erzeugen mit Beispieldaten: `npm run docs:screenshots`.

## Lizenz

[MIT](LICENSE)
