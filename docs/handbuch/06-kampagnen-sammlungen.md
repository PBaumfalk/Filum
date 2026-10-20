# 6 — Kampagnen, Sammlungen und Vorlagen

Drei Werkzeuge bringen Ordnung in viele Links. Sie ergänzen sich:

| Werkzeug | Wofür | Beispiel |
| --- | --- | --- |
| **Kampagne** | Links einer Aktion bündeln, einheitliche UTM-Parameter anhängen, Erfolg vergleichen | „Herbstaktion 2026“ mit Flyer-, Plakat- und Newsletter-Link |
| **Sammlung** | Ablage wie ein Ordner; jeder Link gehört höchstens einer Sammlung an | „Personal“, „Messe“, „IT-Anleitungen“ |
| **Schlagwort** | Freie Stichwörter, beliebig viele je Link | „Druck“, „intern“, „2026“ |
| **Vorlage** | Wiederkehrende Einstellungen beim Anlegen in einem Schritt setzen | „Flyer“: Kampagne, Schutz, Ablauf nach 180 Tagen |

## Kampagnen

Die Ansicht **Kampagnen** in der Seitenleiste zeigt alle laufenden Kampagnen als Karten mit Anzahl der Links, Aufrufen gesamt, Zeitraum und den UTM-Werten. Von jeder Karte geht es mit **Links** zur gefilterten Linkliste und mit **Analyse** zur Auswertung nur dieser Kampagne.

![Kampagnenübersicht](../screenshots/kampagnen.png)

**Neue Kampagne** (ab Rolle *Redaktion*):

| Feld | Hinweis |
| --- | --- |
| **Name** | z. B. „Herbstaktion 2026“ |
| **Farbe** | Erkennungsfarbe in Listen und Diagrammen |
| **Quelle (utm_source)**, **Medium (utm_medium)** | z. B. `flyer`, `print` |
| **Kampagne (utm_campaign)** | wird aus dem Namen vorgeschlagen |
| **Begriff (utm_term)**, **Inhalt (utm_content)** | optional |
| **Läuft von / bis** | nur zur Orientierung; Links laufen nicht automatisch ab |
| **Beschreibung** | frei |

*Diese Parameter hängt Filum bei jedem Aufruf an das Ziel aller Links der Kampagne an.* Ändern Sie hier etwas, gilt es sofort für alle zugehörigen Links. Einzelne Links können Werte im Abschnitt **Kampagnenparameter (UTM)** für sich überschreiben ([Kapitel 5](05-zeitplan-schutz-regeln.md#kampagnenparameter-utm)).

**Links zuordnen**: im Editor über das Feld **Kampagne**, für viele Links gleichzeitig über die Mehrfachauswahl ([Kapitel 4](04-links-verwalten.md#mehrere-links-auf-einmal)), beim Import oder automatisch über eine Vorlage.

**Abgeschlossene Kampagnen** archivieren Sie mit **Archivieren**; sie verschwinden aus der Übersicht und dem Kampagnenvergleich, ihre Links laufen weiter. Wird eine Kampagne gelöscht, bleiben ihre Links erhalten.

## Sammlungen und Schlagwörter

Gepflegt werden beide unter **Einstellungen → Sammlungen & Vorlagen** (ab Rolle *Redaktion*): Sammlungen anlegen mit Name, Farbe und Beschreibung; Schlagwörter umbenennen, einfärben oder entfernen. Neue Schlagwörter entstehen auch einfach beim Eintippen im Editor. Ob Mitglieder das dürfen, legt die Administration fest ([Kapitel 11](11-einstellungen.md#allgemein)).

In der Seitenleiste stehen die ersten Sammlungen und die häufigsten Schlagwörter; ein Klick filtert die Linkliste.

## Vorlagen

Vorlagen sparen Klicks bei wiederkehrenden Aufgaben. Anlegen unter **Einstellungen → Sammlungen & Vorlagen → Neue Vorlage** (ab Rolle *Mitglied*):

| Feld | Wirkung beim Anlegen eines Links |
| --- | --- |
| **Name** | erscheint im Eingabefeld als *Vorlage: Name* |
| **Domain**, **Kampagne**, **Sammlung** | werden gesetzt |
| **Schlagwörter** | kommagetrennt, werden ergänzt |
| **Ablauf nach (Tagen)** | setzt *Läuft ab* entsprechend |
| **Lesbare Kurzadresse** | erzeugt einen sprechenden statt eines zufälligen Kürzels |
| **Als verteilt schützen** | schützt den Link sofort ([Kapitel 4](04-links-verwalten.md#verteilte-links-schützen)) |

Danach: Adresse einfügen, oben **Vorlage: Flyer** wählen, Enter. Vorlagen lassen sich löschen und neu anlegen; nachträgliches Bearbeiten gibt es nicht.

---

Weiter: [7 — QR-Codes](07-qr-codes.md) · [Zur Übersicht](README.md)
