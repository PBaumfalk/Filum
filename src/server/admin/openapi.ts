import type { Ctx } from '../context.js';

/**
 * OpenAPI-3.1-Beschreibung der öffentlichen API. Ein Test (tests/openapi.test.ts)
 * stellt sicher, dass jede registrierte /api/v1-Route hier beschrieben ist.
 */

type Op = {
  summary: string;
  role?: 'viewer' | 'member' | 'editor' | 'admin';
  scope?: 'read' | 'write' | 'admin';
  body?: Record<string, unknown>;
  query?: [string, string, string?][];
  ok?: number;
  description?: string;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const LINK_INPUT = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', description: 'Zieladresse (http/https; fehlendes Schema wird zu https ergänzt)', example: 'https://www.beispiel.de/sehr/langer/pfad?parameter=123' },
    domainId: { type: 'integer', description: 'Domain; Standard: Standarddomain' },
    slug: { type: 'string', description: 'Eigene Kurzadresse; leer = automatisch', example: 'sommer-aktion' },
    title: { type: 'string' },
    notes: { type: 'string' },
    redirectType: { type: 'integer', enum: [301, 302, 307, 308], description: '302 = temporär (Standard), 301 = permanent' },
    tags: { type: 'array', items: { type: 'string' } },
    collectionId: { type: ['integer', 'null'] },
    campaignId: { type: ['integer', 'null'] },
    startsAt: { type: ['string', 'null'], format: 'date-time' },
    expiresAt: { type: ['string', 'null'], format: 'date-time' },
    maxClicks: { type: ['integer', 'null'] },
    fallbackUrl: { type: ['string', 'null'], description: 'Ziel, wenn der Link abgelaufen, deaktiviert oder noch nicht aktiv ist' },
    password: { type: ['string', 'null'], description: 'Passwortschutz (mind. 8 Zeichen); null entfernt ihn' },
    forwardQuery: { type: 'boolean', description: 'Parameter des Aufrufs an das Ziel weitergeben' },
    utm: { type: ['object', 'null'], properties: { utm_source: { type: 'string' }, utm_medium: { type: 'string' }, utm_campaign: { type: 'string' }, utm_term: { type: 'string' }, utm_content: { type: 'string' } } },
    routing: ref('Routing'),
    protected: { type: 'boolean', description: 'Als verteilt/gedruckt schützen' },
    enabled: { type: 'boolean' },
    archived: { type: 'boolean' },
    favorite: { type: 'boolean' },
  },
};

const LIST_QUERY: [string, string, string?][] = [
  ['q', 'Suche in Kurzadresse, Ziel, Titel, Notiz, Schlagwörtern'],
  ['state', 'active | disabled | scheduled | expired | archived | live (Standard) | all'],
  ['domainId', 'Domain'],
  ['tag', 'Schlagwort'],
  ['collectionId', 'Sammlung oder „none“'],
  ['campaignId', 'Kampagne oder „none“'],
  ['owner', '„me“ oder Konto-ID'],
  ['favorite', '1 = nur Favoriten'],
  ['health', 'broken | ok | unchecked'],
  ['sort', 'created | updated | clicks | slug | last_click | expires'],
  ['dir', 'asc | desc'],
  ['limit', '1–500, Standard 50'],
  ['offset', 'Versatz'],
];

const RANGE: [string, string][] = [
  ['range', '24h | 7d | 30d (Standard) | 90d | 365d'],
  ['from', 'Beginn YYYY-MM-DD (mit to)'],
  ['to', 'Ende YYYY-MM-DD'],
];

