# 17 — Sicherung und Wiederherstellung (IT)

> Dieses Kapitel richtet sich an die IT bzw. an Administratoren des Servers.

Eine Filum-Sicherung ist **eine einzige Datei** (SQLite-Datenbank) mit allem: Links, Domains, Konten, API-Tokens (als Prüfsummen), Einstellungen, Kampagnen, Statistik und Protokoll. Sie entsteht im laufenden Betrieb über die Online-Backup-Schnittstelle von SQLite und ist in sich konsistent. Filum prüft jede neue Sicherung sofort (`integrity_check`, Schemaversion, Tabellen).

Die Befehle für Sichern, Kopieren, Prüfen und Wiederherstellen (Varianten A und B) sind mit `scripts/docker-lifecycle-test.sh` gegen den echten Container getestet. Das Kopierskript für den Cronjob und Variante C sind Vorschläge, die von Ihrer Umgebung abhängen.

## Automatische Sicherungen

- Alle `BACKUP_INTERVAL_HOURS` Stunden (Standard 24) legt Filum `auto-<zeitstempel>.db` in `/data/backups` ab.
- Die letzten `BACKUP_KEEP` (Standard 14) bleiben erhalten, ältere werden gelöscht.
- Vor jeder Datenbankmigration (Update auf eine neue Version) entsteht automatisch `vor-migration-v<n>-….db`.
- Vor jeder Wiederherstellung entsteht `vor-wiederherstellung-….db`. Eine Wiederherstellung lässt sich also selbst wieder rückgängig machen.
- Schlägt eine automatische Sicherung fehl, zeigt **Einstellungen → System** eine Warnung.

**Wichtig:** Die Sicherungen liegen im selben Docker-Volume wie die Datenbank. Gegen einen Plattenausfall schützt das nicht. Kopieren Sie `/data/backups` regelmäßig auf ein anderes System (siehe unten).

**Sicherungen sind vertraulich.** Sie enthalten die Passwort-Hashes aller lokalen Konten, die Prüfsummen der API-Tokens, alle Einstellungen und das Protokoll. Legen Sie Kopien nur dort ab, wo ausschließlich Administratoren lesen können (Verzeichnis `chmod 700`, Freigabe auf dem NAS nur für das Sicherungskonto), und verschlüsseln Sie sie, wenn sie den Server-Raum verlassen.

## Sicherung von Hand

**In der Oberfläche:** Einstellungen → Sicherung → **Jetzt sichern**, danach **Laden** zum Herunterladen.

**Auf der Kommandozeile:**

```bash
docker compose exec filum filum backup
# Sicherung erstellt: /data/backups/manuell-2026-10-19T15-41-07.db (96 KB)

docker compose cp filum:/data/backups/manuell-2026-10-19T15-41-07.db ./filum-sicherung.db
```

Weitere Befehle:

```bash
docker compose exec filum filum backups                  # Liste
docker compose exec filum filum verify /data/backups/…   # Datei prüfen
```

## Sicherungen vom Server wegkopieren

Vorschlag für einen nächtlichen Job auf dem Docker-Host, der die Sicherungen auf ein NAS kopiert. Das Skript bricht bei jedem Fehler ab, kopiert nur, wenn das NAS wirklich eingehängt ist (sonst landeten die Dateien unbemerkt auf der lokalen Platte), läuft nie doppelt und meldet Erfolg und Fehler ins Systemprotokoll:

```bash
#!/bin/sh
# /usr/local/bin/filum-sicherung-kopieren
set -eu
ZIEL=/mnt/nas/filum
LOG="logger -t filum-sicherung"

trap '[ $? -eq 0 ] || $LOG -p user.err "Kopieren der Filum-Sicherungen fehlgeschlagen"' EXIT

exec 9>/run/lock/filum-sicherung.lock
flock -n 9 || { $LOG "läuft bereits"; exit 0; }

mountpoint -q /mnt/nas || { $LOG -p user.err "$ZIEL ist nicht eingehängt"; exit 1; }
mkdir -p "$ZIEL" && chmod 700 "$ZIEL"

cd /opt/filum
docker compose cp filum:/data/backups/. "$ZIEL/"
# Kopien auf dem NAS nach 90 Tagen löschen (Filum selbst behält BACKUP_KEEP Stück)
find "$ZIEL" -name '*.db' -type f -mtime +90 -delete
$LOG "Filum-Sicherungen nach $ZIEL kopiert"
```

