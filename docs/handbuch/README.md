# Filum — Handbuch

Willkommen im Handbuch von **Filum**, dem selbst gehosteten Link-Management-Studio. Teil A richtet sich an alle, die Links anlegen und auswerten; technische Vorkenntnisse sind nicht nötig. Teil B ist für Admins, Teil C für die IT, die Filum installiert und betreibt.

## Inhalt

**Teil A — Arbeiten mit Filum**

| Kapitel | Inhalt |
| --- | --- |
| [1 — Was ist Filum?](01-was-ist-filum.md) | Wofür, Grundbegriffe, Datenschutz-Prinzip |
| [2 — Erste Schritte](02-erste-schritte.md) | Anmelden, Ersteinrichtung, die Oberfläche, der erste Link |
| [3 — Links anlegen](03-links-anlegen.md) | Einfügen und Enter, eigene Kurzadresse, mehrere auf einmal, Lesezeichen |
| [4 — Links finden und bearbeiten](04-links-verwalten.md) | Liste, Suche, Editor, Verlauf, Schutz, Mehrfachauswahl, Import/Export, Tastenkürzel |
| [5 — Zeitplan, Schutz und Regeln](05-zeitplan-schutz-regeln.md) | Ablauf, Limit, Passwort, UTM, Regeln nach Gerät/Sprache/Uhrzeit, A/B-Varianten, Vorschau |
| [6 — Kampagnen, Sammlungen und Vorlagen](06-kampagnen-sammlungen.md) | Ordnung für viele Links |
| [7 — QR-Codes](07-qr-codes.md) | Herunterladen, QR-Anteil messen, Gestaltung mit Tessera |
| [8 — Analyse](08-analyse.md) | Aufrufe, Kampagnenvergleich, Vertipper-Radar, wie gezählt wird |

**Teil B — Administration**

| Kapitel | Inhalt |
| --- | --- |
| [9 — Domains](09-domains.md) | Domains hinzufügen, Besitznachweis, Einstellungen je Domain |
| [10 — Team und Rechte](10-team-und-rechte.md) | Rollen, Einladungen, Passwörter, API-Tokens, Protokoll |
| [11 — Einstellungen](11-einstellungen.md) | Alle Reiter im Überblick, Statistikstufen, Missbrauchsmeldungen |
| [12 — Datenschutz](12-datenschutz.md) | Was gespeichert wird und was nicht, Bewertung, Textbaustein |

**Teil C — Installation und Betrieb (IT)**

| Kapitel | Inhalt |
| --- | --- |
| [13 — Installation](13-installation.md) | Vom leeren Linux-Server bis zum ersten Login, fertiges Image von ghcr.io |
| [14 — Reverse Proxy](14-reverse-proxy.md) | Caddy, nginx, Traefik; HTTPS; Trennung von Verwaltung und Weiterleitung |
| [15 — Konfiguration](15-konfiguration.md) | Alle Umgebungsvariablen |
| [16 — Anmeldung über OIDC](16-anmeldung-oidc.md) | authentik einrichten, Gruppen auf Rollen abbilden |
| [17 — Sicherung und Wiederherstellung](17-sicherung.md) | Automatisch, von Hand, Umzug, Notfall |
| [18 — Betrieb und Updates](18-betrieb.md) | Updates, Rollback, Überwachung, Kommandozeile, ohne Internet |
| [19 — REST-API](19-rest-api.md) | Tokens, Beispiele, OpenAPI |
| [20 — Sicherheitskonzept](20-sicherheit.md) | Angriffsflächen und Schutz |
| [21 — Architektur](21-architektur.md) | Aufbau, Entscheidungen, Datenmodell |
| [22 — Tests](22-tests.md) | Server-, Browser- und Container-Tests |
| [23 — Bekannte Einschränkungen](23-einschraenkungen.md) | Was Filum bewusst nicht kann |

## Schnelleinstieg in 5 Minuten

1. Filum im Browser öffnen und anmelden ([Kapitel 2](02-erste-schritte.md)).
2. Eine lange Adresse oben in **Lange Adresse einfügen** einfügen, **Enter**. Der Kurzlink ist kopiert ([Kapitel 3](03-links-anlegen.md)).
3. In der Liste auf den neuen Link klicken: Titel und Schlagwörter ergänzen, **Speichern**.
4. Im Reiter **QR-Code** den Code als PNG oder SVG herunterladen ([Kapitel 7](07-qr-codes.md)).
5. Wird der Link gedruckt: **Kurzadresse → Verteilt – vor Versehen schützen** ([Kapitel 4](04-links-verwalten.md#verteilte-links-schützen)).

Ein paar Tage später zeigt **Analyse**, wie oft der Link aufgerufen wurde und wie viele davon über den QR-Code kamen ([Kapitel 8](08-analyse.md)).

## Für die IT in einem Satz

`git clone`, `.env` aus `.env.example` anlegen (`APP_URL`, `DEFAULT_DOMAIN`), `docker compose up -d --build`, Einrichtungscode aus `docker compose logs filum` ablesen; Port 8080 bekommt die Kurzlink-Domains, Port 8081 nur das Intranet ([Kapitel 13](13-installation.md)).
