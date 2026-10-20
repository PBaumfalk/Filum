import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api';
import { bytes, date, num } from '../../lib/format';
import { SectionTitle } from './common';

interface SystemInfo {
  version: string;
  schema: number;
  node: string;
  platform: string;
  uptimeSeconds: number;
  dbBytes: number;
  dataDir: string;
  links: number;
  users: number;
  cacheEntries: number;
  lastBackup: { name: string; createdAt: string } | null;
  appUrl: string;
  publicPort: number;
  adminPort: number;
  oidc: boolean;
  fetchAllowPrivate: boolean;
  fetchAllowHosts: string[];
  tessera: string | null;
  warnings: string[];
}

function uptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} T ${h} Std` : h ? `${h} Std ${m} Min` : `${m} Min`;
}

export function System() {
  const sys = useQuery({ queryKey: ['system'], queryFn: () => api.get<SystemInfo>('/api/v1/system'), refetchInterval: 30_000 });
  const s = sys.data;
  if (!s) return <div className="panel panel-pad muted">Lädt …</div>;
  return (
    <div>
      {s.warnings.length === 0 ? (
        <div className="callout ok" style={{ marginBottom: 16 }}>
          <CheckCircle2 />
          <span>Keine Auffälligkeiten.</span>
        </div>
      ) : (
        <div className="stack" style={{ marginBottom: 16, '--gap': '8px' } as React.CSSProperties}>
          {s.warnings.map((w) => (
            <div key={w} className="callout warn">
              <TriangleAlert />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
      <div className="panel panel-pad">
        <dl className="kv">
          <dt>Version</dt>
          <dd>
            Filum {s.version} · Datenbankschema {s.schema}
          </dd>
          <dt>Laufzeit</dt>
          <dd>
            {s.node} auf {s.platform}, läuft seit {uptime(s.uptimeSeconds)}
          </dd>
          <dt>Daten</dt>
          <dd>
            {num(s.links)} Links, {num(s.users)} Konten, Datenbank {bytes(s.dbBytes)} in <code>{s.dataDir}</code>
          </dd>
          <dt>Letzte Sicherung</dt>
          <dd>{s.lastBackup ? `${date(s.lastBackup.createdAt, true)} (${s.lastBackup.name})` : 'noch keine'}</dd>
          <dt>Verwaltung</dt>
          <dd>
            {s.appUrl} → Container-Port {s.adminPort}
          </dd>
          <dt>Weiterleitung</dt>
          <dd>Container-Port {s.publicPort} (nur Kurzlinks, keine Verwaltung)</dd>
          <dt>Anmeldung</dt>
          <dd>{s.oidc ? 'Lokale Konten und OIDC (Firmenkonto)' : 'Lokale Konten'}</dd>
          <dt>Zielprüfung</dt>
          <dd>
            {s.fetchAllowPrivate ? 'Interne Netze erlaubt' : 'Nur öffentliche Ziele'}
            {s.fetchAllowHosts.length ? `, zusätzlich freigegeben: ${s.fetchAllowHosts.join(', ')}` : ''}
          </dd>
          <dt>Tessera</dt>
          <dd>{s.tessera ?? 'nicht verbunden'}</dd>
          <dt>Cache</dt>
          <dd>{num(s.cacheEntries)} Kurzadressen im Speicher</dd>
        </dl>
      </div>
      <SectionTitle title="Betrieb">Updates, Sicherung per Kommandozeile und Reverse-Proxy-Beispiele stehen in der mitgelieferten Dokumentation (docs/betrieb.md).</SectionTitle>
    </div>
  );
}
