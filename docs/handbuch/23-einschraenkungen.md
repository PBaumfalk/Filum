# 23 — Bekannte Einschränkungen

Was Filum bewusst nicht kann oder was nicht unter Realbedingungen geprüft ist.

## Betrieb

- **Eine Instanz.** Filum ist ein Prozess mit SQLite und Zählern im Arbeitsspeicher. Mehrere Container auf derselben Datenbank (Lastverteilung, Hochverfügbarkeit) werden nicht unterstützt. Für die Größenordnung, für die Filum gedacht ist, reicht eine Instanz deutlich aus (siehe [architektur.md](21-architektur.md)).
- **Kein ausgehender HTTP-Proxy.** `HTTP_PROXY`/`HTTPS_PROXY` werden zur Laufzeit nicht beachtet. Ohne direkten Internetzugang Vorschau und Zielprüfung abschalten ([betrieb.md](18-betrieb.md#ohne-internetzugang)).
- **DNS, Zertifikate und Proxy** richtet Filum nicht selbst ein; es liefert nur fertige Bausteine ([domains.md](09-domains.md#was-filum-nicht-selbst-macht)).
- **Kein Downgrade** auf eine ältere Version, nachdem eine Migration gelaufen ist. Der Rückweg führt über die automatische Sicherung `vor-migration-…` ([betrieb.md](18-betrieb.md)).
- **Statistik zählt bis zu 3 Sekunden verzögert.** Aufrufe werden gebündelt geschrieben. Bei einem harten Absturz (nicht bei normalem Beenden) können die Aufrufe dieser letzten Sekunden fehlen.

## Nicht unter Realbedingungen getestet

- **OIDC/authentik:** Der Anmeldeablauf ist mit den Bibliotheksfunktionen getestet, aber nicht gegen eine echte authentik-Instanz. Vor dem produktiven Einsatz einmal mit einem Testkonto durchspielen ([oidc-authentik.md](16-anmeldung-oidc.md)).
- **Tessera:** Die Anbindung folgt der dokumentierten Schnittstelle, ein gemeinsamer Test mit einer laufenden Tessera-Instanz steht aus ([tessera.md](07-qr-codes.md)).
- **Reverse-Proxy-Bausteine** für Caddy, nginx und Traefik sind nach Dokumentation erstellt; automatisiert geprüft wird nur die Trennung der beiden Ports im Container.

## Funktionsumfang

- **Statistik nur als Summen.** Keine einzelnen Aufrufe, keine IP-Adressen, keine Besucherprofile. Das ist gewollt ([datenschutz.md](12-datenschutz.md)); Auswertungen wie „Besucherpfade“ sind damit nicht möglich.
- **Oberfläche und Dokumentation nur auf Deutsch.**
- **QR-Codes mit Logo, Rahmen oder Druckvorschau** erzeugt Filum nicht selbst; dafür gibt es die Übergabe an Tessera. Farbe, Größe bis 4096 px und Fehlerkorrektur stellt Filum selbst ein.

---

[Zur Übersicht](README.md)
