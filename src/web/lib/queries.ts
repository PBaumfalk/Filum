import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Campaign, Collection, Counts, Domain, Preset, Session, Settings, Tag } from './types';

export const useSession = () =>
  useQuery({ queryKey: ['session'], queryFn: () => api.get<Session>('/api/v1/session'), staleTime: 60_000 });

export const useDomains = () =>
  useQuery({
    queryKey: ['domains'],
    queryFn: () => api.get<{ items: Domain[]; txtPrefix: string; adminHost: string; publicPort: number }>('/api/v1/domains'),
    staleTime: 30_000,
  });

export const useTags = () => useQuery({ queryKey: ['tags'], queryFn: () => api.get<{ items: Tag[] }>('/api/v1/tags'), staleTime: 30_000 });

export const useCollections = () =>
  useQuery({ queryKey: ['collections'], queryFn: () => api.get<{ items: Collection[] }>('/api/v1/collections'), staleTime: 30_000 });

export const useCampaigns = () =>
  useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<{ items: Campaign[] }>('/api/v1/campaigns'), staleTime: 30_000 });

export const usePresets = () => useQuery({ queryKey: ['presets'], queryFn: () => api.get<{ items: Preset[] }>('/api/v1/presets'), staleTime: 60_000 });

export const useCounts = () => useQuery({ queryKey: ['counts'], queryFn: () => api.get<Counts>('/api/v1/links/counts'), staleTime: 10_000 });

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/v1/settings'), staleTime: 60_000 });

/** Nach Änderungen an Links alles Abhängige neu laden */
export function useInvalidateLinks() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['links'] });
    void qc.invalidateQueries({ queryKey: ['link'] });
    void qc.invalidateQueries({ queryKey: ['counts'] });
    void qc.invalidateQueries({ queryKey: ['tags'] });
    void qc.invalidateQueries({ queryKey: ['collections'] });
    void qc.invalidateQueries({ queryKey: ['campaigns'] });
  };
}

export function can(role: string | undefined, min: 'viewer' | 'member' | 'editor' | 'admin'): boolean {
  const rank: Record<string, number> = { viewer: 0, member: 1, editor: 2, admin: 3 };
  return rank[role ?? 'viewer'] >= rank[min];
}
