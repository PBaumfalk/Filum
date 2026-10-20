# Reverse Proxy, HTTPS und Trennung von Verwaltung und Weiterleitung

## Das Prinzip: zwei Ports, zwei Welten

Filum startet zwei voneinander unabhängige HTTP-Dienste im selben Container:

| Port | Name | Beantwortet | Beantwortet nie |
| --- | --- | --- | --- |
| **8080** | öffentlich | Kurzlinks, Vorschau (`/abc+`), Passwortseiten, Meldeformular, `/healthz`, `/.well-known/filum-verify` | Oberfläche, API, Anmeldung, Dateien der Oberfläche |
| **8081** | intern | Oberfläche, REST-API, Anmeldung (auch OIDC), `/healthz` | Kurzlinks |

Der öffentliche Dienst enthält schlicht keinen Code für die Verwaltung. Selbst wenn der Proxy falsch eingerichtet ist und `/api/…` auf Port 8080 weiterleitet, gibt es dort nur die Seite „Link nicht gefunden“.

Zusätzlich lehnt der Verwaltungsdienst Anfragen ab (HTTP 421), deren Hostname eine eingetragene Kurzlink-Domain ist. Zeigt also jemand versehentlich `go.firma.de` auf Port 8081, erscheint die Verwaltung dort trotzdem nicht. Mit `STRICT_ADMIN_HOST=true` antwortet Port 8081 ausschließlich unter dem Hostnamen aus `APP_URL`.

**Regel für den Proxy:** Kurzlink-Domains → Port 8080. Verwaltungs-Hostname → Port 8081, und den nur im Intranet erreichbar machen.

## Caddy (empfohlen, automatische Zertifikate)

```caddy
# Verwaltung – nur aus dem Intranet
filum.intranet.firma.de {
	@intern remote_ip 10.0.0.0/8 192.168.0.0/16 172.16.0.0/12
	handle @intern {
		reverse_proxy 127.0.0.1:8081
	}
	respond 403
}

# Kurzlinks – hier öffentlich
go.firma.de {
	reverse_proxy 127.0.0.1:8080
}

# Interne Kurzlink-Domain
go.intranet.firma.de {
	tls internal
	reverse_proxy 127.0.0.1:8080
}
```

Caddy setzt `X-Forwarded-For` selbst korrekt und übernimmt Werte des Clients nur von Proxys, denen es per `trusted_proxies` vertraut.

### Caddy als Container im gemeinsamen Netz

Läuft Caddy selbst in Docker, braucht Filum keine Host-Ports. Beide hängen an einem gemeinsamen Netz, Caddy erreicht Filum über den Dienstnamen:

```bash
docker network create proxy   # einmalig
```

`docker-compose.override.yml` neben der `docker-compose.yml` von Filum (Compose liest sie automatisch):

```yaml
services:
  filum:
    ports: !reset []
    networks: [proxy]
networks:
  proxy:
    external: true
```

Im Caddyfile (Caddy-Container ebenfalls im Netz `proxy`):

```caddy
filum.intranet.firma.de {
	@intern remote_ip 10.0.0.0/8 192.168.0.0/16 172.16.0.0/12
	handle @intern {
		reverse_proxy filum:8081
	}
	respond 403
}

go.firma.de {
	reverse_proxy filum:8080
}
```

Prüfen Sie mit `docker compose port filum 8080`, dass wirklich kein Host-Port mehr offen ist (keine Ausgabe). Für `TRUST_PROXY` tragen Sie dann das Subnetz des Netzes `proxy` ein (siehe unten).

## nginx

```nginx
# Verwaltung
server {
    listen 443 ssl;
    http2 on;
    server_name filum.intranet.firma.de;
    ssl_certificate     /etc/ssl/filum/fullchain.pem;
    ssl_certificate_key /etc/ssl/filum/privkey.pem;

    allow 10.0.0.0/8;
    allow 172.16.0.0/12;
    allow 192.168.0.0/16;
    deny all;

    client_max_body_size 512m;   # Sicherungen hochladen; Filum nimmt bis 512 MB an

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Kurzlinks
server {
    listen 443 ssl;
    http2 on;
    server_name go.firma.de;
    ssl_certificate     /etc/ssl/go/fullchain.pem;
    ssl_certificate_key /etc/ssl/go/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name go.firma.de filum.intranet.firma.de;
    return 301 https://$host$request_uri;
}
```

