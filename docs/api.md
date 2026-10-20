# API

Die vollständige, maschinenlesbare Beschreibung liefert Filum selbst: `GET /api/v1/openapi.json` (OpenAPI 3.1). In der Oberfläche steht sie unter **API** mit Beispielen. Ein Test stellt sicher, dass jede Route der API dort beschrieben ist.

## Zugang

1. Einstellungen → API & Lesezeichen → **Neues Token**.
2. Stufe wählen: *Nur lesen*, *Lesen und schreiben* oder *Admin* (Domains, Konten, Einstellungen, Sicherungen). Ein Token hat nie mehr Rechte als das Konto.
3. Das Token wird genau einmal angezeigt.

```
Authorization: Bearer flm_…
```

## Beispiele

```bash
T=flm_…
A=https://filum.intranet.firma.de

# Kurzlink anlegen
curl -s -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"url":"https://www.beispiel.de/sehr/langer/pfad?parameter=123","slug":"herbst","tags":["Newsletter"]}' \
  $A/api/v1/links

# Mehrere auf einmal
curl -s -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"urls":["https://a.example","https://b.example"],"defaults":{"tags":["Import"]}}' \
  $A/api/v1/links/batch

# Suchen
curl -s -H "Authorization: Bearer $T" "$A/api/v1/links?q=herbst&state=active&limit=20"

# Ziel ändern
curl -s -X PATCH -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"url":"https://www.beispiel.de/neu"}' $A/api/v1/links/42

# Deaktivieren / Ablaufdatum setzen
curl -s -X PATCH -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"enabled":false}' $A/api/v1/links/42
curl -s -X PATCH -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"expiresAt":"2026-12-31T23:59:00+01:00"}' $A/api/v1/links/42

# Statistik der letzten 30 Tage
curl -s -H "Authorization: Bearer $T" "$A/api/v1/links/42/stats?range=30d"

# QR-Code als PNG
curl -s -H "Authorization: Bearer $T" -o code.png "$A/api/v1/links/42/qr?format=png&size=1024"

# Export
curl -s -H "Authorization: Bearer $T" -o links.csv "$A/api/v1/export?format=csv&state=all"

# Löschen (Kurzadresse bleibt reserviert)
curl -s -X DELETE -H "Authorization: Bearer $T" $A/api/v1/links/42
```

## Antworten und Fehler

- JSON, Zeitangaben ISO 8601.
- Listen: `{ "total", "items", "limit", "offset" }`.
- Fehler: `{ "error": { "code": "invalid", "message": "Das ist keine gültige Webadresse. …", "field": "url" } }` mit passenden Statuscodes (400, 401, 403, 404, 409, 429).
- Rate-Limit: 600 Anfragen pro Minute je Token.

## Weiterleitung und API sind getrennt

Kurzlinks laufen über die Kurzlink-Domains (Port 8080), die API nur über die Verwaltungsadresse (Port 8081). Dieselben Prüfungen (Zieladresse, Sperrliste, Rollen) gelten für Oberfläche, API und Import, weil alle denselben Dienst im Server verwenden.
