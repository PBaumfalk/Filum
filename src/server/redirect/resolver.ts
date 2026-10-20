import type { DB } from '../db/db.js';
import type { LinkRow } from '../services/links.js';
import type { Routing } from '../services/rules.js';
import { UTM_KEYS, type Utm } from '../lib/validate.js';

/** Felder, die die Weiterleitung braucht – im Speicher gehalten */
export interface CachedLink {
  id: number;
  domainId: number;
  slug: string;
  url: string;
  title: string;
  redirectType: 301 | 302 | 307 | 308;
  enabled: boolean;
  startsAt: number | null;
  expiresAt: number | null;
  maxClicks: number | null;
  clickCount: number;
  fallbackUrl: string | null;
  passwordHash: string | null;
  forwardQuery: boolean;
  routing: Routing | null;
  metaTitle: string | null;
  metaDescription: string | null;
  /** Kampagnen-UTM, durch link-eigene UTM ergänzt bzw. überschrieben */
  utm: Utm | null;
}

type Entry = { link: CachedLink | null; tomb: boolean; at: number };

/**
 * LRU-Cache für Kurzadressen. Änderungen an Links invalidieren gezielt; ein
 * Neustart leert ihn. Auch „nicht gefunden“ wird kurz gemerkt, damit
 * Fehlzugriffe die Datenbank nicht belasten.
 */
export class Resolver {
  private cache = new Map<string, Entry>();
  private stmt;
  private tombStmt;

  constructor(
    db: DB,
    private max = 50_000,
    private negativeTtlMs = 30_000,
  ) {
    this.stmt = db.prepare(
      `SELECT l.*, c.utm_source c_utm_source, c.utm_medium c_utm_medium, c.utm_campaign c_utm_campaign,
              c.utm_term c_utm_term, c.utm_content c_utm_content
       FROM links l LEFT JOIN campaigns c ON c.id = l.campaign_id WHERE l.domain_id = ? AND l.slug_key = ?`,
    );
    this.tombStmt = db.prepare('SELECT 1 FROM slug_tombstones WHERE domain_id = ? AND slug_key = ?');
  }

  private key(domainId: number, slugKey: string): string {
    return `${domainId}\u0000${slugKey}`;
  }

  lookup(domainId: number, slugKey: string): { link: CachedLink | null; tomb: boolean } {
    const k = this.key(domainId, slugKey);
    const hit = this.cache.get(k);
    if (hit && (hit.link || Date.now() - hit.at < this.negativeTtlMs)) {
      this.cache.delete(k);
      this.cache.set(k, hit);
      return hit;
    }
    const row = this.stmt.get(domainId, slugKey) as (LinkRow & Record<string, string | null>) | undefined;
    const entry: Entry = {
      link: row ? toCached(row) : null,
      tomb: row ? false : Boolean(this.tombStmt.get(domainId, slugKey)),
      at: Date.now(),
    };
    this.cache.set(k, entry);
    if (this.cache.size > this.max) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return entry;
  }

  invalidate(domainId: number, slugKey: string): void {
    this.cache.delete(this.key(domainId, slugKey));
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

function toCached(r: LinkRow & Record<string, unknown>): CachedLink {
  const utm: Utm = {};
  for (const k of UTM_KEYS) {
    const v = r[`c_${k}`];
    if (typeof v === 'string' && v) utm[k] = v;
  }
  if (r.utm) Object.assign(utm, JSON.parse(r.utm) as Utm);
  return {
    utm: Object.keys(utm).length ? utm : null,
    id: r.id,
    domainId: r.domain_id,
    slug: r.slug,
    url: r.url,
    title: r.title,
    redirectType: r.redirect_type,
    enabled: Boolean(r.enabled),
    startsAt: r.starts_at,
    expiresAt: r.expires_at,
    maxClicks: r.max_clicks,
    clickCount: r.click_count,
    fallbackUrl: r.fallback_url,
    passwordHash: r.password_hash,
    forwardQuery: Boolean(r.forward_query),
    routing: r.rules ? (JSON.parse(r.rules) as Routing) : null,
    metaTitle: r.meta_title,
    metaDescription: r.meta_description,
  };
}
