# Betrieb

## Täglicher Betrieb

| Aufgabe | Befehl |
| --- | --- |
| Status | `docker compose ps` (Spalte STATUS: `healthy`) |
| Logs | `docker compose logs -f filum` (JSON, eine Zeile je Ereignis) |
| Neustart | `docker compose restart filum` |
| Stoppen / Starten | `docker compose down` / `docker compose up -d` (Daten bleiben im Volume) |
| Kommandozeile | `docker compose exec filum filum help` |
| Systemzustand | Einstellungen → System (Version, Datenbankgröße, letzte Sicherung, Warnungen) |
| Gesundheit beider Dienste | `docker compose exec filum filum health` |

> **Niemals `docker compose down -v`.** Die Option `-v` löscht das Volume `filum-data` und damit Datenbank **und** alle Sicherungen darin. `docker compose down` ohne `-v` ist unbedenklich. Ebenso `docker volume prune` und `docker system prune --volumes` nur, wenn Sie genau wissen, welche Volumes betroffen sind.

## Update auf eine neue Version

```bash
cd /opt/filum
docker compose exec filum filum backup          # zusätzliche Sicherheit
docker tag filum:latest filum:vorher            # bisheriges Image für den Rückweg aufheben
# neue Version der Dateien einspielen (git pull oder rsync, siehe installation.md)
docker compose up -d --build
docker compose ps                               # nach ~20 s: healthy
docker compose logs filum | grep -i migration   # zeigt ausgeführte Migrationen
```

