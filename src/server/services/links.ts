import { z } from 'zod';
import type { DB } from '../db/db.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { hashPassword, randomSlug } from '../lib/crypto.js';
import { fromIso, iso, now } from '../lib/time.js';
import {
  UTM_KEYS,
  ValidationError,
  slugKey,
  validateDestination,
  validateSlug,
  type UrlPolicy,
  type Utm,
} from '../lib/validate.js';
import type { Actor } from './audit.js';
import type { Audit } from './audit.js';
import { domainBase, type Domains, type DomainRow } from './domains.js';
import { isDynamic, routingSchema, type Routing } from './rules.js';
import type { SettingsStore } from './settings.js';

export type Role = 'admin' | 'editor' | 'member' | 'viewer';

export interface Principal extends Actor {
  userId: number;
  role: Role;
  name: string;
  /** Bei API-Tokens: höchste erlaubte Stufe */
  scope?: 'read' | 'write' | 'admin';
}

export interface LinkRow {
  id: number;
  domain_id: number;
  slug: string;
  slug_key: string;
  url: string;
  title: string;
  notes: string;
  redirect_type: 301 | 302 | 307 | 308;
  enabled: number;
  archived_at: number | null;
  protected: number;
  owner_id: number | null;
  collection_id: number | null;
  campaign_id: number | null;
  starts_at: number | null;
  expires_at: number | null;
  max_clicks: number | null;
  fallback_url: string | null;
  password_hash: string | null;
  forward_query: number;
  utm: string | null;
  rules: string | null;
  meta_title: string | null;
  meta_description: string | null;
  meta_image_id: number | null;
  icon_image_id: number | null;
  meta_fetched_at: number | null;
  health_status: string | null;
  health_code: number | null;
  health_detail: string | null;
  health_checked_at: number | null;
  click_count: number;
  last_click_at: number | null;
  created_at: number;
  updated_at: number;
  created_by: number | null;
  updated_by: number | null;
}

const optionalIso = z.union([z.string().datetime({ offset: true }), z.null()]).optional();
const utmSchema = z
  .object(Object.fromEntries(UTM_KEYS.map((k) => [k, z.string().max(200).optional()])) as Record<(typeof UTM_KEYS)[number], z.ZodOptional<z.ZodString>>)
  .strict();

export const linkInputSchema = z
  .object({
    url: z.string().max(8192),
    domainId: z.number().int().positive().optional(),
    slug: z.string().max(200).optional().nullable(),
    title: z.string().max(300).optional(),
    notes: z.string().max(5000).optional(),
    redirectType: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).optional(),
    tags: z.array(z.string().min(1).max(40)).max(30).optional(),
    collectionId: z.number().int().positive().nullable().optional(),
    campaignId: z.number().int().positive().nullable().optional(),
    startsAt: optionalIso,
    expiresAt: optionalIso,
    maxClicks: z.number().int().positive().max(1_000_000_000).nullable().optional(),
    fallbackUrl: z.string().max(8192).nullable().optional(),
    password: z.string().min(8, 'Das Passwort muss mindestens 8 Zeichen lang sein.').max(200).nullable().optional(),
    forwardQuery: z.boolean().optional(),
    utm: utmSchema.nullable().optional(),
    routing: routingSchema.nullable().optional(),
    protected: z.boolean().optional(),
    enabled: z.boolean().optional(),
    archived: z.boolean().optional(),
    favorite: z.boolean().optional(),
    ownerId: z.number().int().positive().optional(),
  })
  .strict();

export type LinkInput = z.infer<typeof linkInputSchema>;
export const linkPatchSchema = linkInputSchema.partial();
export type LinkPatch = z.infer<typeof linkPatchSchema>;

export type LinkState = 'active' | 'disabled' | 'scheduled' | 'expired' | 'limit';

export function linkState(l: Pick<LinkRow, 'enabled' | 'starts_at' | 'expires_at' | 'max_clicks' | 'click_count'>, t = now()): LinkState {
  if (!l.enabled) return 'disabled';
  if (l.starts_at && l.starts_at > t) return 'scheduled';
  if (l.expires_at && l.expires_at <= t) return 'expired';
  if (l.max_clicks && l.click_count >= l.max_clicks) return 'limit';
  return 'active';
}

const STATE_SQL: Record<string, string> = {
  active: `l.enabled = 1 AND l.archived_at IS NULL AND (l.starts_at IS NULL OR l.starts_at <= :now)
           AND (l.expires_at IS NULL OR l.expires_at > :now) AND (l.max_clicks IS NULL OR l.click_count < l.max_clicks)`,
  disabled: 'l.enabled = 0 AND l.archived_at IS NULL',
  scheduled: 'l.enabled = 1 AND l.archived_at IS NULL AND l.starts_at > :now',
  expired: `l.archived_at IS NULL AND l.enabled = 1 AND ((l.expires_at IS NOT NULL AND l.expires_at <= :now)
            OR (l.max_clicks IS NOT NULL AND l.click_count >= l.max_clicks))`,
  archived: 'l.archived_at IS NOT NULL',
  live: 'l.archived_at IS NULL',
  all: '1 = 1',
};

export interface ListQuery {
  q?: string;
  state?: keyof typeof STATE_SQL;
  domainId?: number;
  tag?: string;
  collectionId?: number | 'none';
  campaignId?: number | 'none';
  owner?: number;
  favoriteOf?: number;
  health?: 'broken' | 'ok' | 'unchecked';
  protected?: boolean;
  sort?: 'created' | 'updated' | 'clicks' | 'slug' | 'last_click' | 'expires';
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  ids?: number[];
}

const SORT_SQL: Record<NonNullable<ListQuery['sort']>, string> = {
  created: 'l.created_at',
  updated: 'l.updated_at',
  clicks: 'l.click_count',
  slug: 'l.slug_key',
  last_click: 'COALESCE(l.last_click_at, 0)',
  expires: 'COALESCE(l.expires_at, 9999999999)',
};