const PATHS: Record<string, Record<string, Op>> = {
  '/api/v1/session': { get: { summary: 'Aktuelle Anmeldung und Serverfähigkeiten' } },
  '/api/v1/setup': { post: { summary: 'Erstes Admin-Konto mit Einrichtungscode anlegen' } },
  '/api/v1/login': { post: { summary: 'Mit E-Mail und Passwort anmelden (setzt Sitzungs-Cookie)' } },
  '/api/v1/logout': { post: { summary: 'Abmelden' } },
  '/api/v1/me': { patch: { summary: 'Eigenen Namen ändern', role: 'viewer' } },
  '/api/v1/me/password': { post: { summary: 'Eigenes Passwort ändern', role: 'viewer' } },
  '/api/v1/me/logout-everywhere': { post: { summary: 'Alle anderen Sitzungen beenden', role: 'viewer' } },
  '/api/v1/invites/{token}': { get: { summary: 'Einladung prüfen' } },
  '/api/v1/invites/{token}/accept': { post: { summary: 'Einladung annehmen und Konto anlegen' } },
  '/api/v1/auth/oidc/start': { get: { summary: 'Anmeldung über OIDC starten (nur wenn eingerichtet)' } },
  '/api/v1/auth/oidc/callback': { get: { summary: 'OIDC-Rückkehr' } },
  '/api/v1/openapi.json': { get: { summary: 'Diese Beschreibung' } },

  '/api/v1/links': {
    get: { summary: 'Links auflisten und durchsuchen', role: 'viewer', query: LIST_QUERY },
    post: { summary: 'Kurzlink anlegen', role: 'member', scope: 'write', body: LINK_INPUT, ok: 201 },
  },
  '/api/v1/links/counts': { get: { summary: 'Zähler je Status (für Seitenleisten)', role: 'viewer' } },
  '/api/v1/links/batch': {
    post: {
      summary: 'Mehrere Kurzlinks auf einmal anlegen',
      role: 'member',
      scope: 'write',
      ok: 201,
      body: { type: 'object', required: ['urls'], properties: { urls: { type: 'array', items: { type: 'string' }, maxItems: 500 }, defaults: { type: 'object' } } },
    },
  },
  '/api/v1/links/bulk': {
    post: {
      summary: 'Massenaktion auf mehrere Links',
      role: 'member',
      scope: 'write',
      description: 'action.type: enable, disable, archive, unarchive, delete, protect, unprotect, favorite, unfavorite, addTags, removeTags, setCollection, setCampaign, setDomain, setExpiry',
      body: { type: 'object', required: ['ids', 'action'], properties: { ids: { type: 'array', items: { type: 'integer' } }, action: { type: 'object' }, confirmProtected: { type: 'boolean' } } },
    },
  },
  '/api/v1/links/{id}': {
    get: { summary: 'Einen Link lesen', role: 'viewer' },
    patch: { summary: 'Link ändern (nur übergebene Felder)', role: 'member', scope: 'write', body: { ...LINK_INPUT, required: [] } },
    delete: { summary: 'Link löschen (Kurzadresse bleibt reserviert)', role: 'member', scope: 'write', query: [['confirm', '„protected“ zum Löschen geschützter Links']] },
  },
  '/api/v1/links/{id}/duplicate': { post: { summary: 'Link duplizieren (neue Kurzadresse)', role: 'member', scope: 'write', ok: 201 } },
  '/api/v1/links/{id}/favorite': { post: { summary: 'Als Favorit markieren', role: 'viewer', scope: 'write', body: { type: 'object', properties: { favorite: { type: 'boolean' } } } } },
  '/api/v1/links/{id}/refresh': { post: { summary: 'Vorschau und Zielprüfung sofort neu laden', role: 'member', scope: 'write' } },
  '/api/v1/links/{id}/versions': { get: { summary: 'Versionen (Zielverlauf)', role: 'viewer' } },
  '/api/v1/links/{id}/versions/{versionId}/restore': { post: { summary: 'Version wiederherstellen', role: 'member', scope: 'write' } },
  '/api/v1/links/{id}/history': { get: { summary: 'Protokoll eines Links', role: 'viewer' } },
  '/api/v1/links/{id}/stats': {
    get: { summary: 'Statistik eines Links', role: 'viewer', query: RANGE },
    delete: { summary: 'Statistik eines Links löschen', role: 'member', scope: 'write' },
  },
  '/api/v1/links/{id}/qr': {
    get: {
      summary: 'QR-Code des Kurzlinks',
      role: 'viewer',
      query: [
        ['format', 'svg (Standard) | png'],
        ['size', 'PNG-Kantenlänge 64–4096'],
        ['margin', 'Ruhezone in Modulen 0–16'],
        ['ec', 'Fehlerkorrektur L | M | Q | H'],
        ['dark', 'Farbe hex ohne #'],
        ['light', 'Hintergrund hex oder transparent'],
        ['track', '1 = QR-Aufrufe getrennt zählen (?qr), 0 = reiner Link'],
        ['download', '1 = als Datei herunterladen'],
      ],
    },
  },
  '/api/v1/links/{id}/tessera': { post: { summary: 'Code in Tessera anlegen (wenn verbunden)', role: 'member', scope: 'write' } },
  '/api/v1/slug/check': { get: { summary: 'Kurzadresse prüfen', role: 'viewer', query: [['domainId', ''], ['slug', ''], ['exceptId', 'Link, der ignoriert wird']] } },
  '/api/v1/slug/suggest': { get: { summary: 'Kurzadresse vorschlagen', role: 'viewer', query: [['domainId', ''], ['url', ''], ['style', 'random | readable'], ['title', '']] } },
  '/api/v1/lookup': { get: { summary: 'Vorhandene Links zu einer Zieladresse finden', role: 'viewer', query: [['url', 'Zieladresse']] } },
  '/api/v1/preview': { post: { summary: 'Titel und Erreichbarkeit einer Adresse abrufen (SSRF-geschützt)', role: 'member', scope: 'write' } },
  '/api/v1/images/{id}': { get: { summary: 'Vorschaubild', role: 'viewer' } },

  '/api/v1/tags': { get: { summary: 'Schlagwörter', role: 'viewer' }, post: { summary: 'Schlagwort anlegen', role: 'member', scope: 'write', ok: 201 } },
  '/api/v1/tags/{id}': { patch: { summary: 'Schlagwort ändern', role: 'editor', scope: 'write' }, delete: { summary: 'Schlagwort löschen', role: 'editor', scope: 'write' } },
  '/api/v1/collections': { get: { summary: 'Sammlungen', role: 'viewer' }, post: { summary: 'Sammlung anlegen', role: 'editor', scope: 'write', ok: 201 } },
  '/api/v1/collections/{id}': { patch: { summary: 'Sammlung ändern', role: 'editor', scope: 'write' }, delete: { summary: 'Sammlung löschen', role: 'editor', scope: 'write' } },
  '/api/v1/campaigns': { get: { summary: 'Kampagnen', role: 'viewer' }, post: { summary: 'Kampagne anlegen', role: 'editor', scope: 'write', ok: 201 } },
  '/api/v1/campaigns/{id}': { patch: { summary: 'Kampagne ändern', role: 'editor', scope: 'write' }, delete: { summary: 'Kampagne löschen', role: 'editor', scope: 'write' } },
  '/api/v1/presets': { get: { summary: 'Vorlagen', role: 'viewer' }, post: { summary: 'Vorlage anlegen', role: 'member', scope: 'write', ok: 201 } },
  '/api/v1/presets/{id}': { delete: { summary: 'Vorlage löschen', role: 'member', scope: 'write' } },

  '/api/v1/stats': {
    get: { summary: 'Gesamtstatistik', role: 'viewer', query: [...RANGE, ['campaignId', ''], ['collectionId', ''], ['domainId', ''], ['tag', '']] },
    delete: { summary: 'Statistik löschen: scope=all (alles) oder scope=details (nur Detailauswertungen), Pflichtangabe', role: 'admin', scope: 'admin' },
  },
  '/api/v1/stats/outcomes': { get: { summary: 'Ergebnisse aller Aufrufe und unbekannte Kurzadressen', role: 'viewer', query: [...RANGE, ['domainId', '']] } },
  '/api/v1/stats/campaigns': { get: { summary: 'Kampagnenvergleich', role: 'viewer', query: RANGE } },

  '/api/v1/domains': { get: { summary: 'Domains', role: 'viewer' }, post: { summary: 'Domain anlegen', role: 'admin', scope: 'admin', ok: 201 } },
  '/api/v1/domains/{id}': { patch: { summary: 'Domain ändern', role: 'admin', scope: 'admin' }, delete: { summary: 'Domain löschen (nur ohne Links)', role: 'admin', scope: 'admin' } },
  '/api/v1/domains/{id}/verify': { post: { summary: 'Besitz/Berechtigung nachweisen (dns, http, admin)', role: 'admin', scope: 'admin' } },
  '/api/v1/domains/{id}/check': { post: { summary: 'Diagnose: DNS, HTTPS, Proxy', role: 'admin', scope: 'admin' } },
  '/api/v1/domains/{id}/proxy-config': { get: { summary: 'Konfigurationsbausteine für Caddy, nginx, Traefik', role: 'admin' } },

  '/api/v1/export': { get: { summary: 'Export als CSV oder JSON', role: 'viewer', query: [['format', 'csv | json'], ['ids', 'Kommagetrennte IDs'], ...LIST_QUERY.slice(0, 9)] } },
  '/api/v1/import/preview': { post: { summary: 'CSV prüfen (text/csv oder {csv}), speichert nichts', role: 'member', scope: 'write' } },
  '/api/v1/import': { post: { summary: 'Geprüfte Zeilen übernehmen', role: 'member', scope: 'write' } },

  '/api/v1/settings': { get: { summary: 'Einstellungen', role: 'viewer' }, patch: { summary: 'Einstellungen ändern', role: 'admin', scope: 'admin' } },
  '/api/v1/settings/privacy-notice': { get: { summary: 'Textbaustein für die Datenschutzerklärung', role: 'viewer' } },
  '/api/v1/users': { get: { summary: 'Konten', role: 'editor' }, post: { summary: 'Konto anlegen', role: 'admin', scope: 'admin', ok: 201 } },
  '/api/v1/users/{id}': { patch: { summary: 'Konto ändern', role: 'admin', scope: 'admin' }, delete: { summary: 'Konto löschen', role: 'admin', scope: 'admin' } },
  '/api/v1/users/{id}/password': { post: { summary: 'Passwort zurücksetzen', role: 'admin', scope: 'admin' } },
  '/api/v1/invites': { post: { summary: 'Einladungslink erzeugen', role: 'admin', scope: 'admin', ok: 201 } },
  '/api/v1/invites/{id}': { delete: { summary: 'Einladung zurückziehen', role: 'admin', scope: 'admin' } },
  '/api/v1/tokens': { get: { summary: 'Eigene API-Tokens (all=1 für Admins)', role: 'viewer' }, post: { summary: 'Token erstellen (nur in der Oberfläche)', role: 'viewer', ok: 201 } },
  '/api/v1/tokens/{id}': { delete: { summary: 'Token widerrufen', role: 'viewer' } },
  '/api/v1/backups': { get: { summary: 'Sicherungen', role: 'admin', scope: 'admin' }, post: { summary: 'Sicherung erstellen', role: 'admin', scope: 'admin', ok: 201 } },
  '/api/v1/backups/{name}': { delete: { summary: 'Sicherung löschen', role: 'admin', scope: 'admin' } },
  '/api/v1/backups/{name}/download': { get: { summary: 'Sicherung herunterladen', role: 'admin', scope: 'admin' } },
  '/api/v1/backups/{name}/restore': { post: { summary: 'Sicherung wiederherstellen (Neustart)', role: 'admin', scope: 'admin' } },
  '/api/v1/backups/upload': { post: { summary: 'Sicherungsdatei prüfen oder mit restore=1 wiederherstellen', role: 'admin', scope: 'admin' } },
  '/api/v1/audit': { get: { summary: 'Protokoll', role: 'admin', scope: 'admin' } },
  '/api/v1/reports': { get: { summary: 'Missbrauchsmeldungen', role: 'editor' } },
  '/api/v1/reports/{id}': { patch: { summary: 'Meldung bearbeiten', role: 'editor', scope: 'write' } },
  '/api/v1/reserved': { get: { summary: 'Reservierte (gelöschte) Kurzadressen', role: 'admin' } },
  '/api/v1/reserved/{domainId}/{slug}': { delete: { summary: 'Reservierung freigeben', role: 'admin', scope: 'admin' } },
  '/api/v1/system': { get: { summary: 'Systemzustand und Warnungen', role: 'admin' } },
};

