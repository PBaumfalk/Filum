# 20 — Sicherheitskonzept (IT)

> Dieses Kapitel richtet sich an die IT bzw. an Administratoren des Servers.

## Angriffsflächen und Schutz

| Bedrohung | Schutz in Filum |
| --- | --- |
| Verwaltung über eine Kurzlink-Domain erreichbar | Zwei getrennte Dienste (Port 8080 kennt keine Verwaltungsrouten). Port 8081 antwortet mit 421 auf Kurzlink-Hostnamen; optional `STRICT_ADMIN_HOST`. |
| Unbefugte Linkerstellung | Nur angemeldete Konten, Rollen (Ansehen, Mitglied, Redaktion, Admin), Token-Stufen (lesen, schreiben, Admin). Keine anonyme Anlage. |
| Standardzugangsdaten | Gibt es nicht. Das erste Konto braucht den einmaligen Einrichtungscode aus dem Log. |
| Brute Force auf Anmeldung | Drosselung je Konto und je Absender mit exponentiell wachsender Sperre (ab dem 5. Fehlversuch, bis 15 Minuten); Rate-Limits je Route; gleiche Antwortzeit für unbekannte Konten. |
| Passwortgeschützte Links raten | Drosselung je Absender und Link. |
| Durchprobieren von Kurzadressen | Höchstens 240 Fehlaufrufe je Minute und Absender, danach 429. Zufällige Adressen ohne verwechselbare Zeichen, 6 Zeichen ≈ 887 Mio. Möglichkeiten. |
| Passwörter | scrypt (N=32768, r=8, p=1), mindestens 10 Zeichen, triviale Muster abgelehnt. |
| Sitzungen | Zufällige 256-Bit-Token, in der Datenbank nur als SHA-256. Cookie `HttpOnly`, `SameSite=Lax`, `Secure` bei HTTPS. 14 Tage gleitend. Passwortänderung beendet andere Sitzungen. |
| API-Tokens | `flm_` + 240 Bit Zufall, nur als SHA-256 gespeichert, einmalig angezeigt, widerrufbar, Ablaufdatum, nie mehr Rechte als das Konto, Erstellung nur in der Oberfläche. |
| CSRF | Schreibende Anfragen mit Cookie brauchen den Header `X-Filum: 1` und eine passende `Origin`. Bearer-Token sind ausgenommen. |
| XSS | React maskiert alle Ausgaben; strikte CSP (`script-src 'self'`, keine Inline-Skripte, kein `eval`); öffentliche Seiten serverseitig maskiert und mit Hash-basierter CSP ohne Skripte. Titel und Beschreibungen fremder Seiten gelten als reiner Text. |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY`. |
| SQL-Injection | Ausschließlich vorbereitete Anweisungen mit Parametern; Volltextsuche mit maskierten Begriffen. |
| SSRF bei Vorschau und Zielprüfung | Nur http/https und Ports 80/443/8080/8443; eigener DNS-Abruf, **alle** Adressen müssen erlaubt sein; Verbindung genau zur geprüften IP (kein zweites DNS → kein DNS-Rebinding); jede Weiterleitung einzeln erneut geprüft, höchstens 5; Zeit- und Größenlimit. Gesperrt: Loopback, Link-Local (inkl. Cloud-Metadaten 169.254.169.254), private Netze, CGNAT, Multicast, reservierte und Dokumentationsnetze, IPv4-mapped und NAT64-Formen, 6to4, Teredo. Ausnahmen nur über `FETCH_ALLOW_HOSTS`. |
| Bösartige Bilder | Vorschaubilder: max. 1 MB, Typ anhand der ersten Bytes (PNG, JPEG, WebP, GIF, ICO), kein SVG; Auslieferung nur an Angemeldete, mit `Content-Security-Policy: sandbox` und `nosniff`. |
| Gefährliche Ziele | Nur erlaubte Schemata (Standard http/https; `javascript:`, `data:`, `file:` nie); keine Zugangsdaten in URLs; keine Steuer- oder Bidi-Zeichen; keine Schleifen auf eigene Domains; Sperrliste mit Subdomains. Gilt für Oberfläche, API und Import gleichermaßen. |
| Offene Weiterleitung auf fremden Domains | Öffentliche Domains erst nach Besitznachweis aktiv. Missbrauchsmeldungen über `/<slug>+melden`. |
| Wiederverwendung gedruckter Adressen | Gelöschte Kurzadressen bleiben reserviert (410 statt neues Ziel). Freigabe nur durch Admins. |
| CSV-Formel-Injektion | Exportierte Zellen, die mit `= + - @` beginnen, werden mit `'` entschärft. |
| Manipulierte Sicherungen | Hochgeladene Sicherungen werden auf SQLite-Format, Integrität und Schema geprüft; nur Admins. |
| Container | Läuft als Benutzer `node`, Root-Dateisystem schreibgeschützt, alle Linux-Capabilities entzogen, `no-new-privileges`, Speichergrenze. |
| Nachvollziehbarkeit | Protokoll aller Verwaltungsaktionen (wer, wann, was, bei Zieländerungen alt → neu); Versionsverlauf je Link. |

## Sicherheitsheader

Verwaltung: `Content-Security-Policy` (siehe oben), `Strict-Transport-Security` bei HTTPS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy: same-origin`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`, `Cache-Control: no-store` für die API.

Öffentlich: Weiterleitungen mit passendem `Cache-Control`; HTML-Seiten mit `default-src 'none'`-CSP, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`.

## Grenzen

- Filum prüft Ziele nicht gegen externe Reputationsdienste (bewusst: keine Cloud-Abhängigkeit). Die Sperrliste ist manuell.
- Ein Admin-Konto kann alles; schützen Sie es gut, idealerweise über OIDC mit zweitem Faktor im Identity Provider.
- Für den Schutz vor volumetrischen Angriffen (DDoS) ist der Reverse Proxy zuständig.

---

Weiter: [21 — Architektur](21-architektur.md) · [Zur Übersicht](README.md)
