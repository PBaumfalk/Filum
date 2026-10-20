import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { useToast } from '../../components/toast';
import { Empty } from '../../components/ui';
import { api } from '../../lib/api';
import { date } from '../../lib/format';
import { can, useSession, useSettings } from '../../lib/queries';
import { SectionTitle, SettingRow, useSaveSettings } from './common';

const REASONS: Record<string, string> = {
  phishing: 'Phishing oder Betrug',
  malware: 'Schadsoftware',
  spam: 'Spam',
  illegal: 'Rechtswidriger Inhalt',
  broken: 'Funktioniert nicht',
  other: 'Anderes',
};

interface Report {
  id: number;
  linkId: number | null;
  shortLabel: string | null;
  url: string | null;
  at: string;
  reason: string;
  message: string;
  status: 'open' | 'dismissed' | 'resolved';
}

export function Security() {
  const settings = useSettings();
  const session = useSession();
  const admin = can(session.data?.user?.role, 'admin');
  const save = useSaveSettings();
  const toast = useToast();
  const qc = useQueryClient();
  const [blocked, setBlocked] = useState('');
  const reports = useQuery({ queryKey: ['reports'], queryFn: () => api.get<{ items: Report[] }>('/api/v1/reports') });
  const reserved = useQuery({
    queryKey: ['reserved'],
    queryFn: () => api.get<{ items: { domainId: number; host: string; slug: string; formerUrl: string; deletedAt: string; deletedBy: string | null }[] }>('/api/v1/reserved'),
    enabled: admin,
  });

  useEffect(() => {
    if (settings.data) setBlocked(settings.data.blockedHosts.join('\n'));
  }, [settings.data]);

  const setReport = async (id: number, status: Report['status']) => {
    try {
      await api.patch(`/api/v1/reports/${id}`, { status });
      void qc.invalidateQueries({ queryKey: ['reports'] });
    } catch (e) {
      toast.error(e);
    }
  };

  const open = reports.data?.items.filter((r) => r.status === 'open') ?? [];
  const done = reports.data?.items.filter((r) => r.status !== 'open') ?? [];

  return (
    <div>
      <div className="panel">
        <SettingRow
          title="Gesperrte Ziele"
          description="Ziele auf diesen Domains (inklusive Subdomains) lassen sich nicht verkürzen, weder in der Oberfläche noch per API oder Import. Eine Domain pro Zeile."
        >
          <textarea className="textarea mono" rows={6} value={blocked} onChange={(e) => setBlocked(e.target.value)} placeholder={'bit.ly\nbeispiel-phishing.com'} disabled={!admin} spellCheck={false} />
          {admin && blocked !== (settings.data?.blockedHosts.join('\n') ?? '') && (
            <button
              className="btn primary"
              style={{ justifySelf: 'start' }}
              onClick={() =>
                void save({
                  blockedHosts: blocked
                    .split(/\s+/)
                    .map((h) => h.trim())
                    .filter(Boolean),
                })
              }
            >
              Sperrliste speichern
            </button>
          )}
        </SettingRow>
        <SettingRow title="Missbrauch melden" description="Auf öffentlichen Domains können Besucher über die Vorschauseite (Kurzlink mit +) einen Link melden.">
          <label className="switch">
            <input type="checkbox" role="switch" checked={settings.data?.reportsEnabled ?? true} disabled={!admin} onChange={(e) => void save({ reportsEnabled: e.target.checked })} />
            <span>Meldungen annehmen</span>
          </label>
        </SettingRow>
        <SettingRow title="Eingebaute Schutzmechanismen">
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            <li>Nur angemeldete Konten legen Links an; Rollen begrenzen, wer was ändern darf.</li>
            <li>Ziele mit eingebetteten Zugangsdaten, Steuerzeichen oder Schleifen auf eigene Domains werden abgelehnt.</li>
            <li>Vorschau und Zielprüfung erreichen keine internen Netze und keine Cloud-Metadaten, auch nicht über Weiterleitungen oder DNS-Tricks.</li>
            <li>Gelöschte Kurzadressen bleiben reserviert und werden nie neu vergeben.</li>
            <li>Anmeldung, Passwortseiten und Fehlaufrufe sind gegen Durchprobieren gedrosselt.</li>
            <li>Die Verwaltung ist über die Kurzlink-Domains technisch nicht erreichbar.</li>
          </ul>
        </SettingRow>
      </div>

      <SectionTitle title="Meldungen">Von Besuchern gemeldete Links. Prüfen Sie das Ziel und deaktivieren Sie den Link bei Bedarf.</SectionTitle>
      <div className="panel">
        {open.length === 0 && done.length === 0 && <Empty title="Keine Meldungen" art={false} />}
        {[...open, ...done].map((r) => (
          <div key={r.id} className="setting-row" style={{ opacity: r.status === 'open' ? 1 : 0.6 }}>
            <div>
              <h3>
                {REASONS[r.reason] ?? r.reason} {r.status !== 'open' && <span className="pill">{r.status === 'resolved' ? 'Erledigt' : 'Verworfen'}</span>}
              </h3>
              <p>
                {date(r.at, true)} · {r.shortLabel ?? 'Link gelöscht'}
              </p>
              {r.message && <p style={{ color: 'var(--ink)' }}>„{r.message}“</p>}
            </div>
            <div className="row wrap" style={{ alignSelf: 'center' }}>
              {r.linkId && (
                <RouterLink className="btn sm" to={`/links/${r.linkId}`}>
                  <ExternalLink /> Link ansehen
                </RouterLink>
              )}
              {r.status === 'open' ? (
                <>
                  <button className="btn sm" onClick={() => void setReport(r.id, 'resolved')}>
                    <Check /> Erledigt
                  </button>
                  <button className="btn sm ghost" onClick={() => void setReport(r.id, 'dismissed')}>
                    <X /> Verwerfen
                  </button>
                </>
              ) : (
                <button className="btn sm ghost" onClick={() => void setReport(r.id, 'open')}>
                  Wieder öffnen
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {admin && (
        <>
          <SectionTitle title="Reservierte Kurzadressen">
            Adressen gelöschter Links. Sie bleiben gesperrt, damit gedruckte oder verschickte Exemplare nie auf ein fremdes neues Ziel zeigen. Freigeben nur, wenn sicher ist, dass die alte Adresse nirgends mehr im Umlauf ist.
          </SectionTitle>
          <div className="panel table-wrap">
            {reserved.data?.items.length === 0 && <Empty title="Keine reservierten Adressen" art={false} />}
            {!!reserved.data?.items.length && (
              <table className="table">
                <thead>
                  <tr>
                    <th>Kurzadresse</th>
                    <th>Früheres Ziel</th>
                    <th>Gelöscht</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {reserved.data.items.map((r) => (
                    <tr key={`${r.domainId}/${r.slug}`}>
                      <td className="mono">
                        <span className="faint">{r.host}/</span>
                        {r.slug}
                      </td>
                      <td className="ellipsis" style={{ maxWidth: 280 }} title={r.formerUrl}>
                        {r.formerUrl}
                      </td>
                      <td className="muted">
                        {date(r.deletedAt)}
                        {r.deletedBy ? ` · ${r.deletedBy}` : ''}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn sm ghost"
                          onClick={async () => {
                            try {
                              await api.del(`/api/v1/reserved/${r.domainId}/${encodeURIComponent(r.slug)}`);
                              void qc.invalidateQueries({ queryKey: ['reserved'] });
                              toast.ok(`${r.host}/${r.slug} ist wieder frei`);
                            } catch (e) {
                              toast.error(e);
                            }
                          }}
                        >
                          Freigeben
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
