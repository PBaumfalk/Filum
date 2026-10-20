import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  CircleX,
  Globe,
  Plus,
  RefreshCw,
  Star,
  Stethoscope,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../components/toast';
import { CodeBlock } from '../components/CodeBlock';
import { Empty, Field, Segmented, Skeleton, Switch } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { date, num, relative } from '../lib/format';
import { can, useDomains, useSession } from '../lib/queries';
import { useDocumentTitle } from '../lib/title';
import type { CheckResult, Domain } from '../lib/types';

type CheckStep = CheckResult['steps'][number];

/**
 * Technische Fehlermeldungen (Node/OpenSSL) in Klartext übersetzen. Der Originaltext bleibt
 * aufklappbar erhalten, damit die IT ihn weitergeben kann.
 */
const TECH: [RegExp, string][] = [
  [/ECONNREFUSED/, 'Der Server ist erreichbar, aber dort nimmt niemand die Verbindung an. Läuft der Reverse Proxy und lauscht er auf diesem Port?'],
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo/, 'Der Name lässt sich nicht auflösen. Fehlt der DNS-Eintrag oder ist er noch nicht verbreitet?'],
  [/ETIMEDOUT|ESOCKETTIMEDOUT|timeout|timed out|aborted|AbortError/i, 'Keine Antwort innerhalb der Wartezeit. Blockiert eine Firewall den Weg?'],
  [/ECONNRESET|socket hang up|EPIPE/i, 'Die Verbindung wurde unterwegs abgebrochen. Oft spricht der Proxy an diesem Port kein HTTPS oder ein Filter greift ein.'],
  [/EHOSTUNREACH|ENETUNREACH/, 'Der Server ist aus diesem Netz nicht erreichbar.'],
  [/CERT_|certificate|self[- ]signed|UNABLE_TO_VERIFY|ERR_TLS|SSL|wrong version number/i, 'Das HTTPS-Zertifikat ist ungültig, abgelaufen oder passt nicht zu diesem Namen.'],
];