Mit fertigem Image (`FILUM_IMAGE` in `.env`, siehe [installation.md](installation.md#ohne-eigenes-build)) statt `git pull` und `--build`: `docker compose pull && docker compose up -d`. Für den Rückweg vorher die laufende Version notieren (`docker compose images`) und `FILUM_IMAGE` auf genau diese Version setzen.

Was dabei passiert:

- Vor jeder Datenbankmigration legt Filum automatisch `vor-migration-v<n>-….db` an.
- Migrationen laufen in einer Transaktion; schlägt eine fehl, bleibt der alte Stand unverändert und Filum startet nicht.
- Kurzadressen, Ziele und Domains werden von Migrationen nie verändert. Bereits verteilte Links funktionieren nach dem Update weiter.
- Ein Downgrade auf eine ältere Version mit neuerer Datenbank verweigert Filum mit einer klaren Meldung (`Die Datenbank hat Schemaversion …`).

### Zurück zur vorherigen Version (Rollback)

```bash
cd /opt/filum
docker compose down
docker tag filum:vorher filum:latest
# Nur falls beim Update eine Migration lief (Log oder ls zeigt vor-migration-…):
docker compose run --rm --no-deps filum ls -l /data/backups
docker compose run --rm --no-deps filum filum restore /data/backups/vor-migration-v1-….db
docker compose up -d                            # ohne --build, sonst entsteht wieder die neue Version
```

Die Wiederherstellung von `vor-migration-…` setzt auch alle Änderungen seit dem Update zurück (neue Links, Aufrufzahlen). Der verworfene Stand bleibt als `vor-wiederherstellung-….db` erhalten. Liegen auch die Programmdateien wieder auf dem alten Stand (`git checkout`), funktioniert später auch `--build` wieder wie gewohnt.

## Was tun, wenn Filum nicht startet

**Erkennen:** `docker compose ps` zeigt `Restarting` oder `unhealthy`, der Container startet in einer Schleife neu. Die Ursache steht in der letzten Logzeile mit `level` 60:

```bash
docker compose logs --tail 30 filum
# … "msg":"Filum konnte nicht starten: …"
```

Die Schleife anhalten, während Sie suchen: `docker compose stop filum`. Alle folgenden Befehle mit `docker compose run --rm --no-deps filum …` laufen in einem eigenen, kurzlebigen Container mit demselben Volume und funktionieren auch, wenn Filum selbst nicht startet.

| Meldung | Ursache | Abhilfe |
| --- | --- | --- |
| `Umgebungsvariable … muss …`, `APP_URL ist keine gültige Adresse`, `LOG_LEVEL muss …` | Tippfehler in `.env` | `.env` korrigieren, `docker compose up -d` |
| `Das Datenverzeichnis /data ist nicht beschreibbar … Benutzer-ID 1000` | Statt des Volumes ist ein Host-Ordner eingebunden, der root gehört | auf dem Host `sudo chown -R 1000:1000 /pfad/zum/ordner`, dann `docker compose up -d` |
| `Die Datenbank … ist beschädigt` | Datei defekt (Plattenfehler, Stromausfall auf ungeeignetem Speicher) | Sicherung einspielen, siehe unten |
| `Die Datenbank hat Schemaversion …, diese Filum-Version kennt nur bis …` | Älteres Image mit neuerer Datenbank (Downgrade) | neuere Version starten oder Rollback wie oben mit `vor-migration-…` |
| `Bereitgelegte Wiederherstellung ist ungültig …` | Die bereitgelegte Datei war defekt; sie wurde schon beiseitegelegt | `docker compose up -d` startet mit dem bisherigen Stand |
| `port is already allocated` (meldet `docker compose up` selbst) | anderer Dienst auf dem Host-Port | `PUBLIC_HOST_PORT`/`ADMIN_HOST_PORT` in `.env` ändern |

**Sicherung einspielen, ohne dass Filum läuft:**

```bash
docker compose run --rm --no-deps filum ls -l /data/backups
docker compose run --rm --no-deps filum filum verify /data/backups/auto-2026-10-19T03-00-00.db
docker compose run --rm --no-deps filum filum restore /data/backups/auto-2026-10-19T03-00-00.db
docker compose up -d
```

Beim Start ersetzt Filum die Datenbank durch die bereitgelegte Sicherung und bewahrt den bisherigen Stand als `vor-wiederherstellung-….db` auf. Ist die Datenbank so beschädigt, dass schon dieses Aufbewahren scheitert (Start bricht erneut ab), legen Sie die defekte Datei vorher selbst beiseite:

```bash
docker compose run --rm --no-deps filum sh -c 'cd /data && mv filum.db filum.db.defekt && rm -f filum.db-wal filum.db-shm'
docker compose up -d
```

Eine Sicherung von außen kopieren Sie vorher mit `docker compose cp ./datei.db filum:/data/einspielen.db` ins Volume. Das funktioniert auch bei gestopptem Container, solange er nicht mit `docker compose down` entfernt wurde.

## Überwachung

- `GET /healthz` auf beiden Ports liefert `{"status":"ok"}`. Port 8081 prüft zusätzlich die Datenbank. Der Docker-Healthcheck (`filum health`) prüft beide Ports.
- Von außen gehört je ein Monitor auf beide Wege, damit auch ein Fehler im Proxy auffällt:

```bash
curl -fsS https://go.firma.de/healthz                # öffentlicher Dienst über den Proxy
curl -fsS https://filum.intranet.firma.de/healthz    # Verwaltung, aus dem Intranet
curl -fsS http://127.0.0.1:8081/healthz              # direkt auf dem Docker-Host
```

  In Uptime Kuma: zwei Monitore vom Typ *HTTP(s) – Schlüsselwort* auf diese Adressen, Schlüsselwort `ok`, Intervall 60 s. Zusätzlich lohnt ein Monitor auf einen echten Kurzlink (Erwartung: Statuscode 302).
- Logs sind JSON, eine Zeile je Ereignis. Das Feld `level` ist eine Zahl:

| `level` | Bedeutung | Beispiele |
| --- | --- | --- |
| 30 | info | `Filum läuft`, `Datenbankmigration ausgeführt`, `Automatische Sicherung erstellt` |
| 40 | warn | Einrichtungscode, `Sicherung wiederhergestellt` |
| 50 | error | `Automatische Sicherung fehlgeschlagen`, `Statistik konnte nicht geschrieben werden` |
| 60 | fatal | `Filum konnte nicht starten: …` |

  Warnungen und Fehler der letzten 24 Stunden:

```bash
docker compose logs --no-log-prefix --since 24h filum | jq -cR 'fromjson? | select(.level >= 40) | {time, level, msg}'
```

- Logs enthalten keine IP-Adressen, keine Tokens, keine Passwörter. Zeitstempel sind UTC.

## Ohne Internetzugang

Filum unterstützt **keinen ausgehenden HTTP-Proxy** (`HTTP_PROXY`/`HTTPS_PROXY` werden zur Laufzeit nicht beachtet). Hat der Server keinen direkten Internetzugang, schlagen Vorschau und Zielprüfung für externe Ziele fehl und melden alle Links als gestört. Schalten Sie beides dann ab:

- in `.env`: `HEALTH_CHECK_INTERVAL_MIN=0`
- in der Oberfläche: Einstellungen → Allgemein → **Vorschau und Zielprüfung**, beide Schalter aus

Intranet-Ziele, die Filum direkt erreicht, geben Sie stattdessen mit `FETCH_ALLOW_HOSTS` frei.

**Bauen hinter einem Proxy:** Der Build lädt npm-Pakete und Debian-Pakete. Docker reicht die Proxy-Angaben nur an den Build weiter, sie landen nicht im Image:

```bash
docker build --build-arg HTTP_PROXY=http://proxy.firma.de:3128 \
  --build-arg HTTPS_PROXY=http://proxy.firma.de:3128 -t filum:latest .
```

**Server ganz ohne Internet:** Image auf einem Rechner mit Internet bauen, als Datei übertragen und laden:

```bash
# auf dem Build-Rechner (Plattform des Servers angeben, z. B. vom Mac für einen amd64-Server)
docker build --platform linux/amd64 -t filum:1.0.0 .
docker save filum:1.0.0 | gzip > filum-1.0.0.tar.gz

# auf dem Server
gunzip -c filum-1.0.0.tar.gz | docker load
docker tag filum:1.0.0 filum:latest
docker compose up -d          # ohne --build
```

## Ressourcen

Gemessen auf einem Apple-M-Rechner (arm64, ein Node-Prozess, 64 parallele Verbindungen):

| Messung | Ergebnis |
| --- | --- |
| Weiterleitungen pro Sekunde (bekannter Link) | rund 46 000 |
| Antwortzeit p50 / p99 | 1,2 ms / 2,6 ms |
| Arbeitsspeicher im Leerlauf / unter Last | ca. 100 MB / ca. 155 MB |

Auf einem kleinen Intranet-Server sind deutlich niedrigere Werte zu erwarten; für Tausende Aufrufe pro Minute reicht ein Kern. Die Compose-Datei begrenzt den Speicher auf 512 MB.

Datenbankgröße: grob 1 KB je Link plus Statistik (eine Zeile je Link und Stunde mit Aufrufen).

## Wartung, die Filum selbst erledigt

Alle 6 Stunden: Statistik jenseits der Aufbewahrungsfrist löschen, abgelaufene Sitzungen und Einladungen entfernen, Protokolleinträge älter als 2 Jahre löschen, ungenutzte Vorschaubilder entfernen, `PRAGMA optimize`.

## Kommandozeile

```
filum backup                   Sicherung anlegen
filum backups                  Sicherungen auflisten
filum verify <datei>           Sicherung prüfen
filum restore <datei>          Wiederherstellung beim nächsten Start
filum reset-password <e-mail>  Neues Zufallspasswort setzen
filum setup-code               Einrichtungscode anzeigen
filum integrity                Datenbank prüfen
filum health                   beide Dienste über /healthz prüfen
```

`backups`, `verify`, `setup-code` und `integrity` lesen nur und verändern die Datenbank nicht (keine Migration). Sie funktionieren daher auch mit `docker compose run --rm --no-deps filum filum …`, wenn Filum selbst nicht startet.
