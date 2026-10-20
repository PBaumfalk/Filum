# 12 — Datenschutz

Filum ist so gebaut, dass die eigentliche Aufgabe, eine Weiterleitung, **keinerlei personenbezogene Daten** braucht und speichert. Die Statistik besteht nur aus Summen.

## Was bei einem Aufruf eines Kurzlinks passiert

| Datum | Verwendung | Gespeichert? |
| --- | --- | --- |
| IP-Adresse | Drosselung gegen Durchprobieren von Adressen und Passwortraten | **Nein.** Nur im Arbeitsspeicher, nach spätestens 30 Minuten vergessen. Auch nicht in Logs. |
| User-Agent | Bot-Erkennung; Regeln nach Gerät; im erweiterten Modus Geräteklasse, Betriebssystem, Browserfamilie | **Nein.** Gespeichert werden höchstens die Kategorien als Tageszähler (z. B. „mobil: 37“). |
| Referrer | im erweiterten Modus: Herkunfts-Domain | Nur der Domainname als Tageszähler, nie Pfad oder Parameter. |
| Accept-Language | Regeln nach Sprache; im erweiterten Modus Sprachstatistik | Nur das Sprachkürzel als Tageszähler. |
| Cookies | – | Filum setzt bei Besuchern **keine** Cookies. |

## Statistikmodi

| Modus | Inhalt |
| --- | --- |
| Aus | Kein Zeitverlauf. Nur ein Gesamtzähler je Link (für Aufruflimits). |
| Grundstatistik (Standard) | Aufrufe je Link und Stunde, davon über QR-Code, Bots getrennt; Ergebnisse je Domain und Tag (weitergeleitet, nicht gefunden, abgelaufen …); unbekannte Kurzadressen je Tag (max. 2000 je Domain und Tag). |
| Erweitert | zusätzlich Tagessummen je Link nach Herkunfts-Domain, Geräteklasse, Betriebssystem, Browserfamilie, Sprache. |

Es gibt keine Einzelereignisse in der Datenbank und keine Möglichkeit, „Besucher“ zu zählen. Filum zählt Aufrufe, keine Personen.

## Aufbewahrung und Löschen

- Stundenwerte: Standard 395 Tage, einstellbar 7–3650.
- Detailwerte (erweitert): Standard 90 Tage.
- Unbekannte Kurzadressen: höchstens 90 Tage.
- Protokoll der Verwaltungsaktionen: 2 Jahre.
- Löschen: Statistik eines Links (Inspector → Statistik), nur Detailwerte oder alles (Einstellungen → Datenschutz). Beim Wechsel von „Erweitert“ auf „Grundstatistik“ werden die Detailwerte sofort gelöscht.

## Externe Verbindungen

- Keine Telemetrie, keine Update-Prüfung, keine CDNs. Schriften und Oberfläche werden vom eigenen Server geladen.
- Filum ruft nur Zieladressen ab, die Ihre Benutzer selbst eintragen (Titel, Vorschaubild, Erreichbarkeit), und das nur, wenn **Einstellungen → Allgemein → Vorschau und Zielprüfung** eingeschaltet ist. Dabei werden keine Daten über Besucher übertragen.
- Optional: Tessera (eigener Dienst im Intranet) und der OIDC-Anbieter.

## Konten der Mitarbeitenden

Gespeichert werden E-Mail, Name, Rolle, Passwort-Hash (scrypt), Zeitpunkt der letzten Anmeldung sowie im Protokoll, wer wann welchen Link geändert hat. Sitzungen und API-Tokens liegen nur als SHA-256-Prüfsummen vor.

## Textbaustein

Unter **Einstellungen → Datenschutz** erzeugt Filum einen Formulierungsvorschlag für Ihre Datenschutzerklärung, passend zum gewählten Modus. Er ersetzt keine rechtliche Prüfung.

## Bewertung

Im Modus „Grundstatistik“ und „Aus“ verarbeitet Filum über die Weiterleitung hinaus keine personenbezogenen Daten dauerhaft. Die kurzzeitige Verarbeitung der IP-Adresse im Arbeitsspeicher dient der Sicherheit des Dienstes (berechtigtes Interesse). Der Modus „Erweitert“ speichert ausschließlich aggregierte Kategorien ohne Personenbezug. Ob dafür eine Information der Betroffenen nötig ist, sollte die verantwortliche Stelle im Einzelfall prüfen. Der Textbaustein deckt diesen Fall ab.

---

Weiter: [13 — Installation](13-installation.md) · [Zur Übersicht](README.md)
