# Änderungen

Alle nennenswerten Änderungen an Filum. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach [Semantic Versioning](https://semver.org/lang/de/). Datenbankmigrationen laufen beim Start automatisch, vorher legt Filum eine Sicherung an.

## [1.1.0] – 2026-10-20

### Neu
- **Links auf eine andere Domain verschieben:** In der Mehrfachauswahl gibt es die Aktion **Domain** (bei mehr als einer aktiven Domain), mit ausdrücklicher Bestätigung, die geschützte Links eigens zählt. Die alten Adressen bleiben reserviert.
- **Handbuch** in 23 Kapiteln nach Zielgruppen (Anwender, Administration, IT) mit Schnelleinstieg und 12 Bildschirmfotos aus einer Beispielinstanz (`docs/handbuch/`).
- `npm run docs:check` prüft alle Links und Anker in README und Handbuch, auch in der CI. `npm run docs:screenshots` erzeugt die Bildschirmfotos neu.

### Behoben
- Analyse: Im 24-Stunden-Diagramm überlappten die letzten beiden Achsenbeschriftungen.
- Link-Editor: Die Beschriftung „Regel 1“ brach in zwei Zeilen um.
- Container-Test erwartete fest die Schemaversion 1 und schlug seit der Migration auf Version 3 fehl.

### Geändert
- Die Dokumentation liegt jetzt unter `docs/handbuch/`. Verweise in Fehlermeldungen und Konfigurationsdateien zeigen auf die neuen Kapitel.

## [1.0.0] – 2026-10-20

Erste veröffentlichte Version.

### Links
- Kurzlink anlegen per Einfügen und Enter, Ergebnis direkt in der Zwischenablage; mehrere Adressen auf einmal; Lesezeichen „Mit Filum kürzen“; Hinweis auf vorhandene Links zum selben Ziel.
- Eigene oder zufällige Kurzadressen (lesbar oder zufällig), Titel, Notiz, Schlagwörter, Sammlungen, Favoriten.
- Zeitplan, Aufruflimit, Ersatzziel, Passwortschutz, Regeln nach Gerät, Sprache und Uhrzeit, A/B-Varianten, UTM-Kampagnen mit Vorlagen.
- Gelöschte Kurzadressen werden nie neu vergeben; Schutz „verteilt“ für gedruckte Links; Verlauf jeder Zieländerung mit Wiederherstellen.
- Vorschau für Empfänger mit angehängtem `+` und Meldemöglichkeit bei Missbrauch.
- QR-Codes als SVG und PNG (bis 4096 px), Herkunftskennung `?qr`, Übergabe an Tessera.
- Import und Export (CSV, JSON).

### Weiterleitung
- Eigener Dienst auf Port 8080, technisch getrennt von Verwaltung und API (Port 8081); Verwaltung unter Kurzlink-Host antwortet mit 421.
- 302 als Standard, 301/308 mit begrenztem Browser-Cache; Links mit Zeitplan, Regeln, Limit oder Passwort werden automatisch temporär ausgeliefert.
- Vertipper-Radar für aufgerufene, aber nicht vorhandene Kurzadressen.
- Regelmäßige Zielprüfung über einen gegen SSRF gehärteten Abruf.

### Statistik und Datenschutz
- Nur Summen: keine IP-Adressen, keine Cookies bei Besuchern, keine Profile. Drei Stufen (aus, Grund, erweitert), Aufbewahrungsfristen, Bot-Erkennung, QR-Anteil, Textbaustein für die Datenschutzerklärung.

### Verwaltung
- Mehrere Domains mit Besitznachweis und fertigen Bausteinen für Caddy, nginx und Traefik.
- Rollen (Admin, Redaktion, Mitglied, Betrachter), Einladungen, API-Tokens mit Umfang, Anmeldung über OIDC (z. B. authentik), Protokoll aller Änderungen.
- REST-API mit OpenAPI-Beschreibung unter `/api/v1/openapi.json`.
- Automatische Sicherungen, Sicherung und Wiederherstellung in der Oberfläche und per Kommandozeile (`filum backup`, `verify`, `restore`).

### Betrieb
- Ein Docker-Image für amd64 und arm64 (`ghcr.io/pbaumfalk/filum`), schreibgeschütztes Dateisystem, kein root, Healthcheck für beide Dienste.
- CI mit Server-Tests in drei Zeitzonen, Browser-Tests (Desktop und Smartphone) und Container-Test für Persistenz, Sicherung und Wiederherstellung.
