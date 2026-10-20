# 22 — Tests und Qualitätssicherung (IT)

> Dieses Kapitel richtet sich an die IT bzw. an Administratoren des Servers.

Filum wird auf drei Ebenen geprüft. Alle drei laufen bei jedem Push in GitHub Actions ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)); ein Release-Image entsteht nur, wenn alle grün sind.

| Ebene | Werkzeug | Befehl | Was geprüft wird |
| --- | --- | --- | --- |
| Server | vitest | `npm test` | rund 300 Tests gegen eine echte SQLite-Datenbank in einem Temp-Verzeichnis |
| Oberfläche | Playwright (Chromium) | `scripts/e2e-local.sh` | Abläufe im Browser gegen einen frischen Build, Desktop und Smartphone |
| Container | Shell + Docker Compose | `scripts/docker-lifecycle-test.sh` | Ersteinrichtung, Persistenz, Sicherung, Wiederherstellung, Härtung im echten Image |

Dazu kommen `npm run typecheck` für Server und Oberfläche und `npm run docs:check`, das alle Links und Anker in README und Handbuch prüft. Die Bildschirmfotos im Handbuch erzeugt `npm run docs:screenshots` aus einer frischen Instanz mit Beispieldaten neu.

## Server-Tests (`tests/`)

Jeder Test startet über `createTestApp()` ([`tests/helpers.ts`](../../tests/helpers.ts)) beide Fastify-Instanzen mit eigener Datenbank und spricht sie mit `inject()` an, also ohne Netzwerk und ohne Mocks der Datenschicht.

| Datei | Schwerpunkt |
| --- | --- |
| `redirect.test.ts` | Weiterleitung, Statuscodes, Cache-Verhalten, Passwortschutz, Zeitpläne, Limits, Vorschau `+` |
| `links.test.ts` | Anlegen, Ändern, Verlauf, Sperre gelöschter Kurzadressen, Duplikathinweis |
| `auth.test.ts` | Anmeldung, Sitzungen, CSRF, Tokens, Rollen, Drosselung |
| `rules.test.ts` | Regeln nach Gerät, Sprache, Uhrzeit, A/B-Varianten |
| `stats.test.ts` | Zählung, Bot-Erkennung, QR-Anteil, Aufbewahrung |
| `domains.test.ts` | Domains, Besitznachweis, Standarddomain |
| `separation.test.ts` | Der öffentliche Port kennt keine API; Verwaltung unter Kurzlink-Host liefert 421 |
| `safefetch.test.ts` | SSRF-Schutz: private Netze, DNS-Rebinding, Weiterleitungen, Zeitlimit |
| `validate.test.ts` | Prüfer für URL, Kurzadresse und Host |
| `io.test.ts` | Import und Export (CSV, JSON) |
| `backup.test.ts`, `persistence.test.ts` | Sicherung, Wiederherstellung, Neustart mit demselben Datenverzeichnis |
| `ops.test.ts`, `openapi.test.ts` | Kommandozeile, Healthcheck, OpenAPI-Beschreibung |
| `regressions.test.ts`, `review-fixes.test.ts` | Je ein Test pro gefundenem und behobenem Fehler |

Regel: Jeder behobene Fehler bekommt einen Test, der ohne die Korrektur fehlschlägt.

## Browser-Tests (`e2e/`)

`scripts/e2e-local.sh` baut Filum, startet eine frische Instanz auf den Ports 28080/28081 mit festem Einrichtungscode und führt Playwright aus. `e2e/setup.ts` erledigt die Ersteinrichtung und speichert die Anmeldung in `e2e/.auth/` (nicht im Repository).

- `flows.spec.ts`: Link-Lebenszyklus, Suche/Filter/Import/Export, Statistik, API-Token, Rollen, Domains, Trennung der Ports, alle Hauptseiten ohne Konsolenfehler, Tastenkürzel
- `mobile.spec.ts`: Bedienung auf Smartphone-Breite ohne seitliches Scrollen

Gegen eine bereits laufende Instanz:

```bash
FILUM_URL=http://localhost:8081 FILUM_PUBLIC=http://localhost:8080 \
FILUM_SETUP_CODE=123-456-789 npx playwright test
```

Einmalig vorher: `npx playwright install chromium`.

## Container-Test

`scripts/docker-lifecycle-test.sh` braucht ein gebautes Image `filum:latest` und eine eigene Testkonfiguration (die `.env` des Servers wird nicht angefasst). Geprüft werden unter anderem: Container wird healthy, Root-Dateisystem schreibgeschützt, kein root, Daten überleben Neustart und Neuanlage, `filum backup`/`verify`/`restore`, Wiederherstellung per Upload mit automatischem Neustart, Trennung öffentlich/intern.

```bash
docker build -t filum:latest .
scripts/docker-lifecycle-test.sh
```

---

Weiter: [23 — Bekannte Einschränkungen](23-einschraenkungen.md) · [Zur Übersicht](README.md)
