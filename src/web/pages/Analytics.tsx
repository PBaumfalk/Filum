import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Info, Plus, QrCode, ShieldQuestion, SpellCheck } from 'lucide-react';
import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import { AreaChart, BarList, Delta, formatBucket, Heatmap, percent } from '../components/charts';
import { DIM_LABEL } from '../components/LinkStats';
import { useToast } from '../components/toast';
import { Empty, Segmented, Skeleton } from '../components/ui';
import { api, qs } from '../lib/api';
import { num } from '../lib/format';
import { can, useCampaigns, useCollections, useDomains, useInvalidateLinks, useSession } from '../lib/queries';
import { useDocumentTitle } from '../lib/title';
import type { StatsReport } from '../lib/types';

const RANGES = [
  { value: '24h', label: '24 Std.' },
  { value: '7d', label: '7 Tage' },
  { value: '30d', label: '30 Tage' },
  { value: '90d', label: '90 Tage' },
  { value: '365d', label: '12 Monate' },
];

const OUTCOME: Record<string, { label: string; tone: string; hint: string }> = {
  redirect: { label: 'Weitergeleitet', tone: 'var(--ok)', hint: 'Besucher kamen am Ziel an (inkl. Bots).' },
  not_found: { label: 'Unbekannte Kurzadresse', tone: 'var(--danger)', hint: 'Tippfehler, abgeschnittene Links oder Durchprobieren.' },
  gone: { label: 'Gelöschter Link', tone: 'var(--warn)', hint: 'Der Link wurde gelöscht, ist aber noch im Umlauf.' },
  disabled: { label: 'Deaktivierter Link', tone: 'var(--warn)', hint: 'Besucher sahen die Hinweisseite.' },
  expired: { label: 'Abgelaufen oder Limit', tone: 'var(--warn)', hint: 'Ablaufdatum oder Aufruflimit erreicht.' },
  scheduled: { label: 'Noch nicht aktiv', tone: 'var(--info)', hint: 'Aufrufe vor dem Startzeitpunkt.' },
  password: { label: 'Passwortseite gezeigt', tone: 'var(--info)', hint: '' },
  password_failed: { label: 'Falsches Passwort', tone: 'var(--danger)', hint: '' },
  preview: { label: 'Vorschau angesehen', tone: 'var(--chart-3)', hint: 'Aufrufe mit angehängtem +' },
  domain_unknown: { label: 'Unbekannte Domain', tone: 'var(--chart-3)', hint: 'Anfragen an einen nicht eingerichteten Hostnamen.' },
};

