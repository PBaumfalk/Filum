/**
 * Liest Titel, Beschreibung, Vorschaubild und Favicon aus einer HTML-Seite.
 * Bewusst ohne DOM-Parser: Es wird nur gelesen, nie ausgeführt, und alle Werte
 * werden als reiner Text behandelt (die Oberfläche maskiert sie beim Anzeigen).
 */

export interface PageMeta {
  title: string;
  description: string;
  image: string | null;
  icon: string | null;
  siteName: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü',
  Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»',
  bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', euro: '€', copy: '©', reg: '®',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return ENTITIES[e] ?? m;
  });
}

function clean(s: string | undefined, max: number): string {
  if (!s) return '';
  return decodeEntities(s)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}

function absolute(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(decodeEntities(href.trim()), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function decodeHtml(body: Buffer, contentType: string | undefined): string {
  let charset = /charset=([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (!charset) {
    const head = body.subarray(0, 2048).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

export function extractMeta(html: string, baseUrl: string): PageMeta {
  const head = html.slice(0, 300_000);
  const metas: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? '').toLowerCase();
    if (key && a.content !== undefined && !(key in metas)) metas[key] = a.content;
  }
  let icon: string | null = null;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a.rel ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('icon') || rel.includes('apple-touch-icon')) {
      const candidate = absolute(a.href, baseUrl);
      if (candidate && !/\.svg(\?|$)/i.test(candidate)) {
        icon = candidate;
        if (rel.includes('apple-touch-icon')) break;
      }
    }
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  return {
    title: clean(metas['og:title'] || metas['twitter:title'] || titleTag, 300),
    description: clean(metas['og:description'] || metas.description || metas['twitter:description'], 600),
    image: absolute(metas['og:image'] || metas['og:image:url'] || metas['twitter:image'], baseUrl),
    icon: icon ?? absolute('/favicon.ico', baseUrl),
    siteName: clean(metas['og:site_name'], 120),
  };
}

/** Erkennt erlaubte Rasterbilder an ihren ersten Bytes (nie am Content-Type allein). SVG ist ausgeschlossen. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 6).toString('latin1') === 'GIF87a' || buf.subarray(0, 6).toString('latin1') === 'GIF89a') return 'image/gif';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  return null;
}