/** Felder, die eine Version beschreibt und die wiederhergestellt werden können */
const VERSION_FIELDS = [
  'url',
  'title',
  'notes',
  'redirect_type',
  'starts_at',
  'expires_at',
  'max_clicks',
  'fallback_url',
  'forward_query',
  'utm',
  'rules',
  'enabled',
  'slug',
  'domain_id',
] as const;

const FIELD_LABELS: Record<string, string> = {
  url: 'Ziel',
  title: 'Titel',
  notes: 'Notiz',
  redirect_type: 'Weiterleitungsart',
  starts_at: 'Startzeit',
  expires_at: 'Ablaufdatum',
  max_clicks: 'Aufruflimit',
  fallback_url: 'Ersatzziel',
  forward_query: 'Parameter-Weitergabe',
  utm: 'Kampagnenparameter',
  rules: 'Regeln',
  enabled: 'Status',
  slug: 'Kurzadresse',
  domain_id: 'Domain',
};

export type LinkChangeListener = (keys: { domainId: number; slugKey: string; id: number }[]) => void;

export class Links {
  private listeners: LinkChangeListener[] = [];

  constructor(
    private db: DB,
    private domains: Domains,
    private settings: SettingsStore,
    private audit: Audit,
  ) {}

  onChange(fn: LinkChangeListener): void {
    this.listeners.push(fn);
  }

  private emit(keys: { domainId: number; slugKey: string; id: number }[]): void {
    for (const fn of this.listeners) fn(keys);
  }

  urlPolicy(): UrlPolicy {
    const s = this.settings.get();
    return { allowedSchemes: s.allowedSchemes, ownHosts: this.domains.hosts(), blockedHosts: s.blockedHosts };
  }

  // ---------------------------------------------------------------- Berechtigungen

  canEdit(p: Principal, l: Pick<LinkRow, 'owner_id'>): boolean {
    if (p.scope === 'read') return false;
    if (p.role === 'admin' || p.role === 'editor') return true;
    if (p.role === 'member') return l.owner_id === p.userId;
    return false;
  }

  assertCanCreate(p: Principal): void {
    if (p.role === 'viewer' || p.scope === 'read') throw forbidden('Ihre Rolle erlaubt nur das Ansehen von Links.');
  }

  assertCanEdit(p: Principal, l: LinkRow): void {
    if (!this.canEdit(p, l)) {
      throw forbidden(
        p.role === 'member' ? 'Sie können nur eigene Links bearbeiten.' : 'Ihre Rolle erlaubt nur das Ansehen von Links.',
      );
    }
  }

  // ---------------------------------------------------------------- Lesen

  getRow(id: number): LinkRow {
    const row = this.db.prepare('SELECT * FROM links WHERE id = ?').get(id) as LinkRow | undefined;
    if (!row) throw notFound('Link');
    return row;
  }

  findBySlug(domainId: number, slug: string): LinkRow | undefined {
    return this.db.prepare('SELECT * FROM links WHERE domain_id = ? AND slug_key = ?').get(domainId, slugKey(slug)) as LinkRow | undefined;
  }

  slugAvailable(domainId: number, slug: string, exceptId?: number): { available: boolean; reason?: string } {
    const key = slugKey(slug);
    const existing = this.db.prepare('SELECT id FROM links WHERE domain_id = ? AND slug_key = ?').get(domainId, key) as
      | { id: number }
      | undefined;
    if (existing && existing.id !== exceptId) return { available: false, reason: 'Diese Kurzadresse ist bereits vergeben.' };
    const tomb = this.db.prepare('SELECT former_url, former_link_id FROM slug_tombstones WHERE domain_id = ? AND slug_key = ?').get(domainId, key) as
      | { former_url: string; former_link_id: number | null }
      | undefined;
    // Die eigene frühere Adresse darf ein Link zurückbekommen.
    if (tomb && !(exceptId && tomb.former_link_id === exceptId)) {
      return {
        available: false,
        reason: 'Diese Kurzadresse gehörte zu einem gelöschten Link und bleibt reserviert, damit verteilte Exemplare nicht ins Leere oder auf ein fremdes Ziel führen. Ein Admin kann sie unter Einstellungen → Reservierte Adressen freigeben.',
      };
    }
    return { available: true };
  }

