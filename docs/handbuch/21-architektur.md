# 21 — Architektur (IT)

> Dieses Kapitel richtet sich an die IT bzw. an Administratoren des Servers.

## Überblick

```
                 Internet / Intranet
                         │
                ┌────────┴────────┐
                │  Reverse Proxy  │  TLS, Hostnamen
                └──┬───────────┬──┘
   go.firma.de     │           │   filum.intranet.firma.de
                   ▼           ▼
        ┌──────────────────────────────────────────┐
        │ Container „filum“ (Node 24, ein Prozess) │
        │                                          │
        │  :8080 Öffentlicher Dienst  :8081 Verwaltung
        │  ─ Resolver (LRU-Cache)     ─ REST-API /api/v1
        │  ─ Regeln, UTM, Status      ─ Oberfläche (React)
        │  ─ Hinweisseiten            ─ Auth (Sitzung, Token, OIDC)
        │           │                       │      │
        │           └──── Dienste ──────────┘      │
        │     Links · Domains · Stats · Auth ·     │
        │     Audit · Settings · Jobs · Backups    │
        │                   │                      │
        │        SQLite (WAL) in /data/filum.db    │
        └──────────────────────────────────────────┘
```

## Entscheidungen

| Frage | Entscheidung | Begründung |
| --- | --- | --- |
| Laufzeit | Node.js 24, TypeScript | Langfristig gepflegt, ein Prozess, gleiche Sprache in Server und Oberfläche; derselbe Stack wie Tessera erleichtert den Betrieb. |
| HTTP | Fastify 5 | Schnell, ausgereift, gute Schema- und Hook-Unterstützung. |
| Datenbank | SQLite (better-sqlite3) im WAL-Modus | Keine zweite Komponente, keine Zugangsdaten, Sicherung = eine Datei, synchron und sehr schnell. Für Zehntausende Links und Tausende Aufrufe pro Sekunde mehr als genug. |
| Trennung | Zwei Fastify-Instanzen auf zwei Ports | Der öffentliche Dienst kennt den Verwaltungscode nicht: Trennung durch Aufbau, nicht durch Konfiguration. |
| Weiterleitung | LRU-Cache je Domain und Kurzadresse, gezielte Invalidierung bei Änderungen | Keine Datenbankabfrage im Normalfall; Änderungen wirken sofort. |
| Statistik | Zähler im Speicher, alle 3 s gebündelt in einer Transaktion geschrieben | Die Weiterleitung wartet nie auf die Datenbank. Beim Beenden wird gespült. Nur Aggregate, keine Ereignisse. |
| Suche | SQLite FTS5 mit Trigramm-Tokenizer | Teilwortsuche in Kurzadresse, Ziel, Titel, Notiz und Schlagwörtern, auch bei großen Beständen schnell. |
| Oberfläche | React 19, TanStack Query, React Router, eigenes CSS-Designsystem | Keine Komponentenbibliothek: eigene Gestaltung, kleine Abhängigkeitsliste. Diagramme als eigenes SVG. |
| Validierung | zod (API), eigene Prüfer für URL/Slug/Host | Eine Wahrheit für Oberfläche, API und Import. |
| Abrufe fremder Seiten | eigener SSRF-geschützter Abruf mit undici und festgenagelter IP | Siehe [sicherheit.md](20-sicherheit.md). |
| Auslieferung | Ein Image, mehrstufiger Build, `node:24-bookworm-slim`, amd64/arm64 | Einfach zu betreiben und zu sichern. |

## Datenmodell (Auszug)

| Tabelle | Inhalt |
| --- | --- |
| `domains` | Hostname, intern/öffentlich, Status, Nachweis, Einstellungen |
| `links` | Domain, Kurzadresse (Original und kleingeschrieben für die eindeutige Zuordnung), Ziel, Status, Zeitplan, Limit, Ersatzziel, Passwort-Hash, UTM, Regeln (JSON), Vorschau, Zielprüfung, Zähler |
| `link_versions` | Stand eines Links nach jeder Änderung (Zielverlauf) |
| `slug_tombstones` | Kurzadressen gelöschter Links (bleiben reserviert) |
| `tags`, `link_tags`, `collections`, `campaigns`, `presets`, `favorites` | Ordnung |
| `stats_hourly`, `stats_dims`, `stats_outcomes`, `stats_unknown` | ausschließlich Summen |
| `users`, `sessions`, `api_tokens`, `invites` | Zugang (Geheimnisse nur als Hash) |
| `audit_log`, `reports`, `settings`, `meta` | Protokoll, Meldungen, Einstellungen |

Migrationen sind nummeriert, laufen genau einmal in einer Transaktion und werden nie nachträglich geändert (`src/server/db/migrations.ts`).

## Ablauf einer Weiterleitung

1. Hostname → Domain (aus dem Speicher). Unbekannt oder nicht aktiv → 404-Seite.
2. Kurzadresse kleingeschrieben im Cache nachschlagen; sonst eine indizierte Abfrage. Gelöscht → 410.
3. Status: deaktiviert, noch nicht gestartet, abgelaufen, Limit erreicht → Ersatzziel oder Hinweisseite.
4. Passwort → Formular bzw. Prüfung (gedrosselt).
5. Ziel: erste passende Regel (Gerät, Sprache, Wochentag, Uhrzeit, Zeitraum), sonst gewichtete Variante, sonst Hauptziel. UTM aus Kampagne und Link anhängen, Parameter des Aufrufs weitergeben, `?qr` entfernen.
6. Statuscode: 302/307 oder 301/308. Permanente Codes werden automatisch zu temporären, sobald das Ziel von Zeit, Regeln, Limit oder Passwort abhängt. Permanente Antworten tragen `Cache-Control: public, max-age=<Domain-Einstellung>`, temporäre `no-store`.
7. Zähler im Speicher erhöhen. Fertig.

## Verzeichnisse

```
src/server/        Server (main.ts, cli.ts, app.ts)
  admin/           Verwaltungsdienst: server.ts, routes/, openapi.ts
  redirect/        Öffentlicher Dienst: public.ts, resolver.ts, pages.ts
  services/        Fachlogik: links, domains, stats, auth, rules, jobs, backup, settings, audit
  lib/             Hilfen: validate, safefetch, crypto, meta, ua, time, log
  db/              Datenbank und Migrationen
src/web/           Oberfläche (React): pages/, components/, styles/, lib/
tests/             Server-Tests (vitest)
e2e/               Browser-Tests (Playwright)
scripts/           Build, E2E-Lauf, Docker-Lebenszyklus-Test
docs/              Dokumentation
```

---

Weiter: [22 — Tests und Qualitätssicherung](22-tests.md) · [Zur Übersicht](README.md)
