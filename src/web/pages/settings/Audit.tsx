import { useInfiniteQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router';
import { Empty } from '../../components/ui';
import { api } from '../../lib/api';
import { date, num, ROLE_LABEL } from '../../lib/format';

interface Entry {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entityId: number | null;
  details: Record<string, unknown> | null;
}

/** Alle Aktionen, die der Server protokolliert (src/server: audit.log-Aufrufe). */
const ACTIONS: Record<string, string> = {
  'link.create': 'Link angelegt',
  'link.update': 'Link geändert',
  'link.delete': 'Link gelöscht',
  'link.duplicate': 'Link dupliziert',
  'link.tessera': 'An Tessera übergeben',
  login: 'Angemeldet',
  'login.oidc': 'Angemeldet (Firmenkonto)',
  'login.failed': 'Fehlgeschlagene Anmeldung',
  'setup.complete': 'Filum eingerichtet',
  'user.create': 'Konto angelegt',
  'user.update': 'Konto geändert',
  'user.delete': 'Konto gelöscht',
  'user.password': 'Eigenes Passwort geändert',
  'user.password_reset': 'Passwort zurückgesetzt',
  'invite.create': 'Einladung erstellt',
  'invite.accepted': 'Einladung angenommen',
  'invite.revoke': 'Einladung zurückgezogen',
  'token.create': 'API-Token erstellt',
  'token.revoke': 'API-Token widerrufen',
  'domain.create': 'Domain angelegt',
  'domain.update': 'Domain geändert',
  'domain.delete': 'Domain entfernt',
  'domain.verify': 'Domain bestätigt',
  'domain.check': 'Domain geprüft',
  'settings.update': 'Einstellungen geändert',
  'backup.create': 'Sicherung erstellt',
  'backup.download': 'Sicherung heruntergeladen',
  'backup.delete': 'Sicherung gelöscht',
  'backup.restore': 'Wiederherstellung vorbereitet',
  'backup.restore_upload': 'Sicherung hochgeladen, Wiederherstellung vorbereitet',
  'stats.clear': 'Statistik eines Links gelöscht',
  'stats.clear_all': 'Gesamte Statistik gelöscht',
  'stats.clear_details': 'Detailstatistik gelöscht',
  'tag.create': 'Schlagwort angelegt',
  'tag.update': 'Schlagwort geändert',
  'tag.delete': 'Schlagwort gelöscht',
  'collection.create': 'Sammlung angelegt',
  'collection.update': 'Sammlung geändert',
  'collection.delete': 'Sammlung gelöscht',
  'campaign.create': 'Kampagne angelegt',
  'campaign.update': 'Kampagne geändert',
  'campaign.delete': 'Kampagne gelöscht',
  import: 'Links importiert',
  export: 'Links exportiert',
  'report.update': 'Meldung bearbeitet',
  'reserved.release': 'Reservierte Adresse freigegeben',
};

/** Filter nach Art – entspricht dem entity-Feld des Servers. */
const KINDS: { value: string; label: string }[] = [
  { value: '', label: 'Alle Arten' },
  { value: 'link', label: 'Links' },
  { value: 'user', label: 'Konten und Anmeldungen' },
  { value: 'invite', label: 'Einladungen' },
  { value: 'token', label: 'API-Tokens' },
  { value: 'domain', label: 'Domains' },
  { value: 'campaign', label: 'Kampagnen' },
  { value: 'collection', label: 'Sammlungen' },
  { value: 'tag', label: 'Schlagwörter' },
  { value: 'settings', label: 'Einstellungen' },
  { value: 'backup', label: 'Sicherungen' },
  { value: 'report', label: 'Meldungen' },
];

/** Feldnamen aus link.update (Datenbankspalten) und aus Formular-Patches. */
const FIELD: Record<string, string> = {
  url: 'Ziel',
  domain_id: 'Domain',
  domainId: 'Domain',
  slug: 'Kurzadresse',
  title: 'Titel',
  notes: 'Notizen',
  redirect_type: 'Weiterleitungsart',
  redirectType: 'Weiterleitungsart',
  enabled: 'Aktiv',
  archived_at: 'Archiv',
  protected: 'Schutz',
  collection_id: 'Sammlung',
  collectionId: 'Sammlung',
  campaign_id: 'Kampagne',
  campaignId: 'Kampagne',
  starts_at: 'Start',
  expires_at: 'Ablauf',
  max_clicks: 'Aufruflimit',
  fallback_url: 'Ersatzziel',
  password: 'Passwort',
  forward_query: 'Parameter weitergeben',
  utm: 'UTM-Parameter',
  rules: 'Regeln',
  owner_id: 'Besitz',
  tags: 'Schlagwörter',
  name: 'Name',
  role: 'Rolle',
  disabled: 'Sperre',
  color: 'Farbe',
  description: 'Beschreibung',
  parentId: 'Übergeordnete Sammlung',
  status: 'Status',
  kind: 'Art',
  // Einstellungen
  analyticsMode: 'Statistik-Modus',
  retentionDays: 'Aufbewahrung',
  detailRetentionDays: 'Aufbewahrung Details',
  trackUnknownSlugs: 'Fehlaufrufe zählen',
  timezone: 'Zeitzone',
  allowedSchemes: 'Erlaubte Zielarten',
  blockedHosts: 'Gesperrte Ziele',
  defaultRedirectType: 'Standard-Weiterleitung',
  slugStyle: 'Automatische Kurzadressen',
  fetchPreviews: 'Vorschau laden',
  healthChecks: 'Zielprüfung',
  reportsEnabled: 'Meldungen',
  memberCanCreateTags: 'Schlagwörter durch Mitglieder',
  organizationName: 'Name der Organisation',
};

const SCOPE: Record<string, string> = { read: 'Lesen', write: 'Lesen und Schreiben', admin: 'Verwaltung' };
const STATUS: Record<string, string> = { open: 'offen', dismissed: 'verworfen', resolved: 'erledigt' };
const METHOD: Record<string, string> = { dns: 'per DNS', http: 'per HTTP', manual: 'manuell' };

const fieldList = (keys: unknown): string =>
  Array.isArray(keys)
    ? keys
        .filter((k) => k !== 'slug_key')
        .map((k) => FIELD[String(k)] ?? String(k))
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(', ')
    : '';

function value(k: string, v: unknown): string {
  if (typeof v === 'boolean') {
    if (k === 'disabled') return v ? 'gesperrt' : 'entsperrt';
    if (k === 'ok') return v ? 'erreichbar' : 'nicht erreichbar';
    return v ? 'an' : 'aus';
  }
  if (k === 'role') return ROLE_LABEL[String(v)] ?? String(v);
  if (k === 'scope') return SCOPE[String(v)] ?? String(v);
  if (k === 'status') return STATUS[String(v)] ?? String(v);
  if (k === 'method') return METHOD[String(v)] ?? String(v);
  if (k === 'kind') return v === 'internal' ? 'intern' : v === 'public' ? 'öffentlich' : String(v);
  if (typeof v === 'number') return num(v);
  if (Array.isArray(v)) return v.map(String).join(', ');
  if (v && typeof v === 'object') return Object.keys(v).length ? Object.keys(v).map((x) => FIELD[x] ?? x).join(', ') : '–';
  return String(v ?? '–');
}

function Pairs({ items }: { items: [string, ReactNode][] }) {
  return (
    <span className="audit-pairs">
      {items.map(([k, v]) => (
        <span key={k}>
          <span className="faint">{k}</span> {v}
        </span>
      ))}
    </span>
  );
}

function detail(e: Entry): ReactNode {
  const d = e.details;
  if (!d) return null;
  switch (e.action) {
    case 'link.update': {
      const fields = fieldList(d.fields);
      return (
        <>
          {fields && <span>{fields}</span>}
          {d.from !== undefined && (
            <span className="audit-change">
              <span className="url">{String(d.from)}</span> → <span className="url">{String(d.to)}</span>
            </span>
          )}
        </>
      );
    }
    case 'link.create':
    case 'link.duplicate':
    case 'link.delete':
      return (
        <span className="audit-change">
          {d.host ? <span className="mono">{`${String(d.host)}/${String(d.slug)}`}</span> : <span className="mono">{String(d.slug ?? '')}</span>}
          {d.url !== undefined && (
            <>
              {' '}
              → <span className="url">{String(d.url)}</span>
            </>
          )}
        </span>
      );
    case 'settings.update':
      return <span>{fieldList(d.keys)}</span>;
    case 'import':
      return `${num(Number(d.created) || 0)} neu, ${num(Number(d.updated) || 0)} aktualisiert, ${num(Number(d.skipped) || 0)} übersprungen, ${num(Number(d.failed) || 0)} mit Fehler`;
    case 'export':
      return `${num(Number(d.count) || 0)} Links als ${String(d.format).toUpperCase()}`;
    case 'login.oidc':
      return Array.isArray(d.groups) && d.groups.length ? <Pairs items={[['Gruppen', (d.groups as unknown[]).map(String).join(', ')]]} /> : null;
    case 'backup.restore':
    case 'backup.restore_upload':
      return (
        <Pairs
          items={[
            ...(d.name ? ([['Datei', String(d.name)]] as [string, ReactNode][]) : []),
            ...(d.links !== undefined ? ([['Links', num(Number(d.links))]] as [string, ReactNode][]) : []),
            ['Wirksam', 'nach Neustart'],
          ]}
        />
      );
    case 'reserved.release':
      return <span className="mono">{String(d.slug)}</span>;
    case 'link.tessera':
      return <Pairs items={[['Tessera-Code', String(d.codeId)]]} />;
  }
  const items = Object.entries(d)
    .filter(([k, v]) => v !== undefined && v !== null && k !== 'schema')
    .map(([k, v]) => [k === 'ok' ? 'Ergebnis' : k === 'email' ? 'E-Mail' : k === 'host' ? 'Host' : k === 'method' ? 'Weg' : k === 'scope' ? 'Berechtigung' : (FIELD[k] ?? k), value(k, v)] as [string, ReactNode]);
  return items.length ? <Pairs items={items} /> : null;
}

export function Audit() {
  const [params, setParams] = useSearchParams();
  const entity = params.get('art') ?? '';
  const log = useInfiniteQuery({
    queryKey: ['audit', entity],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.get<{ items: Entry[] }>(`/api/v1/audit?limit=100${entity ? `&entity=${encodeURIComponent(entity)}` : ''}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (last) => (last.items.length === 100 ? last.items.at(-1)!.id : undefined),
  });
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 12, alignItems: 'flex-end', gap: 12 }}>
        <p className="small muted" style={{ maxWidth: '68ch', flex: '1 1 320px' }}>
          Wer hat wann was geändert. Das Protokoll enthält Aktionen von Konten und Tokens, aber keine Besucher-Daten. Einträge älter als zwei Jahre werden gelöscht.
        </p>
        <select
          className="select"
          style={{ width: 'auto' }}
          aria-label="Nach Art filtern"
          value={entity}
          onChange={(e) => {
            const n = new URLSearchParams(params);
            if (e.target.value) n.set('art', e.target.value);
            else n.delete('art');
            setParams(n, { replace: true });
          }}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div className="panel table-wrap">
        {items.length === 0 && !log.isLoading && <Empty title={entity ? 'Keine Einträge dieser Art' : 'Noch keine Einträge'} art={false} />}
        {items.length > 0 && (
          <table className="table audit-table">
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Wer</th>
                <th>Was</th>
                <th>Einzelheiten</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {date(e.at, true)}
                  </td>
                  <td className="audit-who">{e.actor}</td>
                  <td>
                    {e.entity === 'link' && e.entityId && e.action !== 'link.delete' ? (
                      <RouterLink to={`/links/${e.entityId}`}>{ACTIONS[e.action] ?? e.action}</RouterLink>
                    ) : (
                      (ACTIONS[e.action] ?? e.action)
                    )}
                  </td>
                  <td className="muted audit-detail">{detail(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {log.hasNextPage && (
        <button className="btn" style={{ marginTop: 12 }} onClick={() => void log.fetchNextPage()} disabled={log.isFetchingNextPage}>
          Ältere laden
        </button>
      )}
    </div>
  );
}