export const DOCUMENTED_ROUTES = Object.entries(PATHS).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`));

export function openapi(ctx: Pick<Ctx, 'config'>) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [p, ops] of Object.entries(PATHS)) {
    paths[p] = {};
    for (const [method, op] of Object.entries(ops)) {
      const params = [
        ...[...p.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: m[1] === 'id' || m[1].endsWith('Id') ? 'integer' : 'string' } })),
        ...(op.query ?? []).map(([name, description]) => ({ name, in: 'query', required: false, description, schema: { type: 'string' } })),
      ];
      const auth = op.role
        ? `Rolle mindestens „${op.role}“${op.scope ? `, Token-Stufe „${op.scope}“` : ''}.`
        : 'Ohne Anmeldung erreichbar.';
      paths[p][method] = {
        summary: op.summary,
        description: [op.description, auth].filter(Boolean).join('\n\n'),
        ...(op.role ? { security: [{ bearer: [] }, { cookie: [] }] } : { security: [] }),
        ...(params.length ? { parameters: params } : {}),
        ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: op.body } } } } : {}),
        responses: {
          [String(op.ok ?? 200)]: { description: 'Erfolg' },
          '400': { description: 'Ungültige Eingabe', content: { 'application/json': { schema: ref('Error') } } },
          ...(op.role ? { '401': { description: 'Nicht angemeldet' }, '403': { description: 'Keine Berechtigung' } } : {}),
          '429': { description: 'Zu viele Anfragen' },
        },
      };
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Filum API',
      version: ctx.config.version,
      description:
        'REST-API des Link-Management-Studios Filum. Authentifizierung mit „Authorization: Bearer flm_…“ (Token unter Einstellungen → API-Tokens). ' +
        'Antworten sind JSON; Fehler haben die Form { "error": { "code", "message", "field" } }. Zeitangaben sind ISO 8601. ' +
        'Grenze: 600 Anfragen pro Minute und Token.',
    },
    servers: [{ url: ctx.config.appUrl }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'API-Token flm_…' },
        cookie: { type: 'apiKey', in: 'cookie', name: 'filum_session', description: 'Nur Oberfläche; schreibende Anfragen brauchen zusätzlich X-Filum: 1' },
      },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, field: { type: 'string' } } } } },
        Routing: {
          type: ['object', 'null'],
          description: 'Regeln (erste passende gewinnt) und gewichtete Varianten',
          properties: {
            rules: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  url: { type: 'string' },
                  when: {
                    type: 'object',
                    properties: {
                      platform: { type: 'array', items: { enum: ['ios', 'android', 'desktop', 'other'] } },
                      language: { type: 'array', items: { type: 'string', example: 'de' } },
                      weekdays: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 7 } },
                      timeFrom: { type: 'string', example: '08:00' },
                      timeTo: { type: 'string', example: '18:00' },
                      dateFrom: { type: 'string', format: 'date-time' },
                      dateTo: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
            mainWeight: { type: 'integer' },
            variants: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, url: { type: 'string' }, weight: { type: 'integer' } } } },
          },
        },
      },
    },
    paths,
  };
}
