import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { AppError, notFound } from '../../lib/errors.js';
import { safeFetch } from '../../lib/safefetch.js';
import { decodeHtml, extractMeta } from '../../lib/meta.js';
import { normalizeUrlInput, validateSlug, ValidationError } from '../../lib/validate.js';
import { domainBase } from '../../services/domains.js';
import { linkInputSchema, linkPatchSchema, type ListQuery } from '../../services/links.js';
import type { StatsRange } from '../../services/stats.js';
import { idParam, intQuery, need, parse } from '../http.js';

export const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  state: z.enum(['active', 'disabled', 'scheduled', 'expired', 'archived', 'live', 'all']).optional(),
  domainId: z.string().optional(),
  tag: z.string().max(40).optional(),
  collectionId: z.string().optional(),
  campaignId: z.string().optional(),
  owner: z.string().optional(),
  favorite: z.enum(['1', 'true']).optional(),
  health: z.enum(['broken', 'ok', 'unchecked']).optional(),
  protected: z.enum(['1', '0']).optional(),
  sort: z.enum(['created', 'updated', 'clicks', 'slug', 'last_click', 'expires']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function toListQuery(raw: z.infer<typeof listQuerySchema>, userId: number): ListQuery {
  return {
    q: raw.q,
    state: raw.state,
    domainId: intQuery(raw.domainId),
    tag: raw.tag,
    collectionId: raw.collectionId === 'none' ? 'none' : intQuery(raw.collectionId),
    campaignId: raw.campaignId === 'none' ? 'none' : intQuery(raw.campaignId),
    owner: raw.owner === 'me' ? userId : intQuery(raw.owner),
    favoriteOf: raw.favorite ? userId : undefined,
    health: raw.health,
    protected: raw.protected === undefined ? undefined : raw.protected === '1',
    sort: raw.sort,
    dir: raw.dir,
    limit: raw.limit,
    offset: raw.offset,
  };
}

export function parseRange(q: Record<string, unknown>): StatsRange {
  if (typeof q.from === 'string' && typeof q.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.from) && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) {
    for (const d of [q.from, q.to]) {
      // 2026-02-30 o. Ä. würde sonst stillschweigend in den Folgemonat rutschen.
      const parsed = new Date(`${d}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d || parsed.getUTCFullYear() < 2000) {
        throw new AppError(400, 'invalid', `Ungültiges Datum: ${d}.`);
      }
    }
    if (q.from > q.to) throw new AppError(400, 'invalid', 'Der Beginn muss vor dem Ende liegen.');
    const days = (Date.parse(q.to) - Date.parse(q.from)) / 86400_000;
    if (days > 731) throw new AppError(400, 'invalid', 'Der Zeitraum darf höchstens zwei Jahre umfassen.');
    return { from: q.from, to: q.to };
  }
  const preset = typeof q.range === 'string' ? q.range : '30d';
  if (!['24h', '7d', '30d', '90d', '365d'].includes(preset)) throw new AppError(400, 'invalid', 'Zeitraum: 24h, 7d, 30d, 90d, 365d oder from/to.');
  return { preset: preset as '24h' };
}

const qrQuery = z.object({
  format: z.enum(['svg', 'png']).default('svg'),
  size: z.coerce.number().int().min(64).max(4096).default(1024),
  margin: z.coerce.number().int().min(0).max(16).default(4),
  ec: z.enum(['L', 'M', 'Q', 'H']).default('M'),
  dark: z
    .string()
    .regex(/^[0-9a-fA-F]{6}$/)
    .default('18202b'),
  light: z
    .string()
    .regex(/^([0-9a-fA-F]{6}|transparent)$/)
    .default('ffffff'),
  track: z.enum(['0', '1']).default('1'),
  download: z.enum(['0', '1']).default('0'),
});

export async function registerLinkRoutes(app: FastifyInstance, ctx: Ctx) {
  const { links } = ctx;

  app.get('/api/v1/links', async (req) => {
    const p = need(req);
    const q = parse(listQuerySchema, req.query);
    return links.list(toListQuery(q, p.userId), p);
  });

  app.get('/api/v1/links/counts', async (req) => {
    const p = need(req);
    return links.counts(p.userId);
  });

  app.post('/api/v1/links', async (req, reply) => {
    const p = need(req, 'member', 'write');
    const body = parse(linkInputSchema, req.body);
    const row = await links.create(body, p);
    ctx.jobs.queueMeta(row.id);
    reply.code(201);
    return links.serialize(row, p);
  });

  // Mehrere Adressen auf einmal (z. B. aus der Zwischenablage)
  app.post('/api/v1/links/batch', async (req, reply) => {
    const p = need(req, 'member', 'write');
    const body = parse(
      z.object({
        urls: z.array(z.string().max(8192)).min(1).max(500),
        defaults: linkInputSchema.omit({ url: true, slug: true }).partial().optional(),
      }),
      req.body,
    );
    const created: unknown[] = [];
    const errors: { index: number; url: string; message: string }[] = [];
    for (const [index, url] of body.urls.entries()) {
      if (index > 0 && index % 50 === 0) await new Promise((r) => setImmediate(r));
      try {
        const row = await links.create({ ...(body.defaults ?? {}), url }, p);
        ctx.jobs.queueMeta(row.id);
        created.push(links.serialize(row, p));
      } catch (e) {
        errors.push({ index, url, message: (e as Error).message });
      }
    }
    reply.code(created.length ? 201 : 400);
    return { created, errors };
  });

  app.get('/api/v1/links/:id', async (req) => {
    const p = need(req);
    const { id } = parse(idParam, req.params);
    return links.serialize(links.getRow(id), p);
  });

  app.patch('/api/v1/links/:id', async (req) => {
    const p = need(req, 'member', 'write');
    const { id } = parse(idParam, req.params);
    const body = parse(linkPatchSchema.extend({ confirmProtected: z.boolean().optional() }), req.body);
    const { confirmProtected, ...patch } = body;
    const before = links.getRow(id);
    const row = await links.update(id, patch, p, { confirmProtected });
    if (patch.url && patch.url !== before.url) ctx.jobs.queueMeta(id);
    return links.serialize(row, p);
  });

  app.delete('/api/v1/links/:id', async (req) => {
    const p = need(req, 'member', 'write');
    const { id } = parse(idParam, req.params);
    const q = req.query as { confirm?: string };
    links.delete(id, p, { confirmProtected: q.confirm === 'protected' });
    return { ok: true };
  });

  app.post('/api/v1/links/:id/duplicate', async (req, reply) => {
    const p = need(req, 'member', 'write');
    const { id } = parse(idParam, req.params);
    const row = await links.duplicate(id, p);
    ctx.jobs.queueMeta(row.id);
    reply.code(201);
    return links.serialize(row, p);
  });

  app.post('/api/v1/links/:id/favorite', async (req) => {
    const p = need(req, 'viewer', 'write');
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ favorite: z.boolean() }), req.body);
    links.getRow(id);
    links.setFavorite(id, p.userId, body.favorite);
    return { ok: true, favorite: body.favorite };
  });

  app.post('/api/v1/links/:id/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const p = need(req, 'member', 'write');
    const { id } = parse(idParam, req.params);
    links.assertCanEdit(p, links.getRow(id));
    await ctx.jobs.fetchMeta(id);
    return links.serialize(links.getRow(id), p);
  });

  app.get('/api/v1/links/:id/versions', async (req) => {
    need(req);
    const { id } = parse(idParam, req.params);
    links.getRow(id);
    return { items: links.versions(id) };
  });

  app.post('/api/v1/links/:id/versions/:versionId/restore', async (req) => {
    const p = need(req, 'member', 'write');
    const { id } = parse(idParam, req.params);
    const versionId = Number((req.params as { versionId: string }).versionId);
    const row = await links.restoreVersion(id, versionId, p);
    return links.serialize(row, p);
  });

  app.get('/api/v1/links/:id/stats', async (req) => {
    need(req);
    const { id } = parse(idParam, req.params);
    links.getRow(id);
    return ctx.stats.report({ linkId: id }, parseRange(req.query as Record<string, unknown>));
  });

  app.delete('/api/v1/links/:id/stats', async (req) => {
    const p = need(req, 'member', 'write');
    const { id } = parse(idParam, req.params);
    links.assertCanEdit(p, links.getRow(id));
    ctx.stats.clearLink(id);
    ctx.audit.log(p, 'stats.clear', 'link', id);
    return { ok: true };
  });

  app.post('/api/v1/links/bulk', async (req) => {
    const p = need(req, 'member', 'write');
    const body = parse(
      z.object({
        ids: z.array(z.number().int().positive()).min(1).max(5000),
        action: z.discriminatedUnion('type', [
          z.object({ type: z.enum(['enable', 'disable', 'archive', 'unarchive', 'delete', 'protect', 'unprotect', 'favorite', 'unfavorite']) }),
          z.object({ type: z.enum(['addTags', 'removeTags']), tags: z.array(z.string().min(1).max(40)).min(1).max(30) }),
          z.object({ type: z.literal('setCollection'), collectionId: z.number().int().positive().nullable() }),
          z.object({ type: z.literal('setCampaign'), campaignId: z.number().int().positive().nullable() }),
          z.object({ type: z.literal('setDomain'), domainId: z.number().int().positive() }),
          z.object({ type: z.literal('setExpiry'), expiresAt: z.string().datetime({ offset: true }).nullable() }),
        ]),
        confirmProtected: z.boolean().optional(),
      }),
      req.body,
    );
    const results = await links.bulk(body.ids, body.action, p, body.confirmProtected);
    return { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok), total: results.length };
  });

  // ------------------------------------------------------------ Hilfen für den Editor

  app.get('/api/v1/slug/check', async (req) => {
    need(req);
    const q = req.query as { domainId?: string; slug?: string; exceptId?: string };
    const domainId = intQuery(q.domainId) ?? ctx.domains.default()?.id;
    if (!domainId) throw new AppError(400, 'no_domain', 'Keine Domain eingerichtet.');
    try {
      const slug = validateSlug(q.slug ?? '');
      return { slug, ...links.slugAvailable(domainId, slug, intQuery(q.exceptId)) };
    } catch (e) {
      if (e instanceof ValidationError) return { slug: q.slug ?? '', available: false, reason: e.message };
      throw e;
    }
  });

  app.get('/api/v1/slug/suggest', async (req) => {
    need(req);
    const q = req.query as { domainId?: string; url?: string; style?: string; title?: string };
    const style = q.style === 'readable' ? 'readable' : q.style === 'random' ? 'random' : undefined;
    return { slug: links.suggestSlug(intQuery(q.domainId), normalizeUrlInput(q.url ?? ''), style, q.title || undefined) };
  });

  // Gibt es für dieses Ziel schon Links? (Doppelte vermeiden)
  app.get('/api/v1/lookup', async (req) => {
    const p = need(req);
    const url = String((req.query as { url?: string }).url ?? '');
    if (!url) return { items: [] };
    let normalized: string;
    try {
      normalized = new URL(normalizeUrlInput(url)).toString();
    } catch {
      return { items: [] };
    }
    const rows = ctx.db
      .prepare('SELECT * FROM links WHERE url = ? OR url = ? ORDER BY created_at DESC LIMIT 5')
      .all(normalized, normalized.replace(/\/$/, '')) as Parameters<typeof links.serializeMany>[0];
    return { items: links.serializeMany(rows, p) };
  });

  // Titel einer Adresse vorab lesen (für den Editor)
  app.post('/api/v1/preview', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    need(req, 'member', 'write');
    const body = parse(z.object({ url: z.string().max(8192) }), req.body);
    const url = normalizeUrlInput(body.url);
    try {
      const res = await safeFetch(url, ctx.jobs.policy(), { maxBytes: 512 * 1024 });
      const ct = res.headers['content-type'] ?? '';
      const meta = /html/i.test(ct) ? extractMeta(decodeHtml(res.body, ct), res.finalUrl) : null;
      return { reachable: res.status < 400, status: res.status, finalUrl: res.finalUrl, title: meta?.title ?? '', description: meta?.description ?? '', siteName: meta?.siteName ?? '' };
    } catch (e) {
      return { reachable: false, status: null, finalUrl: url, title: '', description: '', error: (e as Error).message };
    }
  });

  // ------------------------------------------------------------ QR-Code

  app.get('/api/v1/links/:id/qr', async (req, reply) => {
    need(req);
    const { id } = parse(idParam, req.params);
    const q = parse(qrQuery, req.query);
    const row = links.getRow(id);
    const d = ctx.domains.get(row.domain_id);
    // „?qr“ markiert Aufrufe über den Code, damit die Statistik QR-Scans getrennt zeigt.
    const content = `${domainBase(d)}/${row.slug}${q.track === '1' ? '?qr' : ''}`;
    const opts = {
      errorCorrectionLevel: q.ec,
      margin: q.margin,
      color: { dark: `#${q.dark}ff`, light: q.light === 'transparent' ? '#00000000' : `#${q.light}ff` },
    };
    const filename = `qr-${d.host.replace(/[^a-z0-9.-]/gi, '_')}-${row.slug.replace(/[^a-z0-9-]/gi, '_')}.${q.format}`;
    if (q.download === '1') reply.header('content-disposition', `attachment; filename="${filename}"`);
    reply.header('cache-control', 'private, max-age=60');
    if (q.format === 'svg') {
      reply.type('image/svg+xml');
      return QRCode.toString(content, { ...opts, type: 'svg' });
    }
    reply.type('image/png');
    return QRCode.toBuffer(content, { ...opts, type: 'png', width: q.size });
  });

  // Optional: Code in Tessera anlegen und dort gestalten
  app.post('/api/v1/links/:id/tessera', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const p = need(req, 'member', 'write');
    const { id } = parse(idParam, req.params);
    const { url: tUrl, token } = ctx.config.tessera;
    if (!tUrl || !token) throw new AppError(400, 'tessera_off', 'Tessera ist nicht verbunden (TESSERA_URL und TESSERA_TOKEN).');
    const row = links.getRow(id);
    const d = ctx.domains.get(row.domain_id);
    const shortUrl = `${domainBase(d)}/${row.slug}?qr`;
    let res: Response;
    try {
      res = await fetch(`${tUrl}/api/codes`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ name: row.title || `${d.host}/${row.slug}`, type: "url", content: { url: shortUrl }, tags: ["Filum"], note: `Erstellt aus Filum für ${d.host}/${row.slug}` }),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      throw new AppError(502, 'tessera_unreachable', `Tessera ist nicht erreichbar (${(e as Error).message}).`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AppError(502, 'tessera_error', `Tessera hat den Code nicht angelegt (HTTP ${res.status}). ${text.slice(0, 200)}`);
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string | number; code?: { id?: string | number } };
    const codeId = data.id ?? data.code?.id;
    ctx.audit.log(p, 'link.tessera', 'link', id, { codeId });
    return { ok: true, codeId, editorUrl: codeId ? `${tUrl}/codes/${codeId}` : tUrl };
  });

  // Vorschaubilder (nur angemeldet; Inhalte sind vorab auf Bildformat geprüft)
  app.get('/api/v1/images/:id', async (req, reply) => {
    need(req);
    const { id } = parse(idParam, req.params);
    const img = ctx.db.prepare('SELECT mime, data FROM images WHERE id = ?').get(id) as { mime: string; data: Buffer } | undefined;
    if (!img) throw notFound('Bild');
    reply
      .type(img.mime)
      .header('cache-control', 'private, max-age=86400')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('content-disposition', 'inline');
    return img.data;
  });
}
