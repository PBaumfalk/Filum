import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import Papa from 'papaparse';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { AppError } from '../../lib/errors.js';
import { slugKey, validateDestination, validateSlug } from '../../lib/validate.js';
import type { Principal } from '../../services/links.js';
import { zonedMidnight } from '../../services/stats.js';
import { need, parse } from '../http.js';
import { listQuerySchema, toListQuery } from './links.js';

/** Schützt vor Formel-Injektion, wenn eine CSV-Datei in Excel/LibreOffice geöffnet wird. */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  url: ['url', 'long_url', 'longurl', 'target', 'destination', 'ziel', 'zieladresse', 'original_url', 'originalurl', 'link'],
  slug: ['slug', 'keyword', 'shortcode', 'short_code', 'alias', 'kurzadresse', 'code', 'back_half', 'path'],
  shortUrl: ['short_url', 'shorturl', 'kurzlink', 'short_link', 'shortlink'],
  title: ['title', 'titel', 'name', 'bezeichnung'],
  notes: ['notes', 'note', 'notiz', 'notizen', 'description', 'beschreibung'],
  tags: ['tags', 'tag', 'schlagwoerter', 'schlagwörter', 'labels'],
  expiresAt: ['expires_at', 'expiresat', 'ablauf', 'ablaufdatum', 'valid_until', 'validuntil'],
  startsAt: ['starts_at', 'startsat', 'start', 'valid_since', 'validsince'],
  redirectType: ['redirect_type', 'redirecttype', 'status', 'weiterleitung'],
  fallbackUrl: ['fallback_url', 'fallbackurl', 'ersatzziel'],
  maxClicks: ['max_clicks', 'maxclicks', 'max_visits', 'maxvisits', 'aufruflimit'],
};

function mapHeaders(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const norm = h.trim().toLowerCase().replace(/[\s-]+/g, '_');
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (!map[field] && aliases.includes(norm)) map[field] = h;
    }
  }
  return map;
}

export interface ImportRow {
  line: number;
  url: string;
  slug?: string;
  title?: string;
  notes?: string;
  tags?: string[];
  expiresAt?: string | null;
  startsAt?: string | null;
  redirectType?: 301 | 302 | 307 | 308;
  fallbackUrl?: string | null;
  maxClicks?: number | null;
}

function toDate(v: string | undefined, tz: string): string | null | undefined {
  if (!v?.trim()) return undefined;
  const s = v.trim();
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
  let t: number;
  if (de) {
    // Deutsche Angaben gelten in der eingestellten Zeitzone, nicht in der des Servers.
    const [day, month, year, hour, minute] = [de[1], de[2], de[3], de[4] ?? '23', de[5] ?? '59'].map(Number);
    const isoDay = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (new Date(`${isoDay}T00:00:00Z`).toISOString().slice(0, 10) !== isoDay || hour > 23 || minute > 59) throw new Error(`Datum „${s}“ nicht erkannt`);
    t = (zonedMidnight(isoDay, tz) + hour * 3600 + minute * 60) * 1000;
  } else t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`Datum „${s}“ nicht erkannt`);
  return new Date(t).toISOString();
}

export function parseCsv(text: string, hostOfDomain: (host: string) => boolean, tz = 'Europe/Berlin'): { columns: Record<string, string>; rows: ImportRow[]; errors: { line: number; message: string }[] } {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy' });
  const headers = parsed.meta.fields ?? [];
  const columns = mapHeaders(headers);
  const rows: ImportRow[] = [];
  const errors: { line: number; message: string }[] = [];
  if (!columns.url) {
    // Ohne Kopfzeile: eine Adresse pro Zeile
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => /^(https?:\/\/|www\.)/i.test(l) || /^[^\s,;]+\.[a-z]{2,}(\/|$)/i.test(l))) {
      return { columns: { url: '(eine Adresse pro Zeile)' }, rows: lines.map((url, i) => ({ line: i + 1, url })), errors: [] };
    }
    throw new AppError(400, 'import_columns', `Keine Spalte mit Zieladressen gefunden. Erwartet wird z. B. „url“. Gefunden: ${headers.join(', ') || 'keine Spalten'}.`);
  }
  parsed.data.forEach((r, i) => {
    const line = i + 2;
    try {
      const row: ImportRow = { line, url: (r[columns.url] ?? '').trim() };
      if (!row.url) throw new Error('Zieladresse fehlt');
      let slug = columns.slug ? r[columns.slug]?.trim() : '';
      if (!slug && columns.shortUrl && r[columns.shortUrl]) {
        try {
          const u = new URL(r[columns.shortUrl].trim());
          if (hostOfDomain(u.host)) slug = u.pathname.replace(/^\/+/, '');
          else slug = u.pathname.replace(/^\/+/, '');
        } catch {
          /* ignorieren */
        }
      }
      if (slug) row.slug = slug;
      if (columns.title) row.title = r[columns.title]?.trim().slice(0, 300);
      if (columns.notes) row.notes = r[columns.notes]?.trim().slice(0, 5000);
      if (columns.tags && r[columns.tags]) {
        row.tags = r[columns.tags].split(/[;|,]/).map((t) => t.trim()).filter(Boolean).slice(0, 30);
      }
      if (columns.expiresAt) row.expiresAt = toDate(r[columns.expiresAt], tz);
      if (columns.startsAt) row.startsAt = toDate(r[columns.startsAt], tz);
      if (columns.redirectType && r[columns.redirectType]) {
        const n = Number(r[columns.redirectType]);
        if ([301, 302, 307, 308].includes(n)) row.redirectType = n as 301;
      }
      if (columns.fallbackUrl && r[columns.fallbackUrl]?.trim()) row.fallbackUrl = r[columns.fallbackUrl].trim();
      if (columns.maxClicks && r[columns.maxClicks]?.trim()) {
        const n = Number(r[columns.maxClicks]);
        if (Number.isInteger(n) && n > 0) row.maxClicks = n;
      }
      rows.push(row);
    } catch (e) {
      errors.push({ line, message: (e as Error).message });
    }
  });
  return { columns, rows, errors };
}

