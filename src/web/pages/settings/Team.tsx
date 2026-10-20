import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, Link2, Lock, Mail, MoreHorizontal, Plus, Trash2, Unlock, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Dialog, MenuItem, Popover } from '../../components/overlay';
import { useToast } from '../../components/toast';
import { CopyButton, Field } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { date, initials, relative, ROLE_HINT, ROLE_LABEL } from '../../lib/format';
import { can, useSession } from '../../lib/queries';
import type { Role, User } from '../../lib/types';
import { SectionTitle } from './common';

const ROLES: Role[] = ['viewer', 'member', 'editor', 'admin'];

/** Ruhige, aus dem Namen abgeleitete Avatarfarbe: gleiche Person, gleiche Farbe – ohne Rot. */
const AVATAR_HUES = [205, 225, 250, 170, 145, 35, 280, 190];
function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${AVATAR_HUES[h % AVATAR_HUES.length]} 26% 38%)`;
}

type Invite = { email: string; role: Role; url: string; expiresAt: string | null };

export function Team() {
  const session = useSession();
  const me = session.data!.user!;
  const admin = can(me.role, 'admin');
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ items: User[]; invites: { id: number; email: string; role: Role; expiresAt: string }[] }>('/api/v1/users'),
  });
  const [mode, setMode] = useState<null | 'invite' | 'create'>(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'member' as Role, password: '' });
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['users'] });

  const openForm = (m: 'invite' | 'create') => {
    setMode(m);
    setInvite(null);
    setError(null);
    setForm({ email: '', name: '', role: form.role, password: '' });
  };

  const submit = async () => {
    setError(null);
    try {
      if (mode === 'invite') {
        const r = await api.post<{ url: string; expiresAt?: string }>('/api/v1/invites', { email: form.email, role: form.role });
        setInvite({ email: form.email, role: form.role, url: r.url, expiresAt: r.expiresAt ?? null });
      } else {
        await api.post('/api/v1/users', form);
        toast.ok('Konto angelegt');
        setMode(null);
      }
      setForm({ email: '', name: '', role: form.role, password: '' });
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Das hat nicht geklappt. Bitte erneut versuchen.');
    }
  };

  const patch = async (u: User, body: Record<string, unknown>, msg: string) => {
    try {
      await api.patch(`/api/v1/users/${u.id}`, body);
      refresh();
      toast.ok(msg);
    } catch (e) {
      toast.error(e);
    }
  };

  const doDelete = async (u: User) => {
    try {
      await api.del(`/api/v1/users/${u.id}`);
      refresh();
      toast.ok('Konto gelöscht; seine Links gehören jetzt Ihnen');
    } catch (e) {
      toast.error(e);
    }
    setConfirmDelete(null);
  };

  const doReset = async () => {
    if (!resetFor) return;
    setResetError(null);
    try {
      await api.post(`/api/v1/users/${resetFor.id}/password`, { password: resetPw });
      toast.ok('Passwort gesetzt; alle Sitzungen der Person wurden beendet');
      setResetFor(null);
      setResetPw('');
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : 'Das Passwort konnte nicht gesetzt werden.');
    }
  };

  return (
    <div>
      <div className="callout" style={{ marginBottom: 16 }}>
        <span className="small">
          {ROLES.slice()
            .reverse()
            .map((r) => (
              <span key={r} style={{ display: 'block' }}>
                <strong>{ROLE_LABEL[r]}:</strong> {ROLE_HINT[r]}
              </span>
            ))}
        </span>
      </div>

      {admin && (
        <div className="row wrap" style={{ marginBottom: 14 }}>
          <button className="btn primary" onClick={() => openForm('invite')}>
            <UserPlus /> Per Link einladen
          </button>
          <button className="btn" onClick={() => openForm('create')}>
            <Plus /> Konto direkt anlegen
          </button>
        </div>
      )}

      {mode === 'invite' && invite && (
        <section className="panel panel-pad stack invite-result" style={{ marginBottom: 16, '--gap': '12px' } as React.CSSProperties} aria-live="polite">
          <div className="row" style={{ gap: 10 }}>
            <span className="invite-check" aria-hidden>
              <Check size={16} />
            </span>
            <h2>Einladung erstellt</h2>
          </div>
          <dl className="invite-facts">
            <div>
              <dt>Für</dt>
              <dd>{invite.email}</dd>
            </div>
            <div>
              <dt>Rolle</dt>
              <dd>{ROLE_LABEL[invite.role]}</dd>
            </div>
            <div>
              <dt>Gültig bis</dt>
              <dd>{invite.expiresAt ? date(invite.expiresAt, true) : '7 Tage'} · einmal verwendbar</dd>
            </div>
          </dl>
          <div className="field">
            <span className="label">Einladungslink</span>
            <div className="row">
              <span className="secret" style={{ flex: 1 }}>
                {invite.url}
              </span>
              <CopyButton text={invite.url} label="Einladungslink kopieren" size="md" toastText="Einladungslink kopiert" />
            </div>
            <span className="hint">Filum verschickt keine E-Mails. Geben Sie den Link selbst weiter, etwa per E-Mail oder Chat.</span>
          </div>
          <div className="row wrap">
            <button className="btn" type="button" onClick={() => openForm('invite')}>
              <UserPlus /> Weitere Person einladen
            </button>
            <button className="btn ghost" type="button" onClick={() => (setMode(null), setInvite(null))}>
              Fertig
            </button>
          </div>
        </section>
      )}

      {mode && !invite && (
        <form
          className="panel panel-pad stack"
          style={{ marginBottom: 16, '--gap': '14px' } as React.CSSProperties}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2>{mode === 'invite' ? 'Einladung erstellen' : 'Konto anlegen'}</h2>
          {mode === 'invite' && <p className="small muted">Filum verschickt keine E-Mails. Sie erhalten einen Link, den Sie selbst weitergeben. Er ist 7 Tage gültig und einmal verwendbar.</p>}
          <div className="grid-2">
            <Field label="E-Mail">
              <input className="input" type="email" autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </Field>
            <Field label="Rolle">
              <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            {mode === 'create' && (
              <>
                <Field label="Name">
                  <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label="Anfangspasswort" hint="Mindestens 10 Zeichen. Bitte sicher übergeben.">
                  <input className="input" type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
                </Field>
              </>
            )}
          </div>
          {error && <div className="callout danger">{error}</div>}
          <div className="row">
            <button className="btn primary" type="submit">
              {mode === 'invite' ? <Link2 /> : <Plus />}
              {mode === 'invite' ? 'Link erzeugen' : 'Anlegen'}
            </button>
            <button className="btn" type="button" onClick={() => setMode(null)}>
              Schließen
            </button>
          </div>
        </form>
      )}

      <div className="panel table-wrap">
        <table className="table team-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Rolle</th>
              <th>Zuletzt angemeldet</th>
              <th>
                <span className="sr-only">Aktionen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.data?.items.map((u) => (
              <tr key={u.id} className={u.disabled ? 'is-disabled' : undefined}>
                <td className="team-person">
                  <div className="row">
                    <span className="avatar" aria-hidden style={{ background: avatarColor(u.name || u.email), color: '#fff' }}>
                      {initials(u.name || u.email)}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>
                        {u.name || '–'} {u.id === me.id && <span className="pill">Sie</span>} {u.disabled && <span className="pill">Gesperrt</span>} {u.sso && <span className="pill info">SSO</span>}
                      </div>
                      <div className="xsmall muted ellipsis">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="team-role">
                  {admin && u.id !== me.id ? (
                    <select className="select" style={{ width: 'auto', minHeight: 32 }} value={u.role} onChange={(e) => void patch(u, { role: e.target.value }, 'Rolle geändert')} aria-label={`Rolle von ${u.email}`}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    ROLE_LABEL[u.role]
                  )}
                </td>
                <td className="muted team-last" title={u.lastLoginAt ? date(u.lastLoginAt, true) : undefined}>
                  <span className="team-last-label">Zuletzt angemeldet: </span>
                  {u.lastLoginAt ? relative(u.lastLoginAt) : 'noch nie'}
                </td>
                <td className="team-actions" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {admin && u.id !== me.id && (
                    <RowMenu
                      user={u}
                      onPassword={() => (setResetFor(u), setResetPw(''), setResetError(null))}
                      onToggle={() => void patch(u, { disabled: !u.disabled }, u.disabled ? 'Konto entsperrt' : 'Konto gesperrt')}
                      onDelete={() => setConfirmDelete(u)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {admin && !!users.data?.invites.length && (
        <>
          <SectionTitle title="Offene Einladungen" />
          <div className="panel table-wrap">
            <table className="table team-table">
              <tbody>
                {users.data.invites.map((i) => (
                  <tr key={i.id}>
                    <td className="team-person">
                      <Mail size={14} style={{ verticalAlign: -2, marginRight: 6 }} className="muted" />
                      {i.email}
                    </td>
                    <td className="team-role">{ROLE_LABEL[i.role]}</td>
                    <td className="muted team-last">gültig bis {date(i.expiresAt)}</td>
                    <td className="team-actions" style={{ textAlign: 'right' }}>
                      <button
                        className="btn sm ghost"
                        onClick={async () => {
                          await api.del(`/api/v1/invites/${i.id}`).catch((e) => toast.error(e));
                          refresh();
                        }}
                      >
                        Zurückziehen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Dialog open={!!resetFor} onClose={() => setResetFor(null)} label="Passwort setzen">
        <form
          className="dialog-pad stack"
          style={{ '--gap': '14px' } as React.CSSProperties}
          onSubmit={(e) => {
            e.preventDefault();
            void doReset();
          }}
        >
          <h2>Neues Passwort für {resetFor?.name || resetFor?.email}</h2>
          <p className="small muted">Alle laufenden Sitzungen der Person werden dabei beendet.</p>
          <Field label="Neues Passwort" hint="Mindestens 10 Zeichen. Bitte sicher übergeben." error={resetError}>
            <input className="input" type="text" autoComplete="off" autoFocus value={resetPw} onChange={(e) => setResetPw(e.target.value)} required minLength={10} />
          </Field>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" type="button" onClick={() => setResetFor(null)}>
              Abbrechen
            </button>
            <button className="btn primary" type="submit">
              Passwort setzen
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} label="Konto löschen">
        <div className="dialog-pad stack" style={{ '--gap': '14px' } as React.CSSProperties}>
          <h2>Konto von {confirmDelete?.name || confirmDelete?.email} löschen?</h2>
          <p className="small muted">Die Person kann sich nicht mehr anmelden. Ihre Links bleiben erhalten und gehören danach Ihnen. Wer nur vorübergehend keinen Zugang haben soll, wird besser gesperrt.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" type="button" onClick={() => setConfirmDelete(null)}>
              Abbrechen
            </button>
            <button className="btn danger solid" type="button" onClick={() => confirmDelete && void doDelete(confirmDelete)}>
              <Trash2 /> Endgültig löschen
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function RowMenu({ user, onPassword, onToggle, onDelete }: { user: User; onPassword: () => void; onToggle: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="btn sm ghost icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Aktionen für ${user.name || user.email}`}
        title="Aktionen"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} role="menu" align="end" label={`Aktionen für ${user.email}`} width={220}>
        {!user.sso && (
          <MenuItem icon={<KeyRound />} onSelect={pick(onPassword)}>
            Passwort setzen …
          </MenuItem>
        )}
        <MenuItem icon={user.disabled ? <Unlock /> : <Lock />} onSelect={pick(onToggle)}>
          {user.disabled ? 'Entsperren' : 'Sperren'}
        </MenuItem>
        <div className="menu-sep" />
        <MenuItem icon={<Trash2 />} danger onSelect={pick(onDelete)}>
          Konto löschen …
        </MenuItem>
      </Popover>
    </>
  );
}