export function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const range = params.get('range') ?? '30d';
  const campaignId = params.get('campaignId') ?? '';
  const collectionId = params.get('collectionId') ?? '';
  const domainId = params.get('domainId') ?? '';
  const campaigns = useCampaigns();
  const collections = useCollections();
  const domains = useDomains();
  const navigate = useNavigate();
  const session = useSession();
  useDocumentTitle('Analyse');

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };

  const query = qs({ range, campaignId, collectionId, domainId });
  const stats = useQuery({ queryKey: ['stats', query], queryFn: () => api.get<StatsReport>(`/api/v1/stats${query}`), refetchInterval: 60_000 });
  const outcomes = useQuery({
    queryKey: ['outcomes', range, domainId],
    queryFn: () =>
      api.get<{ outcomes: { outcome: string; count: number }[]; unknown: { domainId: number; host: string; slug: string; count: number; lastSeen: string; suggestion: { id: number; slug: string } | null }[] }>(
        `/api/v1/stats/outcomes${qs({ range, domainId })}`,
      ),
  });
  const campaignStats = useQuery({
    queryKey: ['campaign-stats', range],
    queryFn: () => api.get<{ items: { id: number; name: string; color: string; links: number; clicks: number; qr: number }[] }>(`/api/v1/stats/campaigns?range=${range}`),
  });

  const s = stats.data;
  const filtered = Boolean(campaignId || collectionId || domainId);
  const noData = s && s.totals.clicks === 0 && s.totals.previous === 0 && s.totals.bots === 0;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Analyse</h1>
            <p>Wie Ihre Links genutzt werden. Gezählt werden Aufrufe, keine Personen: Filum speichert weder IP-Adressen noch Kennungen.</p>
          </div>
        </div>

        <div className="row wrap analytics-filters" style={{ marginBottom: 18, gap: 8 }}>
          <Segmented label="Zeitraum" value={range} onChange={(v) => set('range', v)} options={RANGES} />
          <span className="spacer" />
          <select className="select" style={{ width: 'auto' }} value={campaignId} onChange={(e) => set('campaignId', e.target.value)} aria-label="Kampagne">
            <option value="">Alle Kampagnen</option>
            {campaigns.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 'auto' }} value={collectionId} onChange={(e) => set('collectionId', e.target.value)} aria-label="Sammlung">
            <option value="">Alle Sammlungen</option>
            {collections.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {(domains.data?.items.length ?? 0) > 1 && (
            <select className="select" style={{ width: 'auto' }} value={domainId} onChange={(e) => set('domainId', e.target.value)} aria-label="Domain">
              <option value="">Alle Domains</option>
              {domains.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.host}
                </option>
              ))}
            </select>
          )}
        </div>

        {s?.mode === 'off' && (
          <div className="callout info" style={{ marginBottom: 16 }}>
            <Info />
            <span>
              Die Statistik ist abgeschaltet. Weiterleitungen funktionieren unverändert.{' '}
              {can(session.data?.user?.role, 'admin') && <RouterLink to="/einstellungen/datenschutz">Statistik einstellen</RouterLink>}
            </span>
          </div>
        )}

        {!s && (
          <div className="stat-grid">
            <div className="panel panel-pad span-12">
              <Skeleton h={260} />
            </div>
          </div>
        )}

        {s && noData && !filtered && s.mode !== 'off' && (
          <div className="panel" style={{ marginBottom: 16 }}>
            <Empty title="Noch keine Aufrufe in diesem Zeitraum">
              Sobald jemand einen Ihrer Kurzlinks öffnet, erscheint er hier, meist innerhalb weniger Sekunden. Probieren Sie es aus: Kopieren Sie einen Link und öffnen Sie ihn in einem neuen Tab.
            </Empty>
          </div>
        )}

        {s && s.mode !== 'off' && (
          <div className="stat-grid">
            <section className="panel span-12" aria-label="Aufrufe im Zeitverlauf">
              <div style={{ padding: '20px 20px 4px', display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <div className="small muted">Aufrufe</div>
                  <div className="big-number">{num(s.totals.clicks)}</div>
                  <Delta now={s.totals.clicks} before={s.totals.previous} />
                </div>
                <div>
                  <div className="small muted">
                    <QrCode size={13} style={{ verticalAlign: -2 }} /> davon über QR-Code
                  </div>
                  <div className="num" style={{ fontSize: 'var(--fs-xl)', fontWeight: 650 }}>
                    {num(s.totals.qr)}
                    <span className="small muted" style={{ fontWeight: 450 }}>
                      {' '}
                      ({percent(s.totals.qr, s.totals.clicks)})
                    </span>
                  </div>
                </div>
                <div title="Link-Vorschauen in Messengern, Suchmaschinen und andere automatische Abrufe. Sie werden getrennt gezählt und verfälschen die Aufrufe nicht.">
                  <div className="small muted">Vorschau-Abrufe und Bots</div>
                  <div className="num" style={{ fontSize: 'var(--fs-xl)', fontWeight: 650 }}>
                    {num(s.totals.bots)}
                  </div>
                </div>
                <span className="spacer" />
                <div className="legend">
                  <span>
                    <i style={{ background: 'var(--chart-1)' }} />
                    Aufrufe
                  </span>
                  <span>
                    <i style={{ background: 'var(--chart-3)' }} />
                    davon QR
                  </span>
                </div>
              </div>
              <div style={{ padding: '8px 12px 14px' }}>
                <AreaChart
                  height={240}
                  data={s.series.map((p) => ({ label: p.t, value: p.clicks, secondary: p.qr }))}
                  formatLabel={(l) => formatBucket(l, s.range.granularity)}
                  secondaryLabel="per QR"
                />
              </div>
            </section>

            <section className="panel span-7">
              <div className="panel-head">
                <h2>Meistgenutzte Links</h2>
                <span className="hint">Zeitraum</span>
              </div>
              <div style={{ padding: '10px 12px 14px' }}>
                <BarList
                  empty="Keine Aufrufe im Zeitraum."
                  items={s.top.map((t) => ({
                    key: t.id,
                    label: (
                      <span>
                        <span className="mono" style={{ fontWeight: 600 }}>
                          <span className="faint" style={{ fontWeight: 400 }}>
                            {t.host}/
                          </span>
                          {t.slug}
                        </span>{' '}
                        {t.title && <span className="muted">{t.title}</span>}
                      </span>
                    ),
                    value: t.clicks,
                    title: t.url,
                    onClick: () => navigate(`/links/${t.id}`),
                  }))}
                />
              </div>
            </section>

            <section className="panel span-5">
              <div className="panel-head">
                <h2>Wann wird geklickt</h2>
              </div>
              <div style={{ padding: '14px 20px 18px' }}>
                <Heatmap data={s.heatmap} />
              </div>
            </section>

            {s.mode === 'extended' ? (
              Object.entries(DIM_LABEL).map(([k, label]) => (
                <section className="panel span-4" key={k}>
                  <div className="panel-head">
                    <h2>{label}</h2>
                  </div>
                  <div style={{ padding: '10px 12px 14px' }}>
                    <BarList items={(s.dims[k] ?? []).slice(0, 7).map((d) => ({ key: d.value, label: d.value, value: d.count }))} />
                  </div>
                </section>
              ))
            ) : (
              <section className="panel span-12">
                <div className="callout" style={{ border: 0, background: 'transparent', padding: 18 }}>
                  <ShieldQuestion />
                  <span>
                    Herkunft, Gerät, Browser und Sprache werden nicht erfasst. Diese erweiterte Statistik lässt sich einschalten; auch dann speichert Filum nur Tagessummen, nie Einzelaufrufe.{' '}
                    {can(session.data?.user?.role, 'admin') && <RouterLink to="/einstellungen/datenschutz">Datenschutz-Einstellungen</RouterLink>}
                  </span>
                </div>
              </section>
            )}

            {!campaignId && (campaignStats.data?.items.length ?? 0) > 0 && (
              <section className="panel span-6">
                <div className="panel-head">
                  <h2>Kampagnen im Vergleich</h2>
                </div>
                <div style={{ padding: '10px 12px 14px' }}>
                  <BarList
                    items={(campaignStats.data?.items ?? []).map((c) => ({
                      key: c.id,
                      label: (
                        <span>
                          <span className="nav-dot" data-color={c.color} style={{ display: 'inline-block', margin: '0 8px 0 0' }} />
                          {c.name} <span className="faint xsmall">{c.links} Links</span>
                        </span>
                      ),
                      value: c.clicks,
                      onClick: () => set('campaignId', String(c.id)),
                    }))}
                  />
                </div>
              </section>
            )}

            <section className={`panel ${!campaignId && (campaignStats.data?.items.length ?? 0) > 0 ? 'span-6' : 'span-12'}`}>
              <div className="panel-head">
                <h2>Was mit Aufrufen passiert</h2>
              </div>
              <div style={{ padding: '10px 12px 14px' }}>
                <BarList
                  empty="Keine Aufrufe im Zeitraum."
                  items={(outcomes.data?.outcomes ?? []).map((o) => ({
                    key: o.outcome,
                    label: (
                      <span title={OUTCOME[o.outcome]?.hint}>
                        <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: OUTCOME[o.outcome]?.tone ?? 'var(--faint)', marginRight: 8 }} />
                        {OUTCOME[o.outcome]?.label ?? o.outcome}
                      </span>
                    ),
                    value: o.count,
                  }))}
                />
              </div>
            </section>

            <TypoRadar items={outcomes.data?.unknown ?? []} canCreate={can(session.data?.user?.role, 'member')} />
          </div>
        )}
      </div>
    </div>
  );
}