const importRowSchema = z.object({
  line: z.number().int(),
  url: z.string().max(8192),
  slug: z.string().max(200).optional(),
  title: z.string().max(300).optional(),
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  expiresAt: z.string().nullable().optional(),
  startsAt: z.string().nullable().optional(),
  redirectType: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).optional(),
  fallbackUrl: z.string().max(8192).nullable().optional(),
  maxClicks: z.number().int().positive().nullable().optional(),
});

export async function registerIoRoutes(app: FastifyInstance, ctx: Ctx) {
  const { links, domains } = ctx;

  app.get('/api/v1/export', async (req, reply) => {
    const p = need(req);
    const raw = req.query as Record<string, string>;
    const format = raw.format === 'json' ? 'json' : 'csv';
    const q = toListQuery(parse(listQuerySchema.omit({ limit: true, offset: true }), raw), p.userId);
    if (raw.ids) q.ids = raw.ids.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 5000);
    const stamp = new Date().toISOString().slice(0, 10);
    const header = [
      'short_url', 'domain', 'slug', 'url', 'title', 'notes', 'tags', 'collection', 'campaign', 'state', 'redirect_type',
      'protected', 'starts_at', 'expires_at', 'max_clicks', 'fallback_url', 'clicks', 'last_click_at', 'created_at', 'owner',
    ];
    const total = links.list({ ...q, state: q.state ?? 'all', limit: 1, offset: 0 }, p).total;
    ctx.audit.log(p, 'export', '', null, { format, count: total });

    // Seitenweise erzeugen und streamen: konstanter Speicherbedarf, und zwischen den Seiten
    // kommen Weiterleitungen und andere Anfragen zum Zug.
    async function* pages() {
      for (let offset = 0; offset < 200_000; offset += 500) {
        const page = links.list({ ...q, state: q.state ?? 'all', limit: 500, offset }, p);
        yield page.items;
        if (page.items.length < 500) return;
        await new Promise((r) => setImmediate(r));
      }
    }
    async function* json() {
      yield `{"exportedAt":${JSON.stringify(new Date().toISOString())},"version":${JSON.stringify(ctx.config.version)},"count":${total},"links":[`;
      let first = true;
      for await (const items of pages()) {
        const chunk = items.map(({ canEdit: _c, spark: _s, ...rest }) => JSON.stringify(rest)).join(',\n');
        if (chunk) {
          yield `${first ? '\n' : ',\n'}${chunk}`;
          first = false;
        }
      }
      yield '\n]}\n';
    }
    async function* csv() {
      yield `\uFEFF${Papa.unparse({ fields: header, data: [] }).trim()}\r\n`;
      for await (const items of pages()) {
        if (!items.length) continue;
        const rows = items.map((l) =>
          [
            l.shortUrl, l.domain.host, l.slug, l.url, l.title, l.notes, l.tags.map((t) => t.name).join(';'), l.collection?.name ?? '',
            l.campaign?.name ?? '', l.archived ? 'archived' : l.state, l.redirectType, l.protected ? 1 : 0, l.startsAt ?? '', l.expiresAt ?? '',
            l.maxClicks ?? '', l.fallbackUrl ?? '', l.clicks, l.lastClickAt ?? '', l.createdAt, l.owner?.name ?? '',
          ].map(csvCell),
        );
        yield `${Papa.unparse(rows, { header: false })}\r\n`;
      }
    }
    if (format === 'json') {
      reply.header('content-disposition', `attachment; filename="filum-links-${stamp}.json"`).type('application/json; charset=utf-8');
      return reply.send(Readable.from(json()));
    }
    reply.header('content-disposition', `attachment; filename="filum-links-${stamp}.csv"`).type('text/csv; charset=utf-8');
    return reply.send(Readable.from(csv()));
  });

  app.addContentTypeParser(['text/csv', 'text/plain'], { parseAs: 'string', bodyLimit: 10 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  // Schritt 1: Datei prüfen, nichts speichern
  app.post('/api/v1/import/preview', { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    need(req, 'member', 'write');
    const body = req.body;
    const text = typeof body === 'string' ? body : (parse(z.object({ csv: z.string().max(10 * 1024 * 1024) }), body).csv);
    const domainId = Number((req.query as { domainId?: string }).domainId) || domains.default()?.id;
    if (!domainId) throw new AppError(400, 'no_domain', 'Bitte zuerst eine Domain einrichten.');
    const { columns, rows, errors } = parseCsv(text, (h) => Boolean(domains.find(h)), ctx.settings.get().timezone);
    if (rows.length > 10_000) throw new AppError(400, 'too_many', 'Höchstens 10 000 Zeilen pro Import. Bitte die Datei aufteilen.');
    const policy = links.urlPolicy();
    const seen = new Set<string>();
    const checked = rows.map((r) => {
      const res: { line: number; url: string; slug?: string; title?: string; status: 'ok' | 'conflict' | 'invalid'; message?: string; row: ImportRow } = {
        line: r.line,
        url: r.url,
        slug: r.slug,
        title: r.title,
        status: 'ok',
        row: r,
      };
      try {
        res.url = validateDestination(r.url, policy);
        if (r.fallbackUrl) validateDestination(r.fallbackUrl, policy, 'fallbackUrl');
        if (r.slug) {
          const slug = validateSlug(r.slug);
          const key = slugKey(slug);
          if (seen.has(key)) {
            res.status = 'conflict';
            res.message = 'Kurzadresse kommt in der Datei mehrfach vor.';
          } else {
            seen.add(key);
            const avail = links.slugAvailable(domainId, slug);
            if (!avail.available) {
              res.status = 'conflict';
              res.message = avail.reason;
            }
          }
        }
      } catch (e) {
        res.status = 'invalid';
        res.message = (e as Error).message;
      }
      return res;
    });
    return {
      columns,
      total: rows.length + errors.length,
      ok: checked.filter((c) => c.status === 'ok').length,
      conflicts: checked.filter((c) => c.status === 'conflict').length,
      invalid: checked.filter((c) => c.status === 'invalid').length + errors.length,
      rows: checked,
      errors,
    };
  });

  // Schritt 2: übernehmen
  app.post('/api/v1/import', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const p = need(req, 'member', 'write');
    const body = parse(
      z.object({
        rows: z.array(importRowSchema).min(1).max(10_000),
        domainId: z.number().int().positive().optional(),
        onConflict: z.enum(['skip', 'rename', 'update']).default('skip'),
        tags: z.array(z.string().max(40)).max(10).optional(),
        collectionId: z.number().int().positive().nullable().optional(),
        campaignId: z.number().int().positive().nullable().optional(),
      }),
      req.body,
    );
    return runImport(ctx, p, body);
  });
}

