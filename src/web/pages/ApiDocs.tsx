import { useQuery } from '@tanstack/react-query';
import { Download, KeyRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { CodeBlock } from '../components/CodeBlock';
import { Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/queries';
import { useDocumentTitle } from '../lib/title';

interface Spec {
  info: { version: string; description: string };
  paths: Record<string, Record<string, { summary: string; description?: string; parameters?: { name: string; in: string; description?: string }[]; requestBody?: unknown }>>;
}

const GROUPS: { title: string; match: RegExp }[] = [
  { title: 'Links', match: /^\/api\/v1\/(links|slug|lookup|preview|images)/ },
  { title: 'Statistik', match: /^\/api\/v1\/stats/ },
  { title: 'Ordnung', match: /^\/api\/v1\/(tags|collections|campaigns|presets)/ },
  { title: 'Import und Export', match: /^\/api\/v1\/(import|export)/ },
  { title: 'Domains', match: /^\/api\/v1\/domains/ },
  { title: 'Konten und Zugang', match: /^\/api\/v1\/(users|invites|tokens|me|session|login|logout|setup|auth)/ },
  { title: 'Verwaltung', match: /^\/api\/v1\/(settings|backups|audit|reports|reserved|system)/ },
  { title: 'Sonstiges', match: /.*/ },
];

export function ApiDocsPage() {
  const spec = useQuery({ queryKey: ['openapi'], queryFn: () => api.get<Spec>('/api/v1/openapi.json'), staleTime: Infinity });
  const session = useSession();
  const base = session.data?.appUrl ?? window.location.origin;
  const [filter, setFilter] = useState('');
  useDocumentTitle('API');

  const groups = useMemo(() => {
    if (!spec.data) return [];
    const entries = Object.entries(spec.data.paths).flatMap(([path, ops]) => Object.entries(ops).map(([method, op]) => ({ path, method, op })));
    const used = new Set<string>();
    return GROUPS.map((g) => ({
      title: g.title,
      items: entries.filter((e) => {
        const key = `${e.method} ${e.path}`;
        if (used.has(key) || !g.match.test(e.path)) return false;
        if (filter && !`${e.path} ${e.op.summary}`.toLowerCase().includes(filter.toLowerCase())) return false;
        used.add(key);
        return true;
      }),
    })).filter((g) => g.items.length);
  }, [spec.data, filter]);

  const example = `curl -X POST ${base}/api/v1/links \\
  -H "Authorization: Bearer flm_…" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://www.beispiel.de/sehr/langer/pfad?parameter=123","slug":"herbst","tags":["Newsletter"]}'`;
  const response = `{
  "id": 42,
  "shortUrl": "https://go.beispiel.de/herbst",
  "slug": "herbst",
  "url": "https://www.beispiel.de/sehr/langer/pfad?parameter=123",
  "state": "active",
  "clicks": 0,
  …
}`;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>API</h1>
            <p>Alles, was die Oberfläche kann, geht auch per REST-API. Oberfläche und API arbeiten mit denselben Daten und denselben Prüfungen.</p>
          </div>
          <span className="spacer" />
          <a className="btn" href="/api/v1/openapi.json" download="filum-openapi.json">
            <Download /> OpenAPI 3.1
          </a>
          <RouterLink className="btn primary" to="/einstellungen/api">
            <KeyRound /> Token erstellen
          </RouterLink>
        </div>

        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <section className="panel panel-pad span-6 stack" style={{ '--gap': '10px' } as React.CSSProperties}>
            <h2>Kurzlink anlegen</h2>
            <CodeBlock label="Anfrage (curl)" code={example} copyLabel="Beispiel kopieren" />
            <CodeBlock label="Antwort · 201 Created" code={response} copyLabel="Antwort kopieren" />
          </section>
          <section className="panel panel-pad span-6 stack" style={{ '--gap': '10px', alignContent: 'start' } as React.CSSProperties}>
            <h2>Grundregeln</h2>
            <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, color: 'var(--ink-2)' }}>
              <li>
                Anmeldung mit <code>Authorization: Bearer flm_…</code>. Tokens haben die Stufen <em>lesen</em>, <em>schreiben</em> oder <em>Admin</em>, nie mehr als das Konto.
              </li>
              <li>JSON rein, JSON raus. Zeitangaben im ISO-8601-Format, z. B. <code>2026-12-31T23:59:00+01:00</code>.</li>
              <li>
                Fehler: <code>{'{ "error": { "code", "message", "field" } }'}</code> mit verständlicher deutscher Meldung und dem betroffenen Feld.
              </li>
              <li>Höchstens 600 Anfragen pro Minute und Token; darüber Status 429.</li>
              <li>
                Listen sind seitenweise: <code>limit</code> (bis 500) und <code>offset</code>; die Antwort enthält <code>total</code>.
              </li>
              <li>Die Weiterleitung selbst läuft über die Kurzlink-Domains, nicht über die API.</li>
            </ul>
          </section>
        </div>

        <div className="search" style={{ maxWidth: 360, marginBottom: 14 }}>
          <input className="input" style={{ paddingLeft: 12 }} placeholder="Endpunkte filtern" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Endpunkte filtern" />
        </div>

        {spec.isLoading && <Skeleton h={300} />}
        <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
          {groups.map((g) => (
            <section key={g.title}>
              <h2 style={{ marginBottom: 8 }}>{g.title}</h2>
              <div className="panel">
                {g.items.map(({ path, method, op }) => (
                  <details key={`${method}${path}`} className="endpoint" style={{ display: 'block' }}>
                    <summary style={{ display: 'grid', gridTemplateColumns: '64px minmax(0,1fr)', gap: 12, cursor: 'pointer', listStyle: 'none', alignItems: 'baseline' }}>
                      <span className={`method ${method}`}>{method.toUpperCase()}</span>
                      <span style={{ minWidth: 0 }}>
                        <code style={{ overflowWrap: 'anywhere' }}>{path}</code>
                        <span className="muted small" style={{ display: 'block' }}>
                          {op.summary}
                        </span>
                      </span>
                    </summary>
                    <div style={{ padding: '10px 0 4px 76px', display: 'grid', gap: 8 }} className="small">
                      {op.description && <p className="muted" style={{ whiteSpace: 'pre-line' }}>{op.description}</p>}
                      {!!op.parameters?.filter((p) => p.in === 'query').length && (
                        <dl className="kv">
                          {op.parameters
                            .filter((p) => p.in === 'query')
                            .map((p) => (
                              <span key={p.name} style={{ display: 'contents' }}>
                                <dt>
                                  <code>{p.name}</code>
                                </dt>
                                <dd>{p.description}</dd>
                              </span>
                            ))}
                        </dl>
                      )}
                      {op.requestBody ? <p className="muted">JSON-Körper: siehe OpenAPI-Datei.</p> : null}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