Wichtig:

- `proxy_set_header Host $host;` muss gesetzt sein. Filum erkennt die Domain am Hostnamen.
- `X-Forwarded-For $remote_addr` **überschreibt** den Kopf, den ein Besucher selbst mitschickt. Die verbreitete Variante `$proxy_add_x_forwarded_for` hängt die echte Adresse nur an einen vom Besucher gelieferten Wert an. Dann könnte jeder mit einer erfundenen Adresse die Drosselung von Anmelde- und Passwortversuchen umgehen. Steht vor nginx ein weiterer Proxy (z. B. ein Load Balancer), nutzen Sie stattdessen das `realip`-Modul (`set_real_ip_from`, `real_ip_header`) und dann `$remote_addr`.

## Traefik (Docker-Labels)

Läuft Traefik als Container, entfernen Sie in `docker-compose.yml` den Abschnitt `ports:` und hängen Filum an das Netz von Traefik:

```yaml
services:
  filum:
    # … wie in docker-compose.yml, aber ohne ports:
    networks: [proxy]
    labels:
      - traefik.enable=true
      # Verwaltung
      - traefik.http.routers.filum-admin.rule=Host(`filum.intranet.firma.de`)
      - traefik.http.routers.filum-admin.entrypoints=websecure
      - traefik.http.routers.filum-admin.tls=true
      - traefik.http.routers.filum-admin.service=filum-admin
      - traefik.http.routers.filum-admin.middlewares=nur-intranet@file
      - traefik.http.services.filum-admin.loadbalancer.server.port=8081
      # Kurzlinks
      - traefik.http.routers.filum-public.rule=Host(`go.firma.de`) || Host(`go.intranet.firma.de`)
      - traefik.http.routers.filum-public.entrypoints=websecure
      - traefik.http.routers.filum-public.tls.certresolver=letsencrypt
      - traefik.http.routers.filum-public.service=filum-public
      - traefik.http.services.filum-public.loadbalancer.server.port=8080
networks:
  proxy:
    external: true
```

Die Middleware `nur-intranet` definieren Sie in der dynamischen Konfiguration von Traefik (Datei-Provider), z. B. `dynamic/filum.yml`:

```yaml
http:
  middlewares:
    nur-intranet:
      ipAllowList:
        sourceRange:
          - 10.0.0.0/8
          - 172.16.0.0/12
          - 192.168.0.0/16
```

Ohne diese Datei startet der Router `filum-admin` nicht (Traefik meldet die fehlende Middleware im Log). Alternativ lässt sie sich direkt als Label anlegen: `traefik.http.middlewares.nur-intranet.ipallowlist.sourcerange=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` und im Router `…middlewares=nur-intranet` (ohne `@file`). Bis Traefik 2.x heißt die Middleware `ipWhiteList`.

Hängt Filum an mehreren Netzen, sagen Sie Traefik, über welches es Filum erreicht, sonst wählt es zufällig und Anfragen laufen ins Leere:

```yaml
      - traefik.docker.network=proxy
```

Traefik überschreibt `X-Forwarded-For` von Clients, solange `forwardedHeaders.trustedIPs` am Entrypoint nicht gesetzt ist.

## Echte Absender-Adresse (TRUST_PROXY)

Filum braucht die Adresse des Besuchers nur kurzzeitig im Arbeitsspeicher: für die Drosselung von Anmeldeversuchen, Passwortseiten und das Durchprobieren unbekannter Kurzadressen. Gespeichert wird sie nie.

Standardmäßig vertraut Filum `X-Forwarded-For`, wenn die Anfrage aus einem privaten Netz kommt (`loopback,linklocal,uniquelocal`), also vom Proxy auf demselben Server oder im Docker-Netz. Steht der Proxy woanders, tragen Sie dessen Adresse ein:

```ini
TRUST_PROXY=10.20.0.5
```

Ohne korrekte Einstellung würden alle Besucher als „der Proxy“ gezählt und die Drosselung träfe alle gemeinsam.

