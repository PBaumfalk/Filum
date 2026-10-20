# Handbuch für Anwenderinnen und Anwender

## Einen Kurzlink anlegen

1. Lange Adresse oben in das Eingabefeld einfügen.
2. **Enter** drücken (oder **Kürzen**).
3. Fertig: Der Kurzlink liegt bereits in der Zwischenablage. Mit **Strg/⌘ + V** einfügen.

Optional, bevor Sie Enter drücken:

- **Eigene Kurzadresse** neben dem Domainnamen eintippen, z. B. `herbst`. Ein grünes „frei“ zeigt, dass sie verfügbar ist. Der Zauberstab schlägt eine lesbare Adresse aus dem Ziel vor.
- **Domain** wählen, wenn mehrere eingerichtet sind.
- **Vorlage** wählen (z. B. „Flyer“): setzt Kampagne, Schlagwörter, Ablauf, Schutz in einem Schritt.

Gibt es für dieses Ziel schon einen Kurzlink, weist Filum darauf hin. Sie können ihn wiederverwenden oder trotzdem einen neuen anlegen.

**Mehrere Adressen auf einmal:** Eine Liste mit mehreren Adressen einfügen. Filum erkennt sie und legt mit einem Klick alle an; die Kurzlinks liegen danach untereinander in der Zwischenablage.

**Aus dem Browser:** Unter Einstellungen → API & Lesezeichen gibt es das Lesezeichen „Mit Filum kürzen“. Ein Klick darauf öffnet Filum mit der Adresse der gerade besuchten Seite.

## Links wiederfinden

- **Suche** (Taste `/`): findet Teile von Kurzadresse, Ziel, Titel, Notiz und Schlagwörtern.
- **Status**: aktiv, geplant, abgelaufen, deaktiviert, archiviert.
- **Filtern**: Favoriten, Domain, Sammlung, Kampagne, Schlagwort, „Ziel gestört“.
- **Seitenleiste**: Favoriten, Meine Links, Verteilt & geschützt, Sammlungen, häufige Schlagwörter.
- **Befehlspalette** (`⌘K` bzw. `Strg+K`): Links suchen, kopieren, überall hinspringen.

## Einen Link bearbeiten

Klick auf eine Zeile öffnet rechts die Details:

- **Bearbeiten**: Ziel, Titel, Schlagwörter, Sammlung, Kampagne, Notiz. Darunter aufklappbar: Kurzadresse, Zeitplan und Limit, Passwortschutz, Kampagnenparameter (UTM), Regeln und Varianten, Art der Weiterleitung. Speichern mit **⌘S**.
- **Statistik**: Aufrufe im Zeitverlauf, Anteil über QR-Code, Vorschau-Abrufe von Messengern, Wochenmuster.
- **QR-Code**: Vorschau, Farbe, PNG oder SVG herunterladen, optional „In Tessera gestalten“.
- **Verlauf**: Jede Änderung mit Zeit und Person; ein älterer Stand lässt sich mit einem Klick zurückholen.

Ein geändertes Ziel gilt **sofort**, auch für bereits gedruckte oder verschickte Kurzlinks.

## Deaktivieren, archivieren, löschen

| Aktion | Was Besucher sehen | Wann sinnvoll |
| --- | --- | --- |
| **Deaktivieren** | Hinweisseite „zurzeit nicht aktiv“ (oder das Ersatzziel) | vorübergehend abschalten |
| **Archivieren** | Weiterleitung funktioniert weiter | Liste aufräumen, Link bleibt in Betrieb |
| **Löschen** | Hinweisseite „Link wurde entfernt“ | endgültig. Die Kurzadresse bleibt reserviert und wird nie neu vergeben. |

Mehrere Links bearbeiten: Auf das Symbol links in der Zeile klicken (oder `x`), dann erscheint unten die Leiste für Schlagwörter, Sammlung, Deaktivieren, Archivieren, Export, Löschen.

## Verteilte Links schützen

Für gedruckte oder verschickte Links: **Kurzadresse → Verteilt – vor Versehen schützen**. Dann lässt sich die Kurzadresse nicht mehr ändern, Löschen braucht eine ausdrückliche Bestätigung, und Zieländerungen werden deutlich markiert.

## Zeitplan, Limit, Ersatzziel

- **Aktiv ab / Läuft ab**: z. B. für Aktionen mit festem Zeitraum.
- **Höchstens … Aufrufe**: danach gilt der Link als abgelaufen. Vorschau-Abrufe durch Messenger zählen nicht.
- **Ersatzziel**: wohin Besucher kommen, wenn der Link (noch) nicht aktiv ist, statt einer Hinweisseite.

## Regeln und Varianten

- **Regel**: „Wenn Gerät iPhone, dann App-Store-Adresse“, „Wenn außerhalb 8–18 Uhr, dann Hinweisseite“, „Wenn Sprache Englisch, dann englische Seite“. Die erste passende Regel gewinnt.
- **Varianten**: verteilen Besucher zufällig nach Gewicht auf mehrere Ziele, z. B. für A/B-Vergleiche. Die Statistik zeigt, wie oft jede Variante gewählt wurde.

## Vorschau für Empfänger

Hängt man an einen Kurzlink ein **+** an (z. B. `go.firma.de/herbst+`), zeigt Filum das Ziel an, statt weiterzuleiten. So können Empfänger vor dem Klick sehen, wohin der Link führt, und ihn bei Bedarf als missbräuchlich melden.

## Analyse

Unter **Analyse**: Aufrufe im Zeitraum mit Vergleich zum Zeitraum davor, meistgenutzte Links, Wochenmuster, Kampagnenvergleich, was mit Aufrufen passiert ist (weitergeleitet, unbekannt, abgelaufen …) und das **Vertipper-Radar**: Kurzadressen, die aufgerufen wurden, aber nicht existieren. Ist eine ähnliche vorhanden, leitet „Auch dorthin leiten“ die Tippfehler-Variante mit einem Klick auf das richtige Ziel.

## Tastenkürzel

| Taste | Wirkung |
| --- | --- |
| `N` | Neuer Link (Eingabefeld) |
| `/` | Suche |
| `⌘K` / `Strg+K` | Befehlspalette |
| `J` / `K` oder Pfeiltasten | In der Liste nach unten/oben |
| `Enter` | Link öffnen |
| `C` | Kurzlink der markierten Zeile kopieren |
| `X` | Zeile auswählen |
| `Esc` | Details schließen |
| `⌘S` | Änderungen speichern |
| `G` dann `L`/`A`/`K`/`D`/`E` | Links, Analyse, Kampagnen, Domains, Einstellungen |
