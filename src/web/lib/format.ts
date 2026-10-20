const nf = new Intl.NumberFormat('de-DE');
const nfCompact = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });

export const num = (n: number) => nf.format(n);
export const compact = (n: number) => (n < 10_000 ? nf.format(n) : nfCompact.format(n));

export function date(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleString('de-DE', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return 'nie';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });
  if (abs < 45) return diff < 0 ? 'gerade eben' : 'gleich';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
  return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}

/** Für <input type="datetime-local"> */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Zieladresse kompakt: Host fett, Pfad gekürzt */
export function splitUrl(url: string): { host: string; rest: string } {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { host: u.protocol.replace(':', ''), rest: `:${url.slice(u.protocol.length)}` };
    const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}${u.hash}`;
    return { host: u.host.replace(/^www\./, ''), rest };
  } catch {
    return { host: url, rest: '' };
  }
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const STATE_LABEL: Record<string, string> = {
  active: 'Aktiv',
  disabled: 'Deaktiviert',
  scheduled: 'Geplant',
  expired: 'Abgelaufen',
  limit: 'Limit erreicht',
};

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  editor: 'Redaktion',
  member: 'Mitglied',
  viewer: 'Ansehen',
};

export const ROLE_HINT: Record<string, string> = {
  admin: 'Alles, inklusive Domains, Konten, Sicherungen und Einstellungen',
  editor: 'Alle Links bearbeiten, Kampagnen und Sammlungen pflegen',
  member: 'Eigene Links anlegen und bearbeiten, alle Links ansehen und exportieren',
  viewer: 'Alle Links samt Notizen und Statistik ansehen und exportieren, nichts ändern',
};

export function initials(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function plural(n: number, one: string, many: string): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}