**Empfehlung für den Produktivbetrieb:** Tragen Sie genau ein, woher die Anfragen des Proxys im Container ankommen:

| Aufbau | `TRUST_PROXY` | So finden Sie den Wert |
| --- | --- | --- |
| Proxy auf demselben Server, Ports an `127.0.0.1` | Gateway des Compose-Netzes, z. B. `172.18.0.1` | `docker network inspect filum_default -f '{{(index .IPAM.Config 0).Gateway}}'` |
| Proxy als Container im Netz `proxy` | Subnetz des Netzes, z. B. `172.20.0.0/16` | `docker network inspect proxy -f '{{(index .IPAM.Config 0).Subnet}}'` |
| Proxy auf einem anderen Server | dessen Adresse, z. B. `10.20.0.5` | – |
| **kein** Proxy, `PUBLIC_BIND=0.0.0.0` | `false` | – |

Der Standard vertraut allen privaten Netzen. Wer Port 8080 direkt aus dem LAN erreicht, könnte dann eine gefälschte Absenderadresse mitschicken. Filum begrenzt Passwortversuche und Fehlaufrufe zusätzlich unabhängig von der Absenderadresse (je Link bzw. je Domain), die genaue Einstellung ist trotzdem besser. Die Standard-Bindung der Ports an `127.0.0.1` in `docker-compose.yml` verhindert den direkten Zugriff aus dem LAN.

Bieten Sie Port 8080 ohne Proxy direkt an (`PUBLIC_BIND=0.0.0.0`), **muss** `TRUST_PROXY=false` gesetzt sein. Sonst kann jeder Besucher aus einem privaten Netz per `X-Forwarded-For` eine beliebige Adresse vorgeben.

## HTTPS

- Filum selbst spricht nur HTTP; TLS übernimmt der Proxy.
- `APP_URL` mit `https://` schaltet sichere Cookies (`Secure`) und HSTS für die Verwaltung ein.
- Ob eine Kurzlink-Domain `https://` oder `http://` in den erzeugten Links verwendet, stellen Sie je Domain unter **Domains → Einstellungen** ein.
- Interne Domains ohne öffentliches Zertifikat: z. B. Caddy `tls internal` oder eine interne CA. Der Browser muss der CA vertrauen.

### Interne Zertifizierungsstelle auch für Filum

Filum ruft selbst HTTPS-Adressen ab: den OIDC-Anbieter (authentik), Tessera, die eigenen Domains bei **Domains → Prüfen** und Ziele für Vorschau und Zielprüfung. Tragen diese Server Zertifikate einer internen CA, muss auch Filum ihr vertrauen, sonst scheitern Anmeldung und Prüfungen mit Zertifikatsfehlern. Legen Sie das CA-Zertifikat (PEM) neben die `docker-compose.yml` und ergänzen Sie in `docker-compose.override.yml`:

```yaml
services:
  filum:
    environment:
      NODE_EXTRA_CA_CERTS: /etc/filum/interne-ca.pem
    volumes:
      - ./interne-ca.pem:/etc/filum/interne-ca.pem:ro
```

Danach `docker compose up -d`. Die Datei kann mehrere Zertifikate hintereinander enthalten (Root- und Zwischen-CA). Öffentliche Zertifikate bleiben weiterhin gültig.

## Prüfen

Unter **Domains → Prüfen** kontrolliert Filum für jede Domain:

1. ob der Name auflöst (und ob auf interne oder öffentliche Adressen),
2. ob `https://<domain>/.well-known/filum-verify` bei genau dieser Filum-Installation ankommt (und mit gültigem Zertifikat),
3. ob HTTP auf HTTPS umgeleitet wird,
4. ob die Domain bestätigt ist.

Filum kann von innen nicht prüfen, ob eine Domain **aus dem Internet** erreichbar ist. Das testen Sie z. B. mit dem Mobilfunk-Netz Ihres Smartphones.

Von außen lässt sich die Trennung so kontrollieren:

```bash
curl -I https://go.firma.de/api/v1/session      # erwartet: 404, keine JSON-Antwort
curl -I https://go.firma.de/einstellungen        # erwartet: 404
curl -I https://filum.intranet.firma.de/healthz  # aus dem Internet: nicht erreichbar
```
