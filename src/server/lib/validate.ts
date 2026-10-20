/**
 * Prüfung von Zieladressen und Kurzadressen. Wird von Oberfläche, API und Import
 * gleichermaßen benutzt, damit es nur eine Wahrheit gibt.
 */

export class ValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public code = 'invalid',
  ) {
    super(message);
  }
}

export const MAX_URL_LENGTH = 8192;
export const MAX_SLUG_LENGTH = 80;

const CONTROL = /[\u0000-\u001F\u007F\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

export interface UrlPolicy {
  allowedSchemes: string[];
  /** Hosts der eigenen Kurzlink-Domains: ein Ziel dort würde Schleifen erzeugen. */
  ownHosts: string[];
  blockedHosts: string[];
}

/** Ergänzt fehlendes Schema („beispiel.de/x“ → „https://beispiel.de/x“). */
export function normalizeUrlInput(raw: string): string {
  let s = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:(?!\d+(?:[/?#]|$))/i.test(s) && /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d+)?(\/|\?|#|$)/u.test(s)) {
    s = `https://${s}`;
  }
  return s;
}

export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = pattern.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  return h === p || h.endsWith(`.${p}`);
}

export function validateDestination(raw: string, policy: UrlPolicy, field = 'url'): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new ValidationError('Bitte eine Zieladresse eingeben.', field, 'required');
  const input = normalizeUrlInput(raw);
  if (input.length > MAX_URL_LENGTH) {
    throw new ValidationError(`Die Zieladresse ist länger als ${MAX_URL_LENGTH} Zeichen.`, field, 'too_long');
  }
  if (CONTROL.test(input) || /\s/.test(input)) {
    throw new ValidationError('Die Zieladresse enthält Leer- oder Steuerzeichen. Bitte die Adresse ohne Leerzeichen einfügen.', field);
  }
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new ValidationError('Das ist keine gültige Webadresse. Beispiel: https://www.beispiel.de/seite', field);
  }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  if (!policy.allowedSchemes.includes(scheme)) {
    throw new ValidationError(
      `Adressen mit „${scheme}:“ sind nicht erlaubt. Erlaubt: ${policy.allowedSchemes.map((s) => `${s}:`).join(', ')}`,
      field,
      'scheme',
    );
  }
  if (scheme === 'http' || scheme === 'https') {
    if (!u.hostname) throw new ValidationError('Der Adresse fehlt der Servername.', field);
    if (u.username || u.password) {
      throw new ValidationError('Zugangsdaten in der Adresse (benutzer:passwort@…) sind aus Sicherheitsgründen nicht erlaubt.', field, 'credentials');
    }
    const host = u.hostname.toLowerCase();
    if (policy.ownHosts.some((h) => h.toLowerCase() === u.host.toLowerCase())) {
      throw new ValidationError('Das Ziel zeigt auf eine eigene Kurzlink-Domain. Das kann eine Weiterleitungsschleife erzeugen.', field, 'loop');
    }
    const blocked = policy.blockedHosts.find((b) => hostMatches(host, b));
    if (blocked) {
      throw new ValidationError(`Ziele auf „${blocked}“ sind gesperrt (Sperrliste in den Einstellungen).`, field, 'blocked');
    }
  }
  return u.toString();
}

/** Pfade, die auf der öffentlichen Seite technisch belegt sind. */
const RESERVED = new Set(['.well-known', 'robots.txt', 'favicon.ico', 'healthz', '_filum', 'api', 'apple-touch-icon.png']);

const SLUG_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._~-]|\/(?!\/))*$/;

export function slugKey(slug: string): string {
  return slug.toLowerCase();
}

export function validateSlug(raw: string, field = 'slug'): string {
  const slug = raw.trim().replace(/^\/+|\/+$/g, '');
  if (!slug) throw new ValidationError('Bitte eine Kurzadresse eingeben.', field, 'required');
  if (slug.length > MAX_SLUG_LENGTH) {
    throw new ValidationError(`Die Kurzadresse darf höchstens ${MAX_SLUG_LENGTH} Zeichen lang sein.`, field, 'too_long');
  }
  if (!SLUG_RE.test(slug) || slug.endsWith('.') || slug.endsWith('/')) {
    throw new ValidationError(
      'Erlaubt sind Buchstaben ohne Umlaute, Ziffern sowie - _ . ~ und / zwischen Wörtern. Die Adresse muss mit einem Buchstaben oder einer Ziffer beginnen.',
      field,
    );
  }
  const first = slug.split('/')[0].toLowerCase();
  if (RESERVED.has(first)) {
    throw new ValidationError(`„${first}“ ist technisch reserviert und kann nicht als Kurzadresse verwendet werden.`, field, 'reserved');
  }
  return slug;
}

/** Hostname einer Kurzlink-Domain (ohne Schema, Port erlaubt für Tests/Intranet). */
export function validateHost(raw: string, field = 'host'): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!s) throw new ValidationError('Bitte einen Hostnamen eingeben, z. B. go.beispiel.de', field, 'required');
  let u: URL;
  try {
    u = new URL(`http://${s}`);
  } catch {
    throw new ValidationError('Das ist kein gültiger Hostname. Beispiel: go.beispiel.de', field);
  }
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) {
    throw new ValidationError('Bitte nur den Hostnamen angeben, ohne Pfad oder Zugangsdaten.', field);
  }
  return u.host;
}

/** Sucht UTM-Parameter in einer Adresse und hängt neue an (bestehende werden ersetzt). */
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
export type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>;

export function applyUtm(url: string, utm: Utm | null | undefined): string {
  if (!utm) return url;
  const entries = UTM_KEYS.map((k) => [k, utm[k]?.trim() ?? ''] as const).filter(([, v]) => v);
  if (!entries.length) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;
  for (const [k, v] of entries) u.searchParams.set(k, v);
  return u.toString();
}
