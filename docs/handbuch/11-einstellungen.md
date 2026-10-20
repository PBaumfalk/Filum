# 11 — Einstellungen

Unter **Einstellungen** (Seitenleiste unten, Kürzel `G` `E`) sieht jede Person die Reiter, die zu ihrer Rolle passen ([Kapitel 10](10-team-und-rechte.md)):

| Reiter | sichtbar ab | Inhalt |
| --- | --- | --- |
| **Mein Konto** | Ansehen | Name, Passwort, Sitzungen |
| **Allgemein** | Ansehen (ändern: Admin) | Organisation, Zeitzone, Kurzadressen, Weiterleitung, Zielarten, Vorschau und Zielprüfung |
| **Sammlungen & Vorlagen** | Ansehen | [Kapitel 6](06-kampagnen-sammlungen.md) |
| **Import** | Mitglied | [Kapitel 4](04-links-verwalten.md#import-und-export) |
| **API & Lesezeichen** | Ansehen | API-Tokens ([Kapitel 10](10-team-und-rechte.md#api-tokens)), Lesezeichen „Mit Filum kürzen“ ([Kapitel 3](03-links-anlegen.md#direkt-aus-dem-browser-mit-filum-kürzen)) |
| **Datenschutz** | Ansehen (ändern: Admin) | Statistikstufe, Aufbewahrung, Löschen, Textbaustein |
| **Team & Rollen** | Redaktion | [Kapitel 10](10-team-und-rechte.md) |
| **Sicherheit** | Redaktion | Gesperrte Ziele, Missbrauchsmeldungen, reservierte Kurzadressen |
| **Sicherung** | Admin | [Kapitel 17](17-sicherung.md) |
| **Protokoll** | Admin | [Kapitel 10](10-team-und-rechte.md#protokoll) |
| **System** | Admin | Version, Laufzeit, Datenbank, letzte Sicherung, Zustand von Verwaltung, Weiterleitung, Anmeldung, Zielprüfung und Tessera |

## Allgemein

| Einstellung | Wirkung |
| --- | --- |
| **Name der Organisation** | erscheint in der Seitenleiste unter „Filum“ |
| **Zeitzone** | gilt für Zeitpläne, Regeln nach Uhrzeit und die Tageswerte der Statistik |
| **Automatische Kurzadressen** | *Zufällig und telefontauglich* (nur Kleinbuchstaben und Ziffern ohne Verwechsler wie `l`/`1` oder `o`/`0`, gut zum Vorlesen und Abtippen) oder *Lesbar aus dem Ziel* |
| **Standard-Weiterleitung** | 302 (empfohlen), 307, 301 oder 308 ([Kapitel 5](05-zeitplan-schutz-regeln.md#weiterleitung)) |
| **Erlaubte Zielarten** | `http`, `https`, außerdem auf Wunsch `mailto`, `tel`, `sms`, `geo`, z. B. für einen Kurzlink auf eine Telefonnummer |
| **Vorschau und Zielprüfung** | *Titel und Vorschaubild laden* beim Anlegen; *Ziele regelmäßig prüfen* (meldet gestörte Links). Auf Servern ohne Internetzugang abschalten. |
| **Mitglieder dürfen neue Schlagwörter anlegen** | sonst nur vorhandene verwenden |

## Datenschutz

**Statistik** in drei Stufen:

| Stufe | Was gezählt wird |
| --- | --- |
| **Aus** | nichts; Weiterleitungen funktionieren unverändert |
| **Grundstatistik** (Standard) | Aufrufe je Link und Stunde, QR-Anteil, Bots getrennt |
| **Erweitert** | zusätzlich Herkunft (Website), Gerät, Betriebssystem, Browser und Sprache, nur als Tagessummen |

In keiner Stufe speichert Filum IP-Adressen, Cookies oder Kennungen von Besuchern. Weiter auf diesem Reiter:

- **Aufbewahrung**: Aufrufe je Stunde und Detailauswertungen jeweils 7 bis 3650 Tage; ältere Werte löscht Filum automatisch.
- **Fehlaufrufe merken**: *Unbekannte Kurzadressen zählen* für das Vertipper-Radar ([Kapitel 8](08-analyse.md#vertipper-radar)).
- **Statistik löschen**: nur die Detailauswertungen oder alles.
- **Textbaustein für Ihre Datenschutzerklärung**: passt sich der gewählten Stufe an, mit **Text kopieren**. Bitte vor der Veröffentlichung prüfen.

Hintergrund und rechtliche Einordnung: [Kapitel 12](12-datenschutz.md).

## Sicherheit

- **Gesperrte Ziele**: Domains (inklusive Subdomains), die sich nicht verkürzen lassen, weder in der Oberfläche noch per API oder Import. Eine Domain pro Zeile, z. B. bekannte Phishing-Seiten oder Filesharing-Dienste.
- **Missbrauch melden**: Mit *Meldungen annehmen* können Besucher über die Vorschauseite (`go.firma.de/abc+`) einen Link melden: Phishing oder Betrug, Schadsoftware, Spam, Rechtswidriger Inhalt, Funktioniert nicht, Anderes.
- **Meldungen**: *Von Besuchern gemeldete Links. Prüfen Sie das Ziel und deaktivieren Sie den Link bei Bedarf.* Aktionen: **Link ansehen**, **Erledigt**, **Verwerfen**, **Wieder öffnen**.
- **Reservierte Kurzadressen**: Adressen gelöschter oder umbenannter Links, die Filum für immer sperrt. Ein Admin kann eine einzelne mit **Freigeben** wieder vergeben lassen, etwa nach einem Tippfehler, der nie verteilt wurde.
- **Eingebaute Schutzmechanismen**: Übersicht, was Filum ohnehin tut, etwa Ziele mit eingebetteten Zugangsdaten ablehnen, Durchprobieren drosseln, interne Netze vor Vorschau und Zielprüfung abschirmen. Technisch: [Kapitel 20](20-sicherheit.md).

---

Weiter: [12 — Datenschutz](12-datenschutz.md) · [Zur Übersicht](README.md)