  list(q: ListQuery, viewer?: Principal) {
    const where: string[] = [];
    const params: Record<string, unknown> = { now: now() };
    const state = q.state ?? 'live';
    where.push(`(${STATE_SQL[state] ?? STATE_SQL.live})`);
    if (q.domainId) {
      where.push('l.domain_id = :domain');
      params.domain = q.domainId;
    }
    if (q.collectionId === 'none') where.push('l.collection_id IS NULL');
    else if (q.collectionId) {
      where.push('l.collection_id = :collection');
      params.collection = q.collectionId;
    }
    if (q.campaignId === 'none') where.push('l.campaign_id IS NULL');
    else if (q.campaignId) {
      where.push('l.campaign_id = :campaign');
      params.campaign = q.campaignId;
    }
    if (q.owner) {
      where.push('l.owner_id = :owner');
      params.owner = q.owner;
    }
    if (q.favoriteOf) {
      where.push('EXISTS (SELECT 1 FROM favorites f WHERE f.link_id = l.id AND f.user_id = :fav)');
      params.fav = q.favoriteOf;
    }
    if (q.protected !== undefined) where.push(q.protected ? 'l.protected = 1' : 'l.protected = 0');
    if (q.health === 'broken') where.push("l.health_status = 'broken'");
    if (q.health === 'ok') where.push("l.health_status = 'ok'");
    if (q.health === 'unchecked') where.push('l.health_status IS NULL');
    if (q.tag) {
      where.push('EXISTS (SELECT 1 FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = l.id AND t.name = :tag COLLATE NOCASE)');
      params.tag = q.tag;
    }
    if (q.ids?.length) {
      where.push(`l.id IN (${q.ids.map((_, i) => `:id${i}`).join(',')})`);
      q.ids.forEach((id, i) => (params[`id${i}`] = id));
    }
    // Steuerzeichen (z. B. NUL) entfernen: Sie ergeben keine sinnvolle Suche und brechen die Volltextabfrage.
    const term = q.q?.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (term) {
      if (term.length >= 3) {
        where.push('l.id IN (SELECT rowid FROM links_fts WHERE links_fts MATCH :fts)');
        params.fts = `"${term.replace(/"/g, '""')}"`;
      } else {
        where.push("(l.slug_key LIKE :like ESCAPE '\\' OR l.url LIKE :like ESCAPE '\\' OR l.title LIKE :like ESCAPE '\\')");
        params.like = `%${term.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      }
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sort = SORT_SQL[q.sort ?? 'created'] ?? SORT_SQL.created;
    const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
    const offset = Math.max(q.offset ?? 0, 0);
    const total = (this.db.prepare(`SELECT COUNT(*) n FROM links l ${whereSql}`).get(params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT l.* FROM links l ${whereSql} ORDER BY ${sort} ${dir}, l.id ${dir} LIMIT ${limit} OFFSET ${offset}`)
      .all(params) as LinkRow[];
    return { total, items: this.serializeMany(rows, viewer), limit, offset };
  }

  /** Zähler für die Seitenleiste */
  counts(userId: number) {
    const t = now();
    const c = (sql: string, ...args: unknown[]) => (this.db.prepare(sql).get(...args) as { n: number }).n;
    const stateCount = (s: string) => c(`SELECT COUNT(*) n FROM links l WHERE ${STATE_SQL[s].replaceAll(':now', String(t))}`);
    return {
      live: stateCount('live'),
      active: stateCount('active'),
      disabled: stateCount('disabled'),
      scheduled: stateCount('scheduled'),
      expired: stateCount('expired'),
      archived: stateCount('archived'),
      favorites: c('SELECT COUNT(*) n FROM favorites f JOIN links l ON l.id = f.link_id WHERE f.user_id = ? AND l.archived_at IS NULL', userId),
      mine: c('SELECT COUNT(*) n FROM links WHERE owner_id = ? AND archived_at IS NULL', userId),
      broken: c("SELECT COUNT(*) n FROM links WHERE health_status = 'broken' AND archived_at IS NULL"),
      protected: c('SELECT COUNT(*) n FROM links WHERE protected = 1 AND archived_at IS NULL'),
    };
  }

  serialize(row: LinkRow, viewer?: Principal) {
    return this.serializeMany([row], viewer)[0];
  }

  serializeMany(rows: LinkRow[], viewer?: Principal) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    const tagRows = this.db
      .prepare(`SELECT lt.link_id, t.id, t.name, t.color FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id IN (${ph}) ORDER BY t.name`)
      .all(...ids) as { link_id: number; id: number; name: string; color: string }[];
    const tags = new Map<number, { id: number; name: string; color: string }[]>();
    for (const t of tagRows) {
      if (!tags.has(t.link_id)) tags.set(t.link_id, []);
      tags.get(t.link_id)!.push({ id: t.id, name: t.name, color: t.color });
    }
    const favs = new Set(
      viewer
        ? (this.db.prepare(`SELECT link_id FROM favorites WHERE user_id = ? AND link_id IN (${ph})`).all(viewer.userId, ...ids) as {
            link_id: number;
          }[]).map((r) => r.link_id)
        : [],
    );
    const collections = new Map(
      (this.db.prepare('SELECT id, name, color FROM collections').all() as { id: number; name: string; color: string }[]).map((c) => [c.id, c]),
    );
    const campaigns = new Map(
      (this.db.prepare('SELECT id, name, color FROM campaigns').all() as { id: number; name: string; color: string }[]).map((c) => [c.id, c]),
    );
    const userIds = [...new Set(rows.map((r) => r.owner_id).filter((x): x is number => x !== null))];
    const users = new Map(
      userIds.length
        ? (this.db.prepare(`SELECT id, name, email FROM users WHERE id IN (${userIds.map(() => '?').join(',')})`).all(...userIds) as {
            id: number;
            name: string;
            email: string;
          }[]).map((u) => [u.id, { id: u.id, name: u.name || u.email }])
        : [],
    );
    // Verlauf der letzten 14 Tage für die Mini-Kurve in der Liste
    const since = Math.floor(Date.now() / 3_600_000) - 14 * 24 + 1;
    const sparkRows = this.db
      .prepare(`SELECT link_id, hour, clicks FROM stats_hourly WHERE link_id IN (${ph}) AND hour >= ?`)
      .all(...ids, since) as { link_id: number; hour: number; clicks: number }[];
    const spark = new Map<number, number[]>();
    for (const r of sparkRows) {
      if (!spark.has(r.link_id)) spark.set(r.link_id, new Array(14).fill(0));
      const idx = Math.min(13, Math.floor((r.hour - since) / 24));
      spark.get(r.link_id)![idx] += r.clicks;
    }

    const t = now();
    return rows.map((r) => {
      const d = this.domains.get(r.domain_id);
      const routing = r.rules ? (JSON.parse(r.rules) as Routing) : null;
      return {
        id: r.id,
        domain: { id: d.id, host: d.host, kind: d.kind, status: d.status },
        slug: r.slug,
        shortUrl: `${domainBase(d)}/${r.slug}`,
        url: r.url,
        title: r.title,
        notes: r.notes,
        redirectType: r.redirect_type,
        effectiveRedirectType: effectiveStatus(r, routing),
        state: linkState(r, t),
        enabled: Boolean(r.enabled),
        archived: r.archived_at !== null,
        archivedAt: iso(r.archived_at),
        protected: Boolean(r.protected),
        owner: r.owner_id ? (users.get(r.owner_id) ?? null) : null,
        collection: r.collection_id ? (collections.get(r.collection_id) ?? null) : null,
        campaign: r.campaign_id ? (campaigns.get(r.campaign_id) ?? null) : null,
        tags: tags.get(r.id) ?? [],
        favorite: favs.has(r.id),
        startsAt: iso(r.starts_at),
        expiresAt: iso(r.expires_at),
        maxClicks: r.max_clicks,
        fallbackUrl: r.fallback_url,
        hasPassword: Boolean(r.password_hash),
        forwardQuery: Boolean(r.forward_query),
        utm: r.utm ? (JSON.parse(r.utm) as Utm) : null,
        routing,
        meta: {
          title: r.meta_title,
          description: r.meta_description,
          imageUrl: r.meta_image_id ? `/api/v1/images/${r.meta_image_id}` : null,
          iconUrl: r.icon_image_id ? `/api/v1/images/${r.icon_image_id}` : null,
          fetchedAt: iso(r.meta_fetched_at),
        },
        health: { status: r.health_status, code: r.health_code, detail: r.health_detail, checkedAt: iso(r.health_checked_at) },
        clicks: r.click_count,
        lastClickAt: iso(r.last_click_at),
        spark: spark.get(r.id) ?? new Array(14).fill(0),
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
        canEdit: viewer ? this.canEdit(viewer, r) : false,
      };
    });
  }

