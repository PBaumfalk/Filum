export const now = (): number => Math.floor(Date.now() / 1000);

export function iso(sec: number | null | undefined): string | null {
  return sec === null || sec === undefined ? null : new Date(sec * 1000).toISOString();
}

/** ISO-Zeitpunkt oder null in Unix-Sekunden umwandeln. */
export function fromIso(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new Error('invalid-date');
  return Math.floor(t / 1000);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Intl-Formatter sind teuer (ICU); je Zeitzone und Muster nur einmal anlegen. */
export function formatter(tz: string, key: string, opts: Intl.DateTimeFormatOptions, locale = 'en-CA'): Intl.DateTimeFormat {
  const k = `${tz}|${key}`;
  let f = formatters.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz });
    formatters.set(k, f);
  }
  return f;
}

const dayCache = new Map<string, number>();

/** Kalendertag (YYYYMMDD als Zahl) in einer Zeitzone; je Stunde zwischengespeichert. */
export function dayKey(sec: number, tz: string): number {
  // Zeitzonen wechseln höchstens zur vollen Viertelstunde den Tag; Stundenraster genügt für alle realen Zonen mit ganzen Stunden,
  // für Zonen mit :30/:45-Versatz wird je Viertelstunde gerechnet.
  const bucket = Math.floor(sec / 900);
  const k = `${tz}|${bucket}`;
  const hit = dayCache.get(k);
  if (hit !== undefined) return hit;
  const parts = formatter(tz, 'day', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(bucket * 900 * 1000));
  const v = Number(parts.replaceAll('-', ''));
  if (dayCache.size > 5000) dayCache.clear();
  dayCache.set(k, v);
  return v;
}

export function dayKeyToIso(day: number): string {
  const s = String(day);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
