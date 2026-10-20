# 16 — Anmeldung über authentik (OIDC) (IT)

> Dieses Kapitel richtet sich an die IT bzw. an Administratoren des Servers.

Filum unterstützt OpenID Connect (Authorization Code Flow mit PKCE). Getestet wurde der Ablauf mit den Bibliotheksfunktionen; gegen eine echte authentik-Instanz konnte in der Entwicklungsumgebung **nicht** getestet werden (siehe [einschraenkungen.md](23-einschraenkungen.md)).

## In authentik

1. **Applications → Providers → Create → OAuth2/OpenID Provider**
   - Name: `Filum`
   - Client type: **Confidential**
   - Redirect URIs: `https://filum.intranet.firma.de/api/v1/auth/oidc/callback` (= `APP_URL` + `/api/v1/auth/oidc/callback`)
   - Scopes: `openid`, `email`, `profile` und für Rollen über Gruppen zusätzlich ein Scope-Mapping, das `groups` liefert (in authentik standardmäßig im Profil-Scope enthalten)
   - Signing Key: beliebiges Zertifikat
2. **Applications → Create**: Name `Filum`, Slug `filum`, Provider `Filum`.
3. Gruppen anlegen, z. B. `filum-admins`, `filum-redaktion`, und Personen zuordnen.

## In Filum (`.env`)

```ini
OIDC_ISSUER=https://auth.firma.de/application/o/filum/
OIDC_CLIENT_ID=<Client ID aus authentik>
OIDC_CLIENT_SECRET=<Client Secret aus authentik>
OIDC_ADMIN_GROUPS=filum-admins
OIDC_EDITOR_GROUPS=filum-redaktion
OIDC_DEFAULT_ROLE=member
OIDC_BUTTON_LABEL=Mit authentik anmelden
```

Dann `docker compose up -d`. Auf der Anmeldeseite erscheint die Schaltfläche.

## Verhalten

- Beim ersten Login wird ein Konto angelegt. Die Rolle ergibt sich aus den Gruppen (Admin vor Redaktion vor Mitglied), sonst aus `OIDC_DEFAULT_ROLE`. Mit `OIDC_DEFAULT_ROLE=none` werden Personen ohne passende Gruppe abgewiesen.
- Bei jedem Login wird die Rolle aus den Gruppen aktualisiert, sofern eine Gruppe passt.
- Existiert bereits ein lokales Konto mit derselben, vom Anbieter **bestätigten** E-Mail-Adresse, wird es verknüpft.
- In Filum gesperrte Konten können sich auch über OIDC nicht anmelden.
- `DISABLE_LOCAL_LOGIN=true` blendet die Passwortanmeldung aus. Notfallzugang: `filum reset-password` auf der Kommandozeile und Variable vorübergehend auf `false`.
- Filum speichert keine Tokens des Anbieters, nur Issuer und `sub` zur Wiedererkennung.

---

Weiter: [17 — Sicherung und Wiederherstellung](17-sicherung.md) · [Zur Übersicht](README.md)
