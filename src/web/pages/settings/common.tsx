import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useToast } from '../../components/toast';
import { api } from '../../lib/api';
import type { Settings } from '../../lib/types';

export function SettingRow({ title, children, description }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      <div style={{ minWidth: 0, display: 'grid', gap: 10 }}>{children}</div>
    </div>
  );
}

export function SectionTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ margin: '28px 0 10px' }}>
      <h2>{title}</h2>
      {children && <p className="small muted" style={{ marginTop: 4, maxWidth: '68ch' }}>{children}</p>}
    </div>
  );
}

export function useSaveSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (patch: Partial<Settings>, msg = 'Gespeichert') => {
    try {
      const next = await api.patch<Settings>('/api/v1/settings', patch as Record<string, unknown>);
      qc.setQueryData(['settings'], next);
      void qc.invalidateQueries({ queryKey: ['session'] });
      toast.ok(msg);
      return true;
    } catch (e) {
      toast.error(e);
      return false;
    }
  };
}
