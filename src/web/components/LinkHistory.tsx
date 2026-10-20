import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { date, relative } from '../lib/format';
import { useInvalidateLinks } from '../lib/queries';
import type { Link } from '../lib/types';
import { useToast } from './toast';
import { Skeleton } from './ui';

interface Version {
  id: number;
  at: string;
  summary: string;
  by: string;
  url: string;
  slug: string;
}

export function LinkHistory({ link }: { link: Link }) {
  const versions = useQuery({ queryKey: ['versions', link.id, link.updatedAt], queryFn: () => api.get<{ items: Version[] }>(`/api/v1/links/${link.id}/versions`) });
  const invalidate = useInvalidateLinks();
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  const restore = async (v: Version) => {
    setBusy(v.id);
    try {
      await api.post(`/api/v1/links/${link.id}/versions/${v.id}/restore`);
      invalidate();
      toast.ok(`Stand vom ${date(v.at, true)} wiederhergestellt`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="inspector-body">
      <p className="small muted">Jede Änderung an Ziel, Zeitplan oder Regeln wird festgehalten. Ein älterer Stand lässt sich mit einem Klick zurückholen; die Kurzadresse bleibt dabei unverändert.</p>
      {versions.isLoading && <Skeleton h={120} />}
      <div className="timeline">
        {versions.data?.items.map((v, i) => (
          <div className="timeline-item" key={v.id}>
            <span className="timeline-dot" />
            <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
              <div className="row" style={{ alignItems: 'baseline' }}>
                <strong className="small">{v.summary}</strong>
                {i === 0 && <span className="timeline-current">aktueller Stand</span>}
                <span className="xsmall muted" title={date(v.at, true)}>
                  {relative(v.at)} · {v.by}
                </span>
              </div>
              <span className="xsmall mono muted" style={{ overflowWrap: 'anywhere' }}>
                {v.url}
              </span>
              {i > 0 && link.canEdit && (
                <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => void restore(v)} disabled={busy !== null}>
                  {busy === v.id ? <span className="spinner" /> : <RotateCcw />} Diesen Stand wiederherstellen
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