function TypoRadar({
  items,
  canCreate,
}: {
  items: { domainId: number; host: string; slug: string; count: number; lastSeen: string; suggestion: { id: number; slug: string } | null }[];
  canCreate: boolean;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateLinks();
  const [busy, setBusy] = useState<string | null>(null);
  // Agent L (Befund 9): erst kurz bestätigen, dann Link samt aller Einstellungen duplizieren und auf den Tippfehler umstellen.
  const [confirm, setConfirm] = useState<string | null>(null);
  const [done, setDone] = useState<Map<string, number>>(new Map());
  const keyOf = (u: (typeof items)[number]) => `${u.domainId}-${u.slug}`;

  const createAlias = async (u: (typeof items)[number]) => {
    if (!u.suggestion) return;
    const key = keyOf(u);
    setBusy(key);
    setConfirm(null);
    let copyId: number | null = null;
    try {
      // Duplikat übernimmt Ziel, Weiterleitungsregeln, UTM, Zeitplan, Sammlung, Kampagne und Schlagwörter.
      const copy = await api.post<{ id: number; title: string; domain: { id: number }; tags: { name: string }[] }>(`/api/v1/links/${u.suggestion.id}/duplicate`);
      copyId = copy.id;
      const base = copy.title.replace(/ \(Kopie\)$/, '');
      await api.patch(`/api/v1/links/${copy.id}`, {
        slug: u.slug,
        ...(copy.domain.id !== u.domainId ? { domainId: u.domainId } : {}),
        title: `${base || u.suggestion.slug} (Tippfehler-Variante)`,
        tags: [...copy.tags.map((t) => t.name).filter((t) => t.toLowerCase() !== 'tippfehler'), 'Tippfehler'],
      });
      const newId = copy.id;
      setDone((m) => new Map(m).set(key, newId));
      invalidate();
      toast.ok(`${u.host}/${u.slug} leitet jetzt wie ${u.suggestion.slug} weiter`, {
        label: 'Rückgängig',
        run: () =>
          void api
            .del(`/api/v1/links/${newId}`)
            .then(() => {
              setDone((m) => {
                const n = new Map(m);
                n.delete(key);
                return n;
              });
              invalidate();
              toast.ok(`${u.host}/${u.slug} wieder entfernt`);
            })
            .catch((e: unknown) => toast.error(e)),
      });
    } catch (e) {
      // Halb fertiges Duplikat nicht liegen lassen.
      if (copyId !== null) await api.del(`/api/v1/links/${copyId}`).catch(() => undefined);
      invalidate();
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel span-12">
      <div className="panel-head">
        <SpellCheck size={17} className="muted" />
        <h2>Vertipper-Radar</h2>
        <span className="hint">Kurzadressen, die aufgerufen wurden, aber nicht existieren</span>
      </div>
      {items.length === 0 ? (
        <p className="small muted" style={{ padding: '10px 20px 18px' }}>
          Keine Fehlaufrufe im Zeitraum. Wenn ein gedruckter Link falsch abgetippt wird, sehen Sie es hier und können die Variante mit einem Klick umleiten.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Aufgerufene Adresse</th>
                <th style={{ textAlign: 'right' }}>Aufrufe</th>
                <th>Zuletzt</th>
                <th>Vermutlich gemeint</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={`${u.domainId}-${u.slug}`}>
                  <td className="mono">
                    <span className="faint">{u.host}/</span>
                    {u.slug}
                  </td>
                  <td className="num" style={{ textAlign: 'right', fontWeight: 600 }}>
                    {num(u.count)}
                  </td>
                  <td className="muted">{new Date(`${u.lastSeen}T12:00:00`).toLocaleDateString('de-DE')}</td>
                  <td>
                    {u.suggestion ? (
                      <RouterLink to={`/links/${u.suggestion.id}`} className="mono">
                        {u.suggestion.slug}
                      </RouterLink>
                    ) : (
                      <span className="faint">–</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canCreate && u.suggestion && done.has(keyOf(u)) && (
                      <RouterLink to={`/links/${done.get(keyOf(u))}`} className="btn sm ghost">
                        Leitet weiter · öffnen
                      </RouterLink>
                    )}
                    {canCreate && u.suggestion && !done.has(keyOf(u)) && confirm === keyOf(u) && (
                      <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <span className="small muted">
                          <span className="mono">{u.slug}</span> wie <span className="mono">{u.suggestion.slug}</span> weiterleiten?
                        </span>
                        <button className="btn sm" onClick={() => void createAlias(u)} disabled={busy !== null} autoFocus>
                          Anlegen
                        </button>
                        <button className="btn sm ghost" onClick={() => setConfirm(null)} disabled={busy !== null}>
                          Abbrechen
                        </button>
                      </span>
                    )}
                    {canCreate && u.suggestion && !done.has(keyOf(u)) && confirm !== keyOf(u) && (
                      <button className="btn sm" onClick={() => setConfirm(keyOf(u))} disabled={busy !== null}>
                        {busy === keyOf(u) ? <span className="spinner" /> : <ArrowRight />} Auch dorthin leiten
                      </button>
                    )}
                    {canCreate && !u.suggestion && (
                      <button
                        className="btn sm ghost"
                        onClick={() => {
                          navigate('/');
                          window.setTimeout(() => window.dispatchEvent(new CustomEvent('filum:compose')), 40);
                        }}
                      >
                        <Plus /> Link anlegen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
