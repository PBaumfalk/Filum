#!/usr/bin/env bash
# Prüft Filum im echten Container: Ersteinrichtung, Persistenz über Neustart und
# Neuanlage, Sicherung (CLI und API), Wiederherstellung (CLI und Upload), Healthcheck.
# Aufruf: scripts/docker-lifecycle-test.sh   (benötigt ein gebautes Image filum:latest)
set -euo pipefail
cd "$(dirname "$0")/.."

P=filum-lifecycle
A=http://localhost:38081
PUB=http://localhost:38080
JAR=$(mktemp)
WORK=$(mktemp -d)
# Eigene Testkonfiguration statt der .env des Servers: Die Werte gelten für die
# Variablenersetzung (--env-file), das Override ersetzt das Pflicht-env_file aus docker-compose.yml.
cat > "$WORK/test.env" <<'ENV'
APP_URL=http://localhost:38081
DEFAULT_DOMAIN=localhost:38080
PUBLIC_BIND=127.0.0.1
PUBLIC_HOST_PORT=38080
ADMIN_BIND=127.0.0.1
ADMIN_HOST_PORT=38081
SETUP_CODE=135-246-357
TZ=Europe/Berlin
ENV
cat > "$WORK/override.yml" <<YML
services:
  filum:
    env_file: !reset
      - path: $WORK/test.env
YML
pass=0
dc() { docker compose -p $P --env-file "$WORK/test.env" -f docker-compose.yml -f "$WORK/override.yml" "$@"; }
ok() { echo "  ✓ $1"; pass=$((pass + 1)); }
fail() { echo "  ✗ $1"; dc logs --tail 40 filum || true; exit 1; }
cleanup() { dc down -v >/dev/null 2>&1 || true; rm -rf "$JAR" "$WORK"; }
trap cleanup EXIT