```bash
sudo chmod 755 /usr/local/bin/filum-sicherung-kopieren
# /etc/cron.d/filum-sicherung
30 3 * * * root /usr/local/bin/filum-sicherung-kopieren
```

Fehler finden Sie mit `journalctl -t filum-sicherung`. Passen Sie Ziel, Mountpoint und Aufbewahrung an Ihre Umgebung an.

Oder das Volume-Verzeichnis direkt in Ihre bestehende Server-Sicherung aufnehmen: `docker volume inspect filum_filum-data` zeigt den Pfad (`Mountpoint`). Sichern Sie dabei **nur den Unterordner `backups/`**. Die laufende Datenbank `filum.db` (mit `-wal`/`-shm`) ist während des Betriebs keine verlässliche Kopie.

## Wiederherstellen

### Variante A: in der Oberfläche (empfohlen)

1. Einstellungen → Sicherung.
2. Bei der gewünschten Sicherung **Wiederherstellen** → **Stand vom … einspielen**.
3. Filum sichert den aktuellen Stand, beendet sich und spielt die Sicherung beim Neustart ein. Docker startet den Container durch `restart: unless-stopped` automatisch neu. Die Seite lädt nach ein paar Sekunden von selbst.

   Das setzt die Neustart-Regel aus der mitgelieferten `docker-compose.yml` voraus. Fehlt sie (eigene Compose-Datei, `docker run` ohne `--restart`), bleibt Filum nach Schritt 3 beendet; starten Sie es dann mit `docker compose up -d` selbst, die Sicherung wird dabei eingespielt.
4. Alle Benutzer melden sich neu an.

Eine Datei von einem anderen Server spielen Sie unter **Sicherung von einem anderen System einspielen** ein. Filum prüft sie zuerst und zeigt, wie viele Links, Domains und Konten sie enthält.

### Variante B: auf der Kommandozeile

```bash
docker compose cp ./filum-sicherung.db filum:/data/einspielen.db
docker compose exec filum filum restore /data/einspielen.db
# Bereitgelegt: 2 Links, 1 Domains, 1 Konten.
docker compose restart filum
docker compose exec filum rm /data/einspielen.db   # Kopie wieder entfernen
```

Die hochkopierte Datei bleibt sonst neben der Datenbank liegen und wird bei jeder Sicherung des Volumes mitgesichert.

### Variante C: Umzug auf einen neuen Server

1. Filum auf dem neuen Server installieren ([installation.md](13-installation.md)) und starten.
2. Ohne Ersteinrichtung direkt Variante B ausführen. Danach gelten die Konten aus der Sicherung.
3. DNS bzw. Proxy auf den neuen Server umstellen.

## Was beim Wiederherstellen passiert

1. Die Datei wird geprüft: SQLite-Format, Integrität, Filum-Schema. Eine Sicherung von einer **neueren** Filum-Version wird abgelehnt (erst aktualisieren).
2. Sie wird als `/data/wiederherstellung-ausstehend.db` bereitgelegt.
3. Beim nächsten Start: Der aktuelle Stand wird als `vor-wiederherstellung-….db` gesichert, die Datenbank ersetzt, Migrationen laufen bei Bedarf (ältere Sicherungen werden so automatisch aktualisiert).
4. Ist die bereitgelegte Datei beim Start ungültig, wird sie beiseitegelegt (`….ungueltig-<zeit>`) und Filum startet nicht mit beschädigten Daten.

## Notfall: Passwort vergessen

```bash
docker compose exec filum filum reset-password admin@firma.de
# Neues Passwort für admin@firma.de: …
```

Alle Sitzungen des Kontos werden dabei beendet.

---

Weiter: [18 — Betrieb und Updates](18-betrieb.md) · [Zur Übersicht](README.md)
