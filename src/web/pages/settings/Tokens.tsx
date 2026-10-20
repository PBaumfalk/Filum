import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, KeyRound, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { CodeBlock } from '../../components/CodeBlock';
import { useToast } from '../../components/toast';
import { CopyButton, Empty, Field } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { date, relative } from '../../lib/format';
import { can, useSession } from '../../lib/queries';
import { SectionTitle } from './common';

interface Token {
  id: number;
  owner: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write' | 'admin';
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

const SCOPE_LABEL = { read: 'Nur lesen', write: 'Lesen und schreiben', admin: 'Admin (inkl. Domains, Konten)' };

export function Tokens() {
  const session = useSession();
  const me = session.data!.user!;
  const admin = can(me.role, 'admin');
  const [all, setAll] = useState(false);
  const tokens = useQuery({ queryKey: ['tokens', all], queryFn: () => api.get<{ items: Token[] }>(`/api/v1/tokens${all ? '?all=1' : ''}`) });
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<null | { name: string; scope: 'read' | 'write' | 'admin'; days: string }>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bm = useRef<HTMLAnchorElement>(null);
  const appUrl = session.data?.appUrl ?? window.location.origin;
  const bookmarklet = `javascript:void(window.open('${appUrl}/neu?url='+encodeURIComponent(location.href),'_blank'))`;

  useEffect(() => {
    // React verbietet javascript:-Adressen in href; das Lesezeichen setzen wir deshalb direkt.
    bm.current?.setAttribute('href', bookmarklet);
  }, [bookmarklet]);

  const create = async () => {
    if (!form) return;
    setError(null);
    try {
      const r = await api.post<{ token: string }>('/api/v1/tokens', { name: form.name, scope: form.scope, expiresInDays: form.days ? Number(form.days) : null });
      setSecret(r.token);
      setForm(null);
      void qc.invalidateQueries({ queryKey: ['tokens'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Fehler');
    }
  };

  return (
    <div>
      <SectionTitle title="API-Tokens">
        Für Skripte, Ticketsysteme oder andere Anwendungen im Intranet. Ein Token hat höchstens die Rechte Ihres Kontos. Filum speichert nur eine Prüfsumme; das Token selbst sehen Sie genau einmal.{' '}
        <RouterLink to="/api">API-Dokumentation</RouterLink>
      </SectionTitle>

      {secret && (
        <div className="panel panel-pad stack" style={{ marginBottom: 14, '--gap': '10px' } as React.CSSProperties}>
          <strong>Neues Token – jetzt kopieren</strong>
          <div className="row">
            <span className="secret" style={{ flex: 1 }}>
              {secret}
            </span>
            <CopyButton text={secret} label="Token kopieren" size="md" />
          </div>
          <CodeBlock
            label="Ausprobieren (curl)"
            copyLabel="Befehl kopieren"
            code={`curl -H "Authorization: Bearer ${secret}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"url":"https://www.beispiel.de/seite"}' \\\n  ${appUrl}/api/v1/links`}
          />
          <button className="btn" style={{ justifySelf: 'start' }} onClick={() => setSecret(null)}>
            Habe ich sicher abgelegt
          </button>
        </div>
      )}

      {form && (
        <form
          className="panel panel-pad stack"
          style={{ '--gap': '12px', marginBottom: 14 } as React.CSSProperties}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="grid-3">
            <Field label="Bezeichnung" error={error}>
              <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z. B. Ticketsystem" required />
            </Field>
            <Field label="Rechte">
              <select className="select" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as 'read' })}>
                <option value="read">{SCOPE_LABEL.read}</option>
                {can(me.role, 'member') && <option value="write">{SCOPE_LABEL.write}</option>}
                {admin && <option value="admin">{SCOPE_LABEL.admin}</option>}
              </select>
            </Field>
            <Field label="Gültig (Tage)" hint="Leer = unbegrenzt">
              <input className="input" type="number" min={1} max={3650} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
            </Field>
          </div>
          <div className="row">
            <button className="btn primary">
              <KeyRound /> Token erstellen
            </button>
            <button className="btn" type="button" onClick={() => setForm(null)}>
              Abbrechen
            </button>
          </div>
        </form>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        {!form && (
          <button className="btn" onClick={() => setForm({ name: '', scope: can(me.role, 'member') ? 'write' : 'read', days: '365' })}>
            <Plus /> Neues Token
          </button>
        )}
        <span className="spacer" />
        {admin && (
          <label className="check small">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Tokens aller Konten zeigen
          </label>
        )}
      </div>

      <div className="panel table-wrap">
        {tokens.data?.items.length === 0 && <Empty title="Keine aktiven Tokens" art={false} />}
        {!!tokens.data?.items.length && (
          <table className="table">
            <thead>
              <tr>
                <th>Bezeichnung</th>
                <th>Rechte</th>
                <th>Zuletzt benutzt</th>
                <th>Gültig bis</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.data.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                    <div className="xsmall mono muted">
                      {t.prefix}… {all && `· ${t.owner}`}
                    </div>
                  </td>
                  <td>{SCOPE_LABEL[t.scope]}</td>
                  <td className="muted">{relative(t.lastUsedAt)}</td>
                  <td className={t.expired ? '' : 'muted'} style={t.expired ? { color: 'var(--danger)' } : undefined}>
                    {t.expiresAt ? date(t.expiresAt) : 'unbegrenzt'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn sm ghost danger"
                      onClick={async () => {
                        try {
                          await api.del(`/api/v1/tokens/${t.id}`);
                          void qc.invalidateQueries({ queryKey: ['tokens'] });
                          toast.ok('Token widerrufen');
                        } catch (e) {
                          toast.error(e);
                        }
                      }}
                    >
                      Widerrufen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SectionTitle title="Lesezeichen „Mit Filum kürzen“">
        Ziehen Sie die Schaltfläche in die Lesezeichenleiste Ihres Browsers. Ein Klick darauf öffnet Filum mit der Adresse der gerade besuchten Seite.
      </SectionTitle>
      <div className="panel panel-pad row wrap">
        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
        <a ref={bm} className="btn thread" onClick={(e) => e.preventDefault()} draggable title="In die Lesezeichenleiste ziehen">
          <Bookmark /> Mit Filum kürzen
        </a>
        <span className="small muted">Funktioniert in allen gängigen Browsern. Es werden keine Daten übertragen, bis Sie in Filum auf „Kürzen“ klicken.</span>
      </div>
    </div>
  );
}