function explainStep(detail: string): { plain: string; tech: string | null } {
  const hit = TECH.find(([re]) => re.test(detail));
  if (!hit) return { plain: detail, tech: null };
  // Erklärender Satz des Servers vor der rohen Meldung („HTTP liefert nicht direkt Filum … https://…: connect ECONNREFUSED …“)
  const lead = detail.split(/\bhttps?:\/\//)[0].trim();
  return { plain: lead ? `${lead} ${hit[1]}` : hit[1], tech: detail };
}

const STEP_STATUS: Record<CheckStep['status'], string> = { ok: 'In Ordnung', warning: 'Hinweis', error: 'Fehler', skipped: 'Übersprungen' };

function CheckStepRow({ step: s }: { step: CheckStep }) {
  const { plain, tech } = explainStep(s.detail);
  return (
    <div className={`check-step ${s.status}`}>
      {s.status === 'ok' ? <CheckCircle2 aria-hidden /> : s.status === 'warning' ? <TriangleAlert aria-hidden /> : s.status === 'error' ? <CircleX aria-hidden /> : <CircleDashed aria-hidden />}
      <div style={{ minWidth: 0 }}>
        <strong>
          <span className="sr-only">{STEP_STATUS[s.status]}: </span>
          {s.label}
        </strong>
        <div className="muted">{plain}</div>
        {tech && (
          <details className="tech-details">
            <summary>Technische Details</summary>
            <code>{tech}</code>
          </details>
        )}
      </div>
    </div>
  );
}

function CheckSummary({ check }: { check: CheckResult }) {
  const errors = check.steps.filter((s) => s.status === 'error').length;
  const warnings = check.steps.filter((s) => s.status === 'warning').length;
  if (!errors && !warnings)
    return (
      <span className="pill ok">
        <CheckCircle2 /> Alles in Ordnung
      </span>
    );
  return (
    <span className="row" style={{ gap: 6 }}>
      {errors > 0 && (
        <span className="pill danger">
          <CircleX /> {errors === 1 ? '1 Fehler' : `${errors} Fehler`}
        </span>
      )}
      {warnings > 0 && (
        <span className="pill warn">
          <TriangleAlert /> {warnings === 1 ? '1 Hinweis' : `${warnings} Hinweise`}
        </span>
      )}
    </span>
  );
}

export function DomainsPage() {
  const domains = useDomains();
  const session = useSession();
  const admin = can(session.data?.user?.role, 'admin');
  const [adding, setAdding] = useState(false);
  const items = domains.data?.items ?? [];
  useDocumentTitle('Domains');

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Domains</h1>
            <p>Unter diesen Adressen beantwortet Filum Kurzlinks. Interne Domains funktionieren nur im Firmennetz, öffentliche auch im Internet, sofern Ihr Proxy sie dorthin freigibt.</p>
          </div>
          <span className="spacer" />
          {admin && !adding && (
            <button className="btn primary" onClick={() => setAdding(true)}>
              <Plus /> Domain hinzufügen
            </button>
          )}
        </div>

        {adding && <AddDomain onDone={() => setAdding(false)} adminHost={domains.data?.adminHost ?? ''} />}

        {domains.isLoading && <Skeleton h={140} />}
        {domains.data && items.length === 0 && !adding && (
          <div className="panel">
            <Empty
              title="Noch keine Kurzlink-Domain"
              action={
                admin ? (
                  <button className="btn primary" onClick={() => setAdding(true)}>
                    <Plus /> Erste Domain einrichten
                  </button>
                ) : undefined
              }
            >
              Kurzlinks brauchen einen eigenen Hostnamen, zum Beispiel <code>go.firma.de</code> oder im Intranet <code>go.firma.intern</code>. Er muss per DNS auf Ihren Reverse Proxy zeigen.
            </Empty>
          </div>
        )}

        <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
          {items.map((d) => (
            <DomainCard key={d.id} domain={d} admin={admin} publicPort={domains.data!.publicPort} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AddDomain({ onDone, adminHost }: { onDone: () => void; adminHost: string }) {
  const [host, setHost] = useState('');
  const [kind, setKind] = useState<'internal' | 'public'>('internal');
  const [https, setHttps] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v1/domains', { host, kind, https });
      void qc.invalidateQueries({ queryKey: ['domains'] });
      toast.ok(kind === 'internal' ? 'Domain angelegt und aktiv' : 'Domain angelegt. Jetzt den Besitz nachweisen.');
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="panel panel-pad stack"
      style={{ '--gap': '16px', marginBottom: 16 } as React.CSSProperties}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2>Domain hinzufügen</h2>
      <Field label="Hostname" error={error} hint={`Nur der Name, ohne https:// und ohne Pfad. Nicht die Adresse der Verwaltung (${adminHost}).`}>
        <input className="input mono" autoFocus value={host} onChange={(e) => setHost(e.target.value)} placeholder="go.firma.de" spellCheck={false} required />
      </Field>
      <div className="radio-cards" role="radiogroup" aria-label="Erreichbarkeit">
        <label className="radio-card">
          <input type="radio" checked={kind === 'internal'} onChange={() => setKind('internal')} />
          <strong>
            <Building2 size={14} style={{ verticalAlign: -2 }} /> Intern
          </strong>
          <span>Nur im Firmennetz erreichbar, z. B. für Wiki, Formulare, Laufwerkspfade. Als Admin bestätigen Sie die Domain direkt.</span>
        </label>
        <label className="radio-card">
          <input type="radio" checked={kind === 'public'} onChange={() => setKind('public')} />
          <strong>
            <Globe size={14} style={{ verticalAlign: -2 }} /> Öffentlich
          </strong>
          <span>Für Links in Briefen, Flyern, E-Mails an Externe. Filum beantwortet sie erst nach einem Nachweis per DNS-Eintrag oder HTTP-Prüfung.</span>
        </label>
      </div>
      <Switch checked={https} onChange={setHttps}>
        Kurzlinks mit https:// erzeugen (empfohlen; der Proxy stellt das Zertifikat)
      </Switch>
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy || !host.trim()}>
          {busy && <span className="spinner" />} Hinzufügen
        </button>
        <button className="btn" type="button" onClick={onDone}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function DomainCard({ domain: d, admin, publicPort }: { domain: Domain; admin: boolean; publicPort: number }) {
  const [open, setOpen] = useState(d.status === 'pending');
  const [tab, setTab] = useState<'nachweis' | 'proxy' | 'einstellungen'>(d.status === 'pending' ? 'nachweis' : 'proxy');
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(d.lastCheck);
  const [verifyMsg, setVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['domains'] });

  const runCheck = async () => {
    setBusy('check');
    try {
      setCheck(await api.post<CheckResult>(`/api/v1/domains/${d.id}/check`));
      setOpen(true);
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const verify = async (method: 'dns' | 'http' | 'admin') => {
    setBusy(method);
    setVerifyMsg(null);
    try {
      const r = await api.post<{ ok: boolean; detail: string }>(`/api/v1/domains/${d.id}/verify`, { method });
      setVerifyMsg({ ok: r.ok, text: r.detail });
      if (r.ok) {
        refresh();
        toast.ok('Domain bestätigt und aktiv');
      }
    } catch (e) {
      setVerifyMsg({ ok: false, text: e instanceof Error ? e.message : 'Fehler' });
    } finally {
      setBusy(null);
    }
  };

  const patch = async (body: Record<string, unknown>, msg = 'Gespeichert') => {
    try {
      await api.patch(`/api/v1/domains/${d.id}`, body);
      refresh();
      toast.ok(msg);
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/api/v1/domains/${d.id}`);
      refresh();
      toast.ok(`${d.host} entfernt`);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <article className="panel domain-card">
      <div className="domain-head">
        <span className="domain-host">{d.host}</span>
        {d.isDefault && (
          <span className="pill thread" title="Neue Links landen standardmäßig hier">
            <Star /> Standard
          </span>
        )}
        <span className="pill">{d.kind === 'public' ? <Globe /> : <Building2 />}{d.kind === 'public' ? 'Öffentlich' : 'Intern'}</span>
        {d.status === 'active' && (
          <span className="pill ok">
            <BadgeCheck /> Aktiv
          </span>
        )}
        {d.status === 'pending' && (
          <span className="pill warn">
            <CircleDashed /> Nachweis fehlt
          </span>
        )}
        {d.status === 'disabled' && <span className="pill">Deaktiviert</span>}
        <span className="spacer" />
        <span className="small muted">{num(d.linkCount ?? 0)} Links</span>
        {admin && (
          <button className="btn sm" onClick={() => void runCheck()} disabled={busy !== null}>
            {busy === 'check' ? <span className="spinner" /> : <Stethoscope />} Prüfen
          </button>
        )}
        <button className="btn ghost icon sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Details">
          <ChevronRight style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
        </button>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--line)', padding: '16px 20px 20px', display: 'grid', gap: 16 }}>
          {check && (
            <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
              <div className="row">
                <strong className="small">Diagnose</strong>
                <span className="xsmall muted">{relative(check.at)}</span>
                <span className="spacer" />
                <CheckSummary check={check} />
              </div>
              <div className="check-steps">
                {check.steps.map((s) => (
                  <CheckStepRow key={s.id} step={s} />
                ))}
              </div>
            </div>
          )}

          {admin && (
            <Segmented
              label="Bereich"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'nachweis', label: 'Nachweis' },
                { value: 'proxy', label: 'Proxy & DNS' },
                { value: 'einstellungen', label: 'Einstellungen' },
              ]}
            />
          )}

          {admin && tab === 'nachweis' && (
            <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
              {d.status === 'active' ? (
                <div className="callout ok">
                  <BadgeCheck />
                  <span>
                    Bestätigt {d.verifiedAt ? `am ${date(d.verifiedAt)}` : ''} per {d.verifyMethod === 'dns' ? 'DNS-Eintrag' : d.verifyMethod === 'http' ? 'HTTP-Prüfung' : 'Admin-Freigabe'}.
                  </span>
                </div>
              ) : (
                <p className="small muted">
                  Filum leitet unter dieser Domain erst weiter, wenn feststeht, dass sie zu Ihnen gehört und bei dieser Installation ankommt. So kann niemand eine fremde Domain eintragen und darüber Weiterleitungen ausliefern.
                </p>
              )}
              <div className="field">
                <span className="label">Weg 1: TXT-Eintrag im DNS</span>
                <CodeBlock
                  label="DNS-Eintrag"
                  code={`_filum-challenge.${d.host.split(':')[0]}  TXT  "${d.verifyToken}"`}
                  copyText={d.verifyToken}
                  copyLabel="Prüfwert kopieren"
                />
                <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => void verify('dns')} disabled={busy !== null}>
                  {busy === 'dns' ? <span className="spinner" /> : <RefreshCw />} DNS-Eintrag prüfen
                </button>
              </div>
              <div className="field">
                <span className="label">Weg 2: HTTP-Prüfung über den Proxy</span>
                <span className="hint">
                  Filum ruft <code>{d.https ? 'https' : 'http'}://{d.host}/.well-known/filum-verify</code> auf und erwartet die Kennung dieser Installation. Das klappt, sobald DNS und Proxy fertig sind.
                </span>
                <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => void verify('http')} disabled={busy !== null}>
                  {busy === 'http' ? <span className="spinner" /> : <RefreshCw />} Über HTTP prüfen
                </button>
              </div>
              {d.kind === 'internal' && d.status !== 'active' && (
                <div className="field">
                  <span className="label">Weg 3: Interne Domain als Admin bestätigen</span>
                  <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => void verify('admin')} disabled={busy !== null}>
                    <BadgeCheck /> Als Admin bestätigen
                  </button>
                </div>
              )}
              {verifyMsg && (
                <div className={`callout ${verifyMsg.ok ? 'ok' : 'warn'}`} role="status">
                  {verifyMsg.ok ? <CheckCircle2 /> : <TriangleAlert />}
                  <span>{verifyMsg.text}</span>
                </div>
              )}
            </div>
          )}

          {admin && tab === 'proxy' && <ProxyConfig domain={d} publicPort={publicPort} />}

          {admin && tab === 'einstellungen' && <DomainSettings domain={d} onPatch={patch} onRemove={remove} />}
        </div>
      )}
    </article>
  );
}

function ProxyConfig({ domain: d, publicPort }: { domain: Domain; publicPort: number }) {
  const [kind, setKind] = useState<'caddy' | 'nginx' | 'traefik'>('caddy');
  const cfg = useQuery({
    queryKey: ['proxy', d.id],
    queryFn: () => api.get<{ caddy: string; nginx: string; traefik: string; dns: { record: string; txt: string } }>(`/api/v1/domains/${d.id}/proxy-config`),
  });
  return (
    <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
      <p className="small muted">
        Der Proxy leitet <strong>{d.host}</strong> an den <strong>öffentlichen Port {publicPort}</strong> von Filum weiter, nicht an den Verwaltungsport. Über den öffentlichen Port ist ausschließlich die Weiterleitung erreichbar, nie die Oberfläche oder die API.
      </p>
      {cfg.data && (
        <>
          <div className="field">
            <span className="label">DNS</span>
            <CodeBlock label="Eintrag" code={cfg.data.dns.record} copyLabel="DNS-Eintrag kopieren" />
          </div>
          <Segmented
            label="Proxy"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'caddy', label: 'Caddy' },
              { value: 'nginx', label: 'nginx' },
              { value: 'traefik', label: 'Traefik' },
            ]}
          />
          <CodeBlock label={kind === 'caddy' ? 'Caddyfile' : kind === 'nginx' ? 'nginx.conf' : 'Traefik (dynamische Konfiguration)'} code={cfg.data[kind]} copyLabel="Konfiguration kopieren" />
          {d.kind === 'public' && (
            <div className="callout warn">
              <TriangleAlert />
              <span>Öffentliche Domains: Geben Sie im Proxy nur diesen Hostnamen nach außen frei. Die Verwaltungsadresse gehört nicht ins Internet.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DomainSettings({ domain: d, onPatch, onRemove }: { domain: Domain; onPatch: (b: Record<string, unknown>, msg?: string) => Promise<void>; onRemove: () => Promise<void> }) {
  const [rootUrl, setRootUrl] = useState(d.rootUrl ?? '');
  const [notFoundUrl, setNotFoundUrl] = useState(d.notFoundUrl ?? '');
  const [slugLength, setSlugLength] = useState(String(d.slugLength));
  const [maxAge, setMaxAge] = useState(String(Math.round(d.permanentMaxAge / 60)));
  const [confirm, setConfirm] = useState(false);
  const dirty = rootUrl !== (d.rootUrl ?? '') || notFoundUrl !== (d.notFoundUrl ?? '') || slugLength !== String(d.slugLength) || maxAge !== String(Math.round(d.permanentMaxAge / 60));

  return (
    <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
      <div className="grid-2">
        <Field label="Startseite der Domain" hint="Wohin führt der Aufruf ohne Kurzadresse? Leer: neutrale Hinweisseite.">
          <input className="input" value={rootUrl} onChange={(e) => setRootUrl(e.target.value)} placeholder="https://www.firma.de" />
        </Field>
        <Field label="Bei unbekannter Kurzadresse" hint="Leer: Hinweisseite „Link nicht gefunden“ (empfohlen).">
          <input className="input" value={notFoundUrl} onChange={(e) => setNotFoundUrl(e.target.value)} placeholder="https://www.firma.de/link-nicht-gefunden" />
        </Field>
        <Field label="Länge automatischer Kurzadressen" hint="6 Zeichen ergeben rund 887 Millionen Möglichkeiten.">
          <input className="input" type="number" min={4} max={16} value={slugLength} onChange={(e) => setSlugLength(e.target.value)} />
        </Field>
        <Field label="Browser-Cache für permanente Links (Minuten)" hint="Begrenzt, wie lange Browser ein 301/308-Ziel merken. 60 ist ein guter Wert.">
          <input className="input" type="number" min={0} max={525600} value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
        </Field>
      </div>
      {dirty && (
        <button
          className="btn primary"
          style={{ justifySelf: 'start' }}
          onClick={() =>
            void onPatch({ rootUrl: rootUrl || null, notFoundUrl: notFoundUrl || null, slugLength: Number(slugLength), permanentMaxAge: Number(maxAge) * 60 })
          }
        >
          Einstellungen speichern
        </button>
      )}
      <hr className="divider" />
      <Switch checked={d.previewSuffix} onChange={(v) => void onPatch({ previewSuffix: v })}>
        Vorschau mit „+“ erlauben (z. B. <code>{d.host}/abc+</code> zeigt das Ziel, ohne weiterzuleiten)
      </Switch>
      <Switch checked={d.https} onChange={(v) => void onPatch({ https: v })}>
        Kurzlinks mit https:// erzeugen
      </Switch>
      <div className="row wrap">
        {!d.isDefault && d.status === 'active' && (
          <button className="btn sm" onClick={() => void onPatch({ isDefault: true }, `${d.host} ist jetzt Standard`)}>
            <Star /> Als Standard verwenden
          </button>
        )}
        {d.status === 'active' && (
          <button className="btn sm" onClick={() => void onPatch({ status: 'disabled' }, 'Domain deaktiviert – Links dort antworten nicht mehr')}>
            Deaktivieren
          </button>
        )}
        {d.status === 'disabled' && (
          <button className="btn sm" onClick={() => void onPatch({ status: 'active' }, 'Domain wieder aktiv')}>
            Reaktivieren
          </button>
        )}
        {d.kind === 'internal' ? (
          <button className="btn sm ghost" onClick={() => void onPatch({ kind: 'public' }, 'Als öffentlich markiert – bitte Besitz nachweisen')}>
            Als öffentlich markieren
          </button>
        ) : (
          <button className="btn sm ghost" onClick={() => void onPatch({ kind: 'internal' }, 'Als intern markiert')}>
            Als intern markieren
          </button>
        )}
        <span className="spacer" />
        {confirm ? (
          <>
            <button className="btn sm danger solid" onClick={() => void onRemove()}>
              Domain entfernen
            </button>
            <button className="btn sm" onClick={() => setConfirm(false)}>
              Abbrechen
            </button>
          </>
        ) : (
          <button className="btn sm ghost danger" onClick={() => setConfirm(true)} disabled={(d.linkCount ?? 0) > 0} title={(d.linkCount ?? 0) > 0 ? 'Nur Domains ohne Links lassen sich entfernen' : undefined}>
            <Trash2 /> Entfernen
          </button>
        )}
      </div>
    </div>
  );
}
