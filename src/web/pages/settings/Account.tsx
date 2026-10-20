import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useToast } from '../../components/toast';
import { Field } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { ROLE_HINT, ROLE_LABEL } from '../../lib/format';
import { useSession } from '../../lib/queries';
import { SettingRow } from './common';

export function Account() {
  const session = useSession();
  const user = session.data!.user!;
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState<string | null>(null);

  const saveName = async () => {
    try {
      await api.patch('/api/v1/me', { name });
      void qc.invalidateQueries({ queryKey: ['session'] });
      toast.ok('Name gespeichert');
    } catch (e) {
      toast.error(e);
    }
  };

  const savePw = async () => {
    setPwError(null);
    if (pw.next !== pw.confirm) return setPwError('Die beiden neuen Passwörter stimmen nicht überein.');
    try {
      await api.post('/api/v1/me/password', { current: pw.current, next: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast.ok('Passwort geändert. Andere Sitzungen wurden abgemeldet.');
    } catch (e) {
      setPwError(e instanceof ApiError ? e.message : 'Fehler');
    }
  };

  return (
    <div className="panel">
      <SettingRow title="Name" description="So erscheinen Sie im Team und im Verlauf.">
        <div className="row">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" onClick={() => void saveName()} disabled={name === user.name || !name.trim()}>
            Speichern
          </button>
        </div>
      </SettingRow>
      <SettingRow title="E-Mail und Rolle">
        <div>
          <div>{user.email}</div>
          <div className="small muted">
            {ROLE_LABEL[user.role]}: {ROLE_HINT[user.role]}
          </div>
        </div>
      </SettingRow>
      {(user.hasPassword || !user.sso) && (
        <SettingRow title="Passwort" description="Mindestens 10 Zeichen. Danach werden Ihre anderen Sitzungen abgemeldet.">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void savePw();
            }}
          >
            {user.hasPassword && (
              <Field label="Aktuelles Passwort">
                <input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
              </Field>
            )}
            <Field label="Neues Passwort">
              <input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <Field label="Neues Passwort wiederholen" error={pwError}>
              <input className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            <button className="btn primary" style={{ justifySelf: 'start' }} disabled={!pw.next}>
              Passwort ändern
            </button>
          </form>
        </SettingRow>
      )}
      {user.sso && <SettingRow title="Anmeldung">Sie melden sich über das Firmenkonto an. Das Passwort verwaltet Ihre IT.</SettingRow>}
      <SettingRow title="Sitzungen" description="Meldet alle anderen Browser und Geräte ab, an denen Sie angemeldet sind.">
        <button
          className="btn"
          style={{ justifySelf: 'start' }}
          onClick={async () => {
            await api.post('/api/v1/me/logout-everywhere').catch((e) => toast.error(e));
            toast.ok('Andere Sitzungen beendet');
          }}
        >
          Überall sonst abmelden
        </button>
      </SettingRow>
    </div>
  );
}