export async function runImport(
  ctx: Ctx,
  p: Principal,
  body: {
    rows: ImportRow[];
    domainId?: number;
    onConflict: 'skip' | 'rename' | 'update';
    tags?: string[];
    collectionId?: number | null;
    campaignId?: number | null;
  },
) {
  const { links } = ctx;
  const result = { created: 0, updated: 0, skipped: 0, failed: [] as { line: number; message: string }[] };
  const domainId = body.domainId ?? ctx.domains.default()?.id;
  for (const [i, r] of body.rows.entries()) {
    // Große Importe geben regelmäßig frei, damit Weiterleitungen nicht warten.
    if (i > 0 && i % 50 === 0) await new Promise((res) => setImmediate(res));
    try {
      const input = {
        url: r.url,
        domainId,
        slug: r.slug,
        title: r.title,
        notes: r.notes,
        tags: [...(r.tags ?? []), ...(body.tags ?? [])],
        expiresAt: r.expiresAt ?? undefined,
        startsAt: r.startsAt ?? undefined,
        redirectType: r.redirectType,
        fallbackUrl: r.fallbackUrl ?? undefined,
        maxClicks: r.maxClicks ?? undefined,
        collectionId: body.collectionId ?? undefined,
        campaignId: body.campaignId ?? undefined,
      };
      if (r.slug && domainId) {
        const existing = links.findBySlug(domainId, r.slug);
        const avail = links.slugAvailable(domainId, r.slug);
        if (!avail.available) {
          if (body.onConflict === 'skip') {
            result.skipped++;
            continue;
          }
          if (body.onConflict === 'update' && existing) {
            const { slug: _s, domainId: _d, ...patch } = input;
            await links.update(existing.id, patch, p);
            result.updated++;
            continue;
          }
          input.slug = undefined; // umbenennen: neue Kurzadresse vergeben
        }
      }
      const row = await links.create(input, p, { skipAudit: true });
      // Seitentitel nur bei überschaubaren Importen nachladen, um fremde Server nicht zu fluten
      if (!r.title && body.rows.length <= 1000) ctx.jobs.queueMeta(row.id);
      result.created++;
    } catch (e) {
      result.failed.push({ line: r.line, message: (e as Error).message });
    }
  }
  ctx.audit.log(p, 'import', '', null, { created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed.length });
  return result;
}
