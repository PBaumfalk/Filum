import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Link } from './types';

/** Zuletzt im Inspector geöffnete Links (pro Browser, localStorage) für die Befehlspalette. */
export interface RecentLink {
  id: number;
  short: string;
  title: string;
}

const KEY = 'filum:recent-links';
const MAX = 6;

export function recentLinks(): RecentLink[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as RecentLink[]).filter((r) => r && typeof r.id === 'number' && typeof r.short === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberLink(link: Pick<Link, 'id' | 'slug' | 'title' | 'url'> & { domain: { host: string } }): void {
  try {
    const entry: RecentLink = { id: link.id, short: `${link.domain.host}/${link.slug}`, title: link.title || link.url };
    const next = [entry, ...recentLinks().filter((r) => r.id !== link.id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Speicher nicht verfügbar: Liste bleibt leer */
  }
}

export function forgetLink(id: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(recentLinks().filter((r) => r.id !== id)));
  } catch {
    /* egal */
  }
}

/** Merkt sich jeden Link, der unter /links/:id geladen wird. */
export function useRecentLinkTracker(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      qc.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.query.queryKey[0] !== 'link') return;
        const data = event.query.state.data as Link | undefined;
        if (event.query.state.status !== 'success' || !data?.id || !data.domain) return;
        if (window.location.pathname === `/links/${data.id}`) rememberLink(data);
      }),
    [qc],
  );
}
