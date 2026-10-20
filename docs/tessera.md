# Zusammenarbeit mit Tessera

Filum erzeugt QR-Codes selbst (SVG und PNG bis 4096 px, Farbe, Fehlerkorrektur, transparenter Hintergrund). Für gestaltete Codes mit Logo, Rahmen, Druckvorschau, Schnittmarken und Lesbarkeitsprüfung gibt es im Intranet **Tessera**. Filum ersetzt Tessera nicht, sondern übergibt bei Bedarf.

## Ohne Konfiguration

- Inspector → QR-Code: Vorschau, Download als PNG/SVG.
- Der Code enthält standardmäßig `?qr` am Kurzlink. Filum entfernt den Parameter vor der Weiterleitung und zählt solche Aufrufe in der Statistik als „über QR-Code“. Abschaltbar je Download.

## Mit Tessera

1. In Tessera unter **Optionen → Schnittstelle** ein Token für ein Konto mit der Rolle **Bearbeiten** erstellen.
2. In Filums `.env`:
   ```ini
   TESSERA_URL=https://qr.intranet.firma.de
   TESSERA_TOKEN=tsr_…
   ```
3. `docker compose up -d`.

Im Inspector erscheint dann **In Tessera gestalten**. Filum legt über `POST /api/codes` einen statischen URL-Code mit dem Kurzlink (inkl. `?qr`) an, Schlagwort „Filum“, und öffnet ihn im Tessera-Editor (`/codes/<id>`).

Weil der Code auf den Kurzlink zeigt, lässt sich das Ziel später in Filum ändern, ohne den gedruckten Code neu zu erstellen.

## Abhängigkeit

Keine harte: Ist Tessera nicht erreichbar, meldet Filum das verständlich; alle anderen Funktionen laufen weiter. Die Verbindung geht vom Filum-Server zu Tessera (nicht vom Browser), das Token verlässt den Server nie.

Umgesetzt nach der dokumentierten Tessera-Schnittstelle (`docs/handbuch/13-schnittstelle.md` im Tessera-Projekt). Automatisch getestet ist der Aufruf gegen einen nachgebauten Tessera-Endpunkt (Anfrageform, Token, Fehlerfälle). Ein Test gegen eine laufende Tessera-Instanz fand **nicht** statt; das Tessera-Projekt wurde nicht angefasst.