  // ---------------------------------------------------------------- Schreiben

  private resolveDomain(domainId: number | undefined): DomainRow {
    const d = domainId ? this.domains.get(domainId) : this.domains.default();
    if (!d) throw new AppError(400, 'no_domain', 'Es ist noch keine Kurzlink-Domain eingerichtet. Ein Admin legt sie unter „Domains“ an.', 'domainId');
    if (d.status === 'disabled') throw new AppError(400, 'domain_disabled', `Die Domain ${d.host} ist deaktiviert.`, 'domainId');
    return d;
  }

  readableSlug(source: string, title?: string): string {
    let base = title ?? '';
    if (!base) {
      try {
        const u = new URL(source);
        const segs = u.pathname.split('/').filter(Boolean);
        let last = segs.at(-1);
        try {
          // Pfade sind prozentkodiert („%C3%9Cber“) – für die Umschrift die Zeichen selbst verwenden
          if (last) last = decodeURIComponent(last);
        } catch {
          /* bleibt kodiert */
        }
        base = last?.replace(/\.(html?|php|aspx?)$/i, '') ?? u.hostname.replace(/^www\./, '').split('.')[0];
      } catch {
        base = source;
      }
    }
    const translit = base
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const STOP = new Set(['der', 'die', 'das', 'und', 'oder', 'the', 'and', 'of', 'for', 'fuer', 'mit', 'von', 'zu', 'zum', 'zur', 'in', 'im', 'am', 'an', 'auf', 'a', 'an', 'to', 'index', 'www', 'html']);
    const words = translit.split('-').filter((w) => w && !STOP.has(w));
    let out = '';
    for (const w of words) {
      const next = out ? `${out}-${w}` : w;
      if (next.length > 28) break;
      out = next;
    }
    return out || randomSlug(6);
  }

  suggestSlug(domainId: number | undefined, url: string, style?: 'random' | 'readable', title?: string): string {
    const d = this.resolveDomain(domainId);
    const mode = style ?? this.settings.get().slugStyle;
    if (mode === 'readable') {
      const base = this.readableSlug(url, title);
      if (this.slugAvailable(d.id, base).available) return base;
      for (let i = 2; i < 100; i++) {
        const s = `${base}-${i}`;
        if (this.slugAvailable(d.id, s).available) return s;
      }
    }
    for (let len = d.slug_length; len < d.slug_length + 6; len++) {
      for (let i = 0; i < 8; i++) {
        const s = randomSlug(len);
        if (this.slugAvailable(d.id, s).available) return s;
      }
    }
    throw new AppError(500, 'slug_exhausted', 'Es konnte keine freie Kurzadresse erzeugt werden.');
  }

  private resolveTagIds(names: string[], p: Principal): number[] {
    const ids: number[] = [];
    const allowCreate = p.role !== 'member' || this.settings.get().memberCanCreateTags;
    for (const raw of names) {
      const name = raw.trim().replace(/\s+/g, ' ');
      if (!name) continue;
      const existing = this.db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE').get(name) as { id: number } | undefined;
      if (existing) ids.push(existing.id);
      else if (allowCreate) ids.push(Number(this.db.prepare('INSERT INTO tags(name) VALUES (?)').run(name).lastInsertRowid));
      else throw forbidden(`Das Schlagwort „${name}“ existiert nicht, und Ihre Rolle darf keine neuen anlegen.`);
    }
    return [...new Set(ids)];
  }

  private validateRouting(routing: Routing | null | undefined): Routing | null {
    if (!routing) return null;
    const policy = this.urlPolicy();
    const parsed = routingSchema.parse(routing);
    parsed.rules.forEach((r, i) => {
      r.url = validateDestination(r.url, policy, `routing.rules.${i}.url`);
      if (!Object.values(r.when).some((v) => (Array.isArray(v) ? v.length : v))) {
        throw new ValidationError('Jede Regel braucht mindestens eine Bedingung.', `routing.rules.${i}`);
      }
    });
    parsed.variants.forEach((v, i) => {
      v.url = validateDestination(v.url, policy, `routing.variants.${i}.url`);
    });
    return parsed.rules.length || parsed.variants.length ? parsed : null;
  }

