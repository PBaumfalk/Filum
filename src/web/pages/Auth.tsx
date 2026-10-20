import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Field, Logo } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { ROLE_LABEL } from '../lib/format';
import { useDocumentTitle } from '../lib/title';
import type { Session } from '../lib/types';

function Weave() {
  // Viele graue Fäden, ein roter: der eine Weg, der zählt.
  const lines = Array.from({ length: 14 }, (_, i) => {
    const y = 40 + i * 46;
    return `M-20 ${y} C 180 ${y - 30}, 340 ${y + 40}, 520 ${y} S 860 ${y - 20}, 1020 ${y + 10}`;
  });
  return (
    <svg className="weave" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {lines.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeOpacity={0.08 + (i % 3) * 0.03} strokeWidth="1" />
      ))}
      <path
        className="thread-draw"
        pathLength={1}
        d="M-20 520 C 160 520, 220 300, 380 300 C 470 300, 480 380, 420 400 C 350 420, 330 330, 420 300 C 560 250, 760 140, 1020 120"
        fill="none"
        stroke="var(--thread)"
        strokeWidth="2.2"
        strokeLinecap="round"
        style={{ strokeDasharray: 1, strokeDashoffset: 1, animation: 'draw 1.6s var(--ease) forwards 0.2s' }}
      />
    </svg>
  );
}

export function AuthPage({ mode, session }: { mode: 'login' | 'setup' | 'invite'; session: Session }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '', name: '', code: '', confirm: '' });
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useDocumentTitle(mode === 'login' ? 'Anmelden' : mode === 'setup' ? 'Einrichten' : 'Einladung');
  const inviteToken = mode === 'invite' ? location.pathname.split('/').pop() ?? '' : '';
  const oidcError = new URLSearchParams(location.search).get('fehler');

  const invite = useQuery({
    queryKey: ['invite', inviteToken],
    queryFn: () => api.get<{ email: string; role: string }>(`/api/v1/invites/${encodeURIComponent(inviteToken)}`),
    enabled: mode === 'invite',
    retry: false,
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if ((mode === 'setup' || mode === 'invite') && form.password !== form.confirm) {
      setError({ message: 'Die beiden Passwörter stimmen nicht überein.', field: 'confirm' });
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') await api.post('/api/v1/login', { email: form.email, password: form.password });
      else if (mode === 'setup') await api.post('/api/v1/setup', { code: form.code, email: form.email, name: form.name, password: form.password });
      else await api.post(`/api/v1/invites/${encodeURIComponent(inviteToken)}/accept`, { name: form.name, password: form.password });
      await qc.invalidateQueries({ queryKey: ['session'] });
      navigate(mode === 'setup' ? '/domains' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? { message: err.message, field: err.field } : { message: 'Anmeldung fehlgeschlagen.' });
    } finally {
      setBusy(false);
    }
  };

  const fieldErr = (f: string) => (error?.field === f ? error.message : null);

  return (
    <div className="auth-wrap">
      <div className="auth-art">
        <Weave />
        <div className="brand" style={{ padding: 0 }}>
          <Logo />
          <span className="brand-name">Filum</span>
        </div>
        <p className="claim">Lange Adressen, kurze Wege. Und jeder Weg bleibt nachvollziehbar.</p>
      </div>
      <main className="auth-form">
        <form onSubmit={submit} noValidate>
          {mode === 'login' && (
            <>
              <div>
                <h1>Anmelden</h1>
                <p className="muted" style={{ marginTop: 6 }}>
                  {session.organization ? `Link-Studio von ${session.organization}` : 'Ihr Link-Studio im eigenen Netz'}
                </p>
              </div>
              {oidcError && (
                <div className="callout danger" role="alert">
                  {oidcError === 'sitzung' ? 'Die Anmeldung hat zu lange gedauert. Bitte erneut versuchen.' : oidcError}
                </div>
              )}
              {session.oidc.enabled && (
                <a className="btn primary lg" href="/api/v1/auth/oidc/start">
                  <KeyRound />
                  {session.oidc.label}
                </a>
              )}
              {session.oidc.enabled && session.localLogin && (
                <div className="row" style={{ color: 'var(--faint)', fontSize: 'var(--fs-sm)' }}>
                  <hr className="divider" style={{ flex: 1 }} /> oder mit Passwort <hr className="divider" style={{ flex: 1 }} />
                </div>
              )}
            </>
          )}
          {mode === 'setup' && (
            <div>
              <h1>Filum einrichten</h1>
              <p className="muted" style={{ marginTop: 6 }}>
                Legen Sie das erste Konto an. Es erhält Admin-Rechte. Den Einrichtungscode zeigt das Server-Protokoll beim Start an:{' '}
                <code>docker compose logs filum</code>
              </p>
            </div>
          )}
          {mode === 'invite' && (
            <div>
              <h1>Einladung annehmen</h1>
              {invite.isLoading && <p className="muted">Einladung wird geprüft …</p>}
              {invite.isError && (
                <div className="callout danger" style={{ marginTop: 10 }} role="alert">
                  Diese Einladung ist abgelaufen oder wurde schon verwendet. Bitte fragen Sie nach einer neuen.
                </div>
              )}
              {invite.data && (
                <p className="muted" style={{ marginTop: 6 }}>
                  Konto für <strong style={{ color: 'var(--ink)' }}>{invite.data.email}</strong> mit der Rolle „{ROLE_LABEL[invite.data.role]}“.
                </p>
              )}
            </div>
          )}

          {error && !error.field && (
            <div className="callout danger" role="alert">
              {error.message}
            </div>
          )}

          {(mode !== 'login' || session.localLogin) && (
            <>
              {mode === 'setup' && (
                <Field label="Einrichtungscode" htmlFor="code" error={fieldErr('code')}>
                  <input id="code" className="input mono" inputMode="numeric" autoComplete="one-time-code" placeholder="123-456-789" value={form.code} onChange={set('code')} required />
                </Field>
              )}
              {mode !== 'login' && (
                <Field label="Ihr Name" htmlFor="name" error={fieldErr('name')}>
                  <input id="name" className="input" autoComplete="name" value={form.name} onChange={set('name')} required />
                </Field>
              )}
              {mode !== 'invite' && (
                <Field label="E-Mail" htmlFor="email" error={fieldErr('email')}>
                  <input id="email" className="input" type="email" autoComplete="username" value={form.email} onChange={set('email')} required autoFocus={mode === 'login'} />
                </Field>
              )}
              <Field label="Passwort" htmlFor="password" error={fieldErr('password')} hint={mode !== 'login' ? 'Mindestens 10 Zeichen.' : undefined}>
                <input
                  id="password"
                  className="input"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={form.password}
                  onChange={set('password')}
                  required
                />
              </Field>
              {mode !== 'login' && (
                <Field label="Passwort wiederholen" htmlFor="confirm" error={fieldErr('confirm')}>
                  <input id="confirm" className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
                </Field>
              )}
              <button className="btn primary lg" type="submit" disabled={busy || (mode === 'invite' && !invite.data)}>
                {busy ? <span className="spinner" /> : null}
                {mode === 'login' ? 'Anmelden' : mode === 'setup' ? 'Konto anlegen und starten' : 'Konto anlegen'}
                {!busy && <ArrowRight />}
              </button>
            </>
          )}
          <p className="xsmall faint">Filum {session.version} · selbst gehostet, ohne Tracking durch Dritte</p>
        </form>
      </main>
    </div>
  );
}