wait_healthy() {
  for _ in $(seq 1 60); do
    s=$(docker inspect -f '{{.State.Health.Status}}' "$(dc ps -q filum)" 2>/dev/null || echo none)
    [ "$s" = healthy ] && return 0
    sleep 1
  done
  return 1
}
api() { curl -sf -H 'content-type: application/json' -H 'x-filum: 1' -b "$JAR" -c "$JAR" "$@"; }
tok() { curl -sf -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' "$@"; }
loc() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$PUB/$1"; }

echo "1. Frischer Start"
dc down -v >/dev/null 2>&1 || true
dc up -d >/dev/null
wait_healthy && ok "Container ist healthy" || fail "Container nicht healthy"
[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$(dc ps -q filum)")" = true ] && ok "Root-Dateisystem schreibgeschützt" || fail "nicht read-only"
[ "$(docker exec "$(dc ps -q filum)" id -u)" != 0 ] && ok "läuft nicht als root" || fail "läuft als root"

echo "2. Einrichtung und Daten"
api "$A/api/v1/setup" -d '{"code":"135-246-357","email":"admin@test.de","name":"Admin","password":"lifecycle-pass-1"}' >/dev/null && ok "Ersteinrichtung" || fail "Setup"
TOKEN=$(api "$A/api/v1/tokens" -d '{"name":"lc","scope":"admin"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
tok "$A/api/v1/links" -d '{"url":"https://www.example.org/eins","slug":"eins"}' >/dev/null
tok "$A/api/v1/links" -d '{"url":"https://www.example.org/zwei","slug":"zwei","tags":["Druck"],"protected":true}' >/dev/null
# Browser-User-Agent: curl selbst zählt Filum (richtigerweise) als Bot
for _ in 1 2 3; do curl -s -o /dev/null -A 'Mozilla/5.0 (Windows NT 10.0) Chrome/141' "$PUB/eins"; done
[ "$(loc eins)" = "302 https://www.example.org/eins" ] && ok "Weiterleitung eins" || fail "Weiterleitung eins"

echo "3. Neustart des Containers"
dc restart >/dev/null
wait_healthy || fail "nach Neustart nicht healthy"
[ "$(loc zwei)" = "302 https://www.example.org/zwei" ] && ok "Link überlebt Neustart" || fail "Link fehlt nach Neustart"
rm -f "$JAR"
api "$A/api/v1/login" -d '{"email":"admin@test.de","password":"lifecycle-pass-1"}' >/dev/null && ok "Anmeldung nach Neustart" || fail "Login"
clicks=$(tok "$A/api/v1/links?q=eins" | python3 -c 'import sys,json;print(json.load(sys.stdin)["items"][0]["clicks"])')
[ "$clicks" = 3 ] && ok "Aufrufzähler erhalten (3)" || fail "Zähler $clicks"

echo "4. Container neu anlegen (wie bei einem Update)"
dc down >/dev/null
dc up -d >/dev/null
wait_healthy || fail "nach Neuanlage nicht healthy"
[ "$(loc eins)" = "302 https://www.example.org/eins" ] && ok "Daten im Volume erhalten" || fail "Daten weg"

echo "5. Sicherung per Kommandozeile"
out=$(dc exec -T filum filum backup)
echo "$out" | grep -q "Sicherung erstellt" && ok "filum backup" || fail "CLI-Backup: $out"
file=$(echo "$out" | sed -n 's#.*\(/data/backups/[^ ]*\.db\).*#\1#p')
dc cp "filum:$file" "$WORK/sicherung.db" >/dev/null && ok "Sicherung aus dem Container kopiert" || fail "cp"
dc exec -T filum filum verify "$file" | grep -qE "In Ordnung: Schema [0-9]+, 2 Links" && ok "Sicherung geprüft (2 Links)" || fail "verify"

echo "6. Daten verändern"
tok -X PATCH "$A/api/v1/links/1" -d '{"url":"https://www.example.org/geaendert"}' >/dev/null
tok -X DELETE "$A/api/v1/links/2?confirm=protected" >/dev/null
[ "$(loc eins)" = "302 https://www.example.org/geaendert" ] && ok "Ziel geändert" || fail "Änderung"
[ "$(loc zwei | cut -d' ' -f1)" = 410 ] && ok "Link zwei gelöscht (410)" || fail "Löschen"

echo "7. Wiederherstellung per Kommandozeile"
dc cp "$WORK/sicherung.db" filum:/data/einspielen.db >/dev/null
dc exec -T filum filum restore /data/einspielen.db | grep -q Bereitgelegt && ok "filum restore" || fail "restore"
dc restart >/dev/null
wait_healthy || fail "nach Restore nicht healthy"
[ "$(loc eins)" = "302 https://www.example.org/eins" ] && ok "Altes Ziel wiederhergestellt" || fail "Restore-Ziel: $(loc eins)"
[ "$(loc zwei)" = "302 https://www.example.org/zwei" ] && ok "Gelöschter Link wieder da" || fail "Restore zwei"
dc exec -T filum sh -c 'ls /data/backups' | grep -q vor-wiederherstellung && ok "Vorheriger Stand automatisch gesichert" || fail "keine Vor-Sicherung"
dc exec -T filum rm /data/einspielen.db && ok "Hochkopierte Datei entfernt" || fail "rm einspielen.db"

echo "8. Wiederherstellung per Hochladen in der Oberfläche/API"
rm -f "$JAR"
api "$A/api/v1/login" -d '{"email":"admin@test.de","password":"lifecycle-pass-1"}' >/dev/null
tok -X PATCH "$A/api/v1/links/1" -d '{"url":"https://www.example.org/nochmal-geaendert"}' >/dev/null
curl -sf -b "$JAR" -H 'x-filum: 1' -H 'content-type: application/octet-stream' --data-binary "@$WORK/sicherung.db" "$A/api/v1/backups/upload?restore=1" | grep -q startet && ok "Upload angenommen, Neustart angekündigt" || fail "Upload"
sleep 3
wait_healthy || fail "nach Upload-Restore nicht healthy"
for _ in $(seq 1 20); do [ "$(loc eins)" = "302 https://www.example.org/eins" ] && break; sleep 1; done
[ "$(loc eins)" = "302 https://www.example.org/eins" ] && ok "Container hat sich neu gestartet und Sicherung eingespielt" || fail "Upload-Restore: $(loc eins)"

echo "9. Trennung öffentlich/intern im Container"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$PUB/api/v1/session")" = 404 ] && ok "API auf öffentlichem Port: 404" || fail "API öffentlich erreichbar"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: localhost:38080' "$A/api/v1/session")" = 421 ] && ok "Verwaltung unter Kurzlink-Host: 421" || fail "421"

echo
echo "Alle $pass Prüfungen bestanden."