  /** Suchindex eines Links neu schreiben (auch nach Änderungen an Schlagwörtern) */
  syncFts(id: number): void {
    const r = this.db.prepare('SELECT slug, url, title, notes FROM links WHERE id = ?').get(id) as
      | { slug: string; url: string; title: string; notes: string }
      | undefined;
    this.db.prepare('DELETE FROM links_fts WHERE rowid = ?').run(id);
    if (!r) return;
    const tags = (this.db.prepare('SELECT t.name FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = ?').all(id) as { name: string }[])
      .map((t) => t.name)
      .join(' ');
    this.db.prepare('INSERT INTO links_fts(rowid, slug, url, title, notes, tags) VALUES (?,?,?,?,?,?)').run(id, r.slug, r.url, r.title, r.notes, tags);
  }

  private snapshot(row: LinkRow): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of VERSION_FIELDS) out[f] = row[f];
    return out;
  }

  private recordVersion(before: LinkRow | null, after: LinkRow, actor: Actor, summaryOverride?: string): void {
    let summary = summaryOverride ?? '';
    if (!summary) {
      if (!before) summary = 'Angelegt';
      else {
        const changed = VERSION_FIELDS.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f])).map((f) => FIELD_LABELS[f]);
        if (!changed.length) return;
        summary = `${changed.join(', ')} geändert`;
      }
    }
    this.db
      .prepare('INSERT INTO link_versions(link_id, created_at, user_id, summary, snapshot) VALUES (?,?,?,?,?)')
      .run(after.id, now(), actor.userId, summary, JSON.stringify(this.snapshot(after)));
  }

  private toTimestamp(v: string | null | undefined, field: string): number | null | undefined {
    if (v === undefined) return undefined;
    try {
      return fromIso(v);
    } catch {
      throw new ValidationError('Ungültiges Datum.', field);
    }
  }

  async create(input: LinkInput, p: Principal, opts: { auditAction?: string; skipAudit?: boolean } = {}) {
    this.assertCanCreate(p);
    const policy = this.urlPolicy();
    const url = validateDestination(input.url, policy, 'url');
    const d = this.resolveDomain(input.domainId);
    // Vor der Verfügbarkeitsprüfung hashen: Danach folgt bis zum INSERT kein await mehr.
    const passwordHash = input.password ? await hashPassword(input.password) : null;
    let slug: string;
    if (input.slug && input.slug.trim()) {
      slug = validateSlug(input.slug);
      const avail = this.slugAvailable(d.id, slug);
      if (!avail.available) throw conflict(avail.reason!, 'slug');
    } else {
      slug = this.suggestSlug(d.id, url);
    }
    const fallback = input.fallbackUrl ? validateDestination(input.fallbackUrl, policy, 'fallbackUrl') : null;
    const routing = this.validateRouting(input.routing);
    const startsAt = this.toTimestamp(input.startsAt, 'startsAt') ?? null;
    const expiresAt = this.toTimestamp(input.expiresAt, 'expiresAt') ?? null;
    if (startsAt && expiresAt && expiresAt <= startsAt) throw new ValidationError('Das Ablaufdatum muss nach dem Start liegen.', 'expiresAt');
    this.assertRefs(input.collectionId, input.campaignId);
    let ownerId = p.userId;
    if (input.ownerId && input.ownerId !== p.userId) {
      if (p.role !== 'admin' && p.role !== 'editor') throw forbidden('Nur Admins und Redaktion können Links für andere anlegen.');
      if (!this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(input.ownerId)) throw new ValidationError('Dieses Konto gibt es nicht.', 'ownerId');
      ownerId = input.ownerId;
    }
    const t = now();
    const run = this.db.transaction(() => {
      const id = Number(
        this.db
          .prepare(
            `INSERT INTO links(domain_id, slug, slug_key, url, title, notes, redirect_type, enabled, archived_at, protected, owner_id,
              collection_id, campaign_id, starts_at, expires_at, max_clicks, fallback_url, password_hash, forward_query, utm, rules,
              created_at, updated_at, created_by, updated_by)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            d.id,
            slug,
            slugKey(slug),
            url,
            (input.title ?? '').trim(),
            input.notes ?? '',
            input.redirectType ?? this.settings.get().defaultRedirectType,
            input.enabled === false ? 0 : 1,
            input.archived ? t : null,
            input.protected ? 1 : 0,
            ownerId,
            input.collectionId ?? null,
            input.campaignId ?? null,
            startsAt,
            expiresAt,
            input.maxClicks ?? null,
            fallback,
            passwordHash,
            input.forwardQuery === false ? 0 : 1,
            cleanUtm(input.utm),
            routing ? JSON.stringify(routing) : null,
            t,
            t,
            p.userId,
            p.userId,
          ).lastInsertRowid,
      );
      if (input.tags?.length) {
        const ins = this.db.prepare('INSERT OR IGNORE INTO link_tags(link_id, tag_id) VALUES (?, ?)');
        for (const tid of this.resolveTagIds(input.tags, p)) ins.run(id, tid);
      }
      if (input.favorite) this.db.prepare('INSERT OR IGNORE INTO favorites(user_id, link_id) VALUES (?, ?)').run(p.userId, id);
      this.syncFts(id);
      const row = this.getRow(id);
      this.recordVersion(null, row, p);
      if (!opts.skipAudit) this.audit.log(p, opts.auditAction ?? 'link.create', 'link', id, { slug, host: d.host, url });
      return row;
    });
    const row = run();
    this.emit([{ domainId: row.domain_id, slugKey: row.slug_key, id: row.id }]);
    return row;
  }

  private assertRefs(collectionId?: number | null, campaignId?: number | null): void {
    if (collectionId && !this.db.prepare('SELECT 1 FROM collections WHERE id = ?').get(collectionId)) {
      throw new ValidationError('Diese Sammlung gibt es nicht.', 'collectionId');
    }
    if (campaignId && !this.db.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(campaignId)) {
      throw new ValidationError('Diese Kampagne gibt es nicht.', 'campaignId');
    }
  }

  async update(id: number, patch: LinkPatch, p: Principal, opts: { summary?: string; confirmProtected?: boolean } = {}) {
    // Einziges await vorab: Ausgangsstand und Prüfungen bis zum Schreiben bleiben dadurch aktuell.
    const passwordHash = patch.password ? await hashPassword(patch.password) : patch.password === null ? null : undefined;
    const before = this.getRow(id);
    this.assertCanEdit(p, before);
    const policy = this.urlPolicy();
    const sets: Record<string, unknown> = {};

    if (patch.url !== undefined) sets.url = validateDestination(patch.url, policy, 'url');
    let domainId = before.domain_id;
    if (patch.domainId !== undefined && patch.domainId !== before.domain_id) {
      domainId = this.resolveDomain(patch.domainId).id;
      sets.domain_id = domainId;
    }
    let slug = before.slug;
    if (patch.slug !== undefined && patch.slug !== null && patch.slug !== before.slug) {
      slug = validateSlug(patch.slug);
      sets.slug = slug;
      sets.slug_key = slugKey(slug);
    }
    if (sets.domain_id !== undefined || (sets.slug_key !== undefined && sets.slug_key !== before.slug_key)) {
      if (before.protected && !opts.confirmProtected) {
        throw new AppError(
          409,
          'protected',
          'Dieser Link ist als „verteilt“ geschützt. Eine neue Kurzadresse oder Domain würde gedruckte oder verschickte Exemplare unbrauchbar machen. Bitte den Schutz zuerst aufheben.',
          'slug',
        );
      }
      const avail = this.slugAvailable(domainId, slug, id);
      if (!avail.available) throw conflict(avail.reason!, 'slug');
    }
    if (patch.title !== undefined) sets.title = patch.title.trim();
    if (patch.notes !== undefined) sets.notes = patch.notes;
    if (patch.redirectType !== undefined) sets.redirect_type = patch.redirectType;
    if (patch.enabled !== undefined) sets.enabled = patch.enabled ? 1 : 0;
    if (patch.archived !== undefined) sets.archived_at = patch.archived ? (before.archived_at ?? now()) : null;
    if (patch.protected !== undefined) {
      if (!patch.protected && before.protected && p.role !== 'admin' && p.role !== 'editor' && before.owner_id !== p.userId) {
        throw forbidden('Den Schutz kann nur die Person aufheben, der der Link gehört, oder die Redaktion.');
      }
      sets.protected = patch.protected ? 1 : 0;
    }
    if (patch.collectionId !== undefined || patch.campaignId !== undefined) this.assertRefs(patch.collectionId, patch.campaignId);
    if (patch.collectionId !== undefined) sets.collection_id = patch.collectionId;
    if (patch.campaignId !== undefined) sets.campaign_id = patch.campaignId;
    const startsAt = this.toTimestamp(patch.startsAt, 'startsAt');
    const expiresAt = this.toTimestamp(patch.expiresAt, 'expiresAt');
    if (startsAt !== undefined) sets.starts_at = startsAt;
    if (expiresAt !== undefined) sets.expires_at = expiresAt;
    const s = startsAt !== undefined ? startsAt : before.starts_at;
    const e = expiresAt !== undefined ? expiresAt : before.expires_at;
    if (s && e && e <= s) throw new ValidationError('Das Ablaufdatum muss nach dem Start liegen.', 'expiresAt');
    if (patch.maxClicks !== undefined) sets.max_clicks = patch.maxClicks;
    if (patch.fallbackUrl !== undefined) sets.fallback_url = patch.fallbackUrl ? validateDestination(patch.fallbackUrl, policy, 'fallbackUrl') : null;
    if (patch.password !== undefined) sets.password_hash = passwordHash ?? null;
    if (patch.forwardQuery !== undefined) sets.forward_query = patch.forwardQuery ? 1 : 0;
    if (patch.utm !== undefined) sets.utm = cleanUtm(patch.utm);
    if (patch.routing !== undefined) {
      const r = this.validateRouting(patch.routing);
      sets.rules = r ? JSON.stringify(r) : null;
    }
    if (patch.ownerId !== undefined && patch.ownerId !== before.owner_id) {
      if (p.role !== 'admin' && p.role !== 'editor') throw forbidden('Nur Admins und Redaktion können Links übertragen.');
      if (!this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(patch.ownerId)) throw new ValidationError('Dieses Konto gibt es nicht.', 'ownerId');
      sets.owner_id = patch.ownerId;
    }

    const run = this.db.transaction(() => {
      const cols = Object.keys(sets);
      const moved = (sets.domain_id !== undefined && sets.domain_id !== before.domain_id) || (sets.slug_key !== undefined && sets.slug_key !== before.slug_key);
      if (moved) {
        // Alte Adresse reservieren (verteilte Exemplare dürfen nie auf ein fremdes Ziel zeigen),
        // eine eigene frühere Reservierung der neuen Adresse aufheben.
        this.db
          .prepare(
            `INSERT OR REPLACE INTO slug_tombstones(domain_id, slug_key, slug, former_url, deleted_at, deleted_by, former_link_id, reason)
             VALUES (?,?,?,?,?,?,?, 'renamed')`,
          )
          .run(before.domain_id, before.slug_key, before.slug, before.url, now(), p.userId, id);
        this.db
          .prepare('DELETE FROM slug_tombstones WHERE domain_id = ? AND slug_key = ? AND former_link_id = ?')
          .run(sets.domain_id ?? before.domain_id, sets.slug_key ?? before.slug_key, id);
      }
      if (cols.length) {
        sets.updated_at = now();
        sets.updated_by = p.userId;
        const all = Object.keys(sets);
        this.db.prepare(`UPDATE links SET ${all.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...all.map((c) => sets[c]), id);
      }
      if (patch.tags !== undefined) {
        this.db.prepare('DELETE FROM link_tags WHERE link_id = ?').run(id);
        const ins = this.db.prepare('INSERT OR IGNORE INTO link_tags(link_id, tag_id) VALUES (?, ?)');
        for (const tid of this.resolveTagIds(patch.tags, p)) ins.run(id, tid);
        if (!cols.length) this.db.prepare('UPDATE links SET updated_at = ?, updated_by = ? WHERE id = ?').run(now(), p.userId, id);
      }
      if (patch.favorite !== undefined) this.setFavorite(id, p.userId, patch.favorite);
      this.syncFts(id);
      const after = this.getRow(id);
      this.recordVersion(before, after, p, opts.summary);
      const changed = Object.keys(sets).filter((k) => !['updated_at', 'updated_by'].includes(k));
      if (changed.length || patch.tags !== undefined) {
        this.audit.log(p, 'link.update', 'link', id, {
          fields: [...changed.filter((c) => c !== 'password_hash'), ...(patch.tags !== undefined ? ['tags'] : []), ...(sets.password_hash !== undefined ? ['password'] : [])],
          ...(sets.url ? { from: before.url, to: sets.url } : {}),
        });
      }
      return after;
    });
    const after = run();
    this.emit([
      { domainId: before.domain_id, slugKey: before.slug_key, id },
      { domainId: after.domain_id, slugKey: after.slug_key, id },
    ]);
    return after;
  }

  setFavorite(linkId: number, userId: number, on: boolean): void {
    if (on) this.db.prepare('INSERT OR IGNORE INTO favorites(user_id, link_id) VALUES (?, ?)').run(userId, linkId);
    else this.db.prepare('DELETE FROM favorites WHERE user_id = ? AND link_id = ?').run(userId, linkId);
  }

  async duplicate(id: number, p: Principal) {
    const src = this.getRow(id);
    const tags = (this.db.prepare('SELECT t.name FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = ?').all(id) as { name: string }[]).map(
      (t) => t.name,
    );
    const row = await this.create(
      {
        url: src.url,
        domainId: src.domain_id,
        title: src.title ? `${src.title} (Kopie)` : '',
        notes: src.notes,
        redirectType: src.redirect_type,
        tags,
        collectionId: src.collection_id,
        campaignId: src.campaign_id,
        fallbackUrl: src.fallback_url,
        forwardQuery: Boolean(src.forward_query),
        utm: src.utm ? JSON.parse(src.utm) : null,
        routing: src.rules ? JSON.parse(src.rules) : null,
        maxClicks: src.max_clicks,
        startsAt: iso(src.starts_at),
        expiresAt: iso(src.expires_at),
      },
      p,
      { auditAction: 'link.duplicate' },
    );
    // Passwort übernehmen, ohne es zu kennen.
    // Passwort nur übernehmen, wer den Quell-Link auch bearbeiten darf.
    if (src.password_hash && this.canEdit(p, src)) this.db.prepare('UPDATE links SET password_hash = ? WHERE id = ?').run(src.password_hash, row.id);
    return this.getRow(row.id);
  }

  delete(id: number, p: Principal, opts: { confirmProtected?: boolean } = {}): void {
    const row = this.getRow(id);
    this.assertCanEdit(p, row);
    if (row.protected && !opts.confirmProtected) {
      throw new AppError(
        409,
        'protected',
        'Dieser Link ist als „verteilt“ geschützt. Wer ihn gedruckt oder verschickt hat, landet nach dem Löschen auf einer Fehlerseite. Zum Löschen bitte ausdrücklich bestätigen.',
      );
    }
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO slug_tombstones(domain_id, slug_key, slug, former_url, deleted_at, deleted_by, former_link_id, reason)
           VALUES (?,?,?,?,?,?,?, 'deleted')`,
        )
        .run(row.domain_id, row.slug_key, row.slug, row.url, now(), p.userId, null);
      this.db.prepare('DELETE FROM links_fts WHERE rowid = ?').run(id);
      this.db.prepare('DELETE FROM links WHERE id = ?').run(id);
      this.audit.log(p, 'link.delete', 'link', id, { slug: row.slug, url: row.url });
    })();
    this.emit([{ domainId: row.domain_id, slugKey: row.slug_key, id }]);
  }

  versions(id: number) {
    return (this.db
      .prepare(
        `SELECT v.id, v.created_at, v.summary, v.snapshot, u.name, u.email FROM link_versions v
         LEFT JOIN users u ON u.id = v.user_id WHERE v.link_id = ? ORDER BY v.id DESC LIMIT 100`,
      )
      .all(id) as { id: number; created_at: number; summary: string; snapshot: string; name: string | null; email: string | null }[]).map((v) => {
      const s = JSON.parse(v.snapshot) as Record<string, unknown>;
      return {
        id: v.id,
        at: iso(v.created_at),
        summary: v.summary,
        by: v.name || v.email || 'System',
        url: s.url as string,
        slug: s.slug as string,
        snapshot: s,
      };
    });
  }

  async restoreVersion(id: number, versionId: number, p: Principal) {
    const v = this.db.prepare('SELECT snapshot, created_at FROM link_versions WHERE id = ? AND link_id = ?').get(versionId, id) as
      | { snapshot: string; created_at: number }
      | undefined;
    if (!v) throw notFound('Version');
    const s = JSON.parse(v.snapshot) as Record<string, unknown>;
    const date = new Date(v.created_at * 1000).toLocaleString('de-DE', { timeZone: this.settings.get().timezone });
    return this.update(
      id,
      {
        url: s.url as string,
        title: s.title as string,
        notes: s.notes as string,
        redirectType: s.redirect_type as 301 | 302 | 307 | 308,
        startsAt: iso(s.starts_at as number | null),
        expiresAt: iso(s.expires_at as number | null),
        maxClicks: s.max_clicks as number | null,
        fallbackUrl: s.fallback_url as string | null,
        forwardQuery: Boolean(s.forward_query),
        utm: s.utm ? JSON.parse(s.utm as string) : null,
        routing: s.rules ? JSON.parse(s.rules as string) : null,
      },
      p,
      { summary: `Stand vom ${date} wiederhergestellt` },
    );
  }

  /** Massenänderungen: jede Aktion einzeln geprüft, Ergebnis je Link */
  async bulk(
    ids: number[],
    action:
      | { type: 'enable' | 'disable' | 'archive' | 'unarchive' | 'delete' | 'protect' | 'unprotect' | 'favorite' | 'unfavorite' }
      | { type: 'addTags' | 'removeTags'; tags: string[] }
      | { type: 'setCollection'; collectionId: number | null }
      | { type: 'setCampaign'; campaignId: number | null }
      | { type: 'setDomain'; domainId: number }
      | { type: 'setExpiry'; expiresAt: string | null },
    p: Principal,
    confirmProtected = false,
  ) {
    const results: { id: number; ok: boolean; error?: string }[] = [];
    for (const [i, id] of ids.entries()) {
      // Lange Massenaktionen geben regelmäßig frei, damit Weiterleitungen nicht warten.
      if (i > 0 && i % 50 === 0) await new Promise((r) => setImmediate(r));
      try {
        switch (action.type) {
          case 'enable':
          case 'disable':
            await this.update(id, { enabled: action.type === 'enable' }, p);
            break;
          case 'archive':
          case 'unarchive':
            await this.update(id, { archived: action.type === 'archive' }, p);
            break;
          case 'protect':
          case 'unprotect':
            await this.update(id, { protected: action.type === 'protect' }, p);
            break;
          case 'favorite':
          case 'unfavorite':
            this.getRow(id);
            this.setFavorite(id, p.userId, action.type === 'favorite');
            break;
          case 'delete':
            this.delete(id, p, { confirmProtected });
            break;
          case 'addTags':
          case 'removeTags': {
            const current = (this.db.prepare('SELECT t.name FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = ?').all(id) as {
              name: string;
            }[]).map((t) => t.name);
            const lower = new Set(action.tags.map((t) => t.toLowerCase()));
            const next =
              action.type === 'addTags' ? [...current, ...action.tags] : current.filter((t) => !lower.has(t.toLowerCase()));
            await this.update(id, { tags: next }, p);
            break;
          }
          case 'setCollection':
            await this.update(id, { collectionId: action.collectionId }, p);
            break;
          case 'setCampaign':
            await this.update(id, { campaignId: action.campaignId }, p);
            break;
          case 'setDomain':
            await this.update(id, { domainId: action.domainId }, p, { confirmProtected });
            break;
          case 'setExpiry':
            await this.update(id, { expiresAt: action.expiresAt }, p);
            break;
        }
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: (e as Error).message });
      }
    }
    return results;
  }

  // ---------------------------------------------------------------- Ergebnisse von Hintergrundaufgaben

  saveMeta(id: number, meta: { title: string; description: string; imageId: number | null; iconId: number | null }): void {
    this.db
      .prepare('UPDATE links SET meta_title = ?, meta_description = ?, meta_image_id = ?, icon_image_id = ?, meta_fetched_at = ? WHERE id = ?')
      .run(meta.title || null, meta.description || null, meta.imageId, meta.iconId, now(), id);
    // Ohne eigenen Titel: Seitentitel übernehmen.
    this.db.prepare("UPDATE links SET title = ? WHERE id = ? AND title = ''").run(meta.title.slice(0, 300), id);
    this.syncFts(id);
    const row = this.db.prepare('SELECT domain_id, slug_key FROM links WHERE id = ?').get(id) as { domain_id: number; slug_key: string } | undefined;
    if (row) this.emit([{ domainId: row.domain_id, slugKey: row.slug_key, id }]);
  }

  saveHealth(id: number, h: { status: 'ok' | 'broken' | 'warning' | 'skipped'; code: number | null; detail: string }): void {
    this.db
      .prepare('UPDATE links SET health_status = ?, health_code = ?, health_detail = ?, health_checked_at = ? WHERE id = ?')
      .run(h.status, h.code, h.detail.slice(0, 500), now(), id);
  }
}

function cleanUtm(utm: Utm | null | undefined): string | null {
  if (!utm) return null;
  const out: Utm = {};
  for (const k of UTM_KEYS) {
    const v = utm[k]?.trim();
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/**
 * Tatsächlich gesendeter Statuscode. Permanente Weiterleitungen (301/308) werden
 * zu temporären (302/307), sobald das Ziel vom Zeitpunkt, von Regeln, einem Limit
 * oder einem Passwort abhängt – sonst würden Browser ein veraltetes Ziel cachen.
 */
export function effectiveStatus(
  l: Pick<LinkRow, 'redirect_type' | 'starts_at' | 'expires_at' | 'max_clicks' | 'password_hash'>,
  routing: Routing | null,
): 301 | 302 | 307 | 308 {
  const permanent = l.redirect_type === 301 || l.redirect_type === 308;
  if (!permanent) return l.redirect_type;
  const dynamic = isDynamic(routing) || l.expires_at !== null || l.max_clicks !== null || l.password_hash !== null || l.starts_at !== null;
  if (!dynamic) return l.redirect_type;
  return l.redirect_type === 308 ? 307 : 302;
}
