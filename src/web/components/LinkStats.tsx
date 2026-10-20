import { useQuery } from '@tanstack/react-query';
import { QrCode, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { api } from '../lib/api';
import { num } from '../lib/format';
import type { Link, StatsReport } from '../lib/types';
import { AreaChart, BarList, Delta, formatBucket, Heatmap } from './charts';
import { useToast } from './toast';
import { Segmented, Skeleton } from './ui';
import { useQueryClient } from '@tanstack/react-query';

const RANGES = [
  { value: '24h', label: '24 Std.' },
  { value: '7d', label: '7 Tage' },
  { value: '30d', label: '30 Tage' },
  { value: '90d', label: '90 Tage' },
  { value: '365d', label: '12 Monate' },
] as const;

export const DIM_LABEL: Record<string, string> = {
  referrer: 'Herkunft',
  device: 'Gerät',
  os: 'Betriebssystem',
  browser: 'Browser',
  language: 'Sprache',
};

export function LinkStats({ link }: { link: Link }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('30d');
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const stats = useQuery({
    queryKey: ['link-stats', link.id, range],
    queryFn: () => api.get<StatsReport>(`/api/v1/links/${link.id}/stats?range=${range}`),
    refetchInterval: 30_000,
  });
  const s = stats.data;

  const variantLabel = (v: string) => {
    if (v === 'main') return 'Hauptziel';
    const [kind, id] = v.split(':');
    if (kind === 'rule') {
      const i = link.routing?.rules.findIndex((r) => r.id === id) ?? -1;
      const r = link.routing?.rules[i];
      return r ? `Regel ${i + 1}${r.label ? `: ${r.label}` : ''}` : 'Regel (entfernt)';
    }
    const i = link.routing?.variants.findIndex((x) => x.id === id) ?? -1;
    const x = link.routing?.variants[i];
    return x ? `Variante ${i + 2}${x.label ? `: ${x.label}` : ''}` : 'Variante (entfernt)';
  };

  return (
    <div className="inspector-body">
      <Segmented label="Zeitraum" value={range} onChange={setRange} options={RANGES.map((r) => ({ ...r }))} />
      {!s && <Skeleton h={180} />}
      {s && s.mode === 'off' && (
        <div className="callout info">
          Die Statistik ist abgeschaltet. Gezählt wird nur die Gesamtzahl ({num(link.clicks)}), die Aufruflimits brauchen.{' '}
          <RouterLink to="/einstellungen/datenschutz">Einstellungen</RouterLink>
        </div>
      )}
      {s && s.mode !== 'off' && (
        <>
          <div>
            <div className="row" style={{ alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <span className="big-number" style={{ fontSize: '2.2rem' }}>
                {num(s.totals.clicks)}
              </span>
              <span className="muted">Aufrufe</span>
            </div>
            <Delta now={s.totals.clicks} before={s.totals.previous} />
          </div>
          <AreaChart
            height={180}
            data={s.series.map((p) => ({ label: p.t, value: p.clicks, secondary: p.qr }))}
            formatLabel={(l) => formatBucket(l, s.range.granularity)}
            secondaryLabel="per QR"
          />
          <div className="grid-2">
            <div className="panel panel-pad" style={{ padding: 14 }}>
              <div className="row small muted">
                <QrCode size={15} /> Über QR-Code
              </div>
              <strong className="num" style={{ fontSize: 'var(--fs-xl)' }}>
                {s.totals.clicks ? Math.round((s.totals.qr / s.totals.clicks) * 100) : 0} %
              </strong>
              <div className="xsmall muted">{num(s.totals.qr)} Scans</div>
            </div>
            <div className="panel panel-pad" style={{ padding: 14 }} title="Automatische Abrufe, z. B. Link-Vorschauen in Messengern oder Suchmaschinen. Sie zählen nicht als Aufruf.">
              <div className="small muted">Vorschau-Abrufe und Bots</div>
              <strong className="num" style={{ fontSize: 'var(--fs-xl)' }}>
                {num(s.totals.bots)}
              </strong>
              <div className="xsmall muted">nicht mitgezählt</div>
            </div>
          </div>
          {s.dims.route?.length ? (
            <div>
              <h3 style={{ marginBottom: 8 }}>Gewählte Ziele</h3>
              <BarList items={s.dims.route.map((d) => ({ key: d.value, label: variantLabel(d.value), value: d.count }))} />
            </div>
          ) : null}
          <div>
            <h3 style={{ marginBottom: 10 }}>Wann wird geklickt</h3>
            <Heatmap data={s.heatmap} />
          </div>
          {s.mode === 'extended' ? (
            Object.entries(DIM_LABEL).map(([k, label]) =>
              s.dims[k]?.length ? (
                <div key={k}>
                  <h3 style={{ marginBottom: 8 }}>{label}</h3>
                  <BarList items={s.dims[k].slice(0, 6).map((d) => ({ key: d.value, label: d.value, value: d.count }))} />
                </div>
              ) : null,
            )
          ) : (
            <p className="small muted">
              Herkunft, Geräte und Sprachen zeigt Filum nur, wenn ein Admin die erweiterte Statistik einschaltet. Auch dann werden nur Summen gespeichert, keine Daten über einzelne Personen.
            </p>
          )}
        </>
      )}
      {link.canEdit && s && s.mode !== 'off' && (
        <div className="row" style={{ marginTop: 8 }}>
          {confirm ? (
            <>
              <button
                className="btn sm danger solid"
                onClick={async () => {
                  try {
                    await api.del(`/api/v1/links/${link.id}/stats`);
                    toast.ok('Statistik dieses Links gelöscht');
                    void qc.invalidateQueries({ queryKey: ['link-stats', link.id] });
                    void qc.invalidateQueries({ queryKey: ['link', link.id] });
                  } catch (e) {
                    toast.error(e);
                  }
                  setConfirm(false);
                }}
              >
                Ja, Statistik löschen
              </button>
              <button className="btn sm" onClick={() => setConfirm(false)}>
                Abbrechen
              </button>
            </>
          ) : (
            <button className="btn sm ghost" onClick={() => setConfirm(true)}>
              <Trash2 /> Statistik dieses Links löschen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
