import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { conflict, notFound } from '../../lib/errors.js';
import { fromIso, iso, now } from '../../lib/time.js';
import { ValidationError } from '../../lib/validate.js';
import { idParam, need, parse } from '../http.js';

export const COLORS = ['slate', 'crimson', 'amber', 'moss', 'teal', 'indigo', 'plum', 'rust'] as const;
const color = z.enum(COLORS);

/** Schlagwörter, Sammlungen, Kampagnen und Vorlagen */
export async function registerOrgRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const uniqueGuard = (fn: () => void, what: string) => {
    try {
      fn();
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) throw conflict(`${what} mit diesem Namen gibt es schon.`, 'name');
      throw e;
    }
  };
  const afterOrgChange = () => ctx.resolver.clear();
  /** Suchindex der Links eines Schlagworts nachziehen (Namen stehen im Index) */
  const reindexTag = (linkIds: number[]) => {
    for (const id of linkIds) ctx.links.syncFts(id);
  };
  const linksOfTag = (tagId: number) =>
    (db.prepare('SELECT link_id FROM link_tags WHERE tag_id = ?').all(tagId) as { link_id: number }[]).map((r) => r.link_id);

  // ----------------------------------------------------------- Schlagwörter
  app.get('/api/v1/tags', async (req) => {
    need(req);
    return {
      items: db
        .prepare(
          `SELECT t.id, t.name, t.color, COUNT(l.id) count FROM tags t LEFT JOIN link_tags lt ON lt.tag_id = t.id
           LEFT JOIN links l ON l.id = lt.link_id AND l.archived_at IS NULL GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
        )
        .all(),
    };
  });

  app.post('/api/v1/tags', async (req, reply) => {
    const p = need(req, 'member', 'write');
    const body = parse(z.object({ name: z.string().trim().min(1).max(40), color: color.optional() }), req.body);
    let id = 0;
    uniqueGuard(() => {
      id = Number(db.prepare('INSERT INTO tags(name, color) VALUES (?, ?)').run(body.name, body.color ?? 'slate').lastInsertRowid);
    }, 'Ein Schlagwort');
    ctx.audit.log(p, 'tag.create', 'tag', id, { name: body.name });
    reply.code(201);
    return db.prepare('SELECT id, name, color FROM tags WHERE id = ?').get(id);
  });

  app.patch('/api/v1/tags/:id', async (req) => {
    const p = need(req, 'editor', 'write');
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), color: color.optional() }), req.body);
    if (!db.prepare('SELECT 1 FROM tags WHERE id = ?').get(id)) throw notFound('Schlagwort');
    uniqueGuard(
      () =>
        db.transaction(() => {
          if (body.name) {
            db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(body.name, id);
            reindexTag(linksOfTag(id));
          }
          if (body.color) db.prepare('UPDATE tags SET color = ? WHERE id = ?').run(body.color, id);
        })(),
      'Ein Schlagwort',
    );
    ctx.audit.log(p, 'tag.update', 'tag', id, body);
    return db.prepare('SELECT id, name, color FROM tags WHERE id = ?').get(id);
  });

  app.delete('/api/v1/tags/:id', async (req) => {
    const p = need(req, 'editor', 'write');
    const { id } = parse(idParam, req.params);
    db.transaction(() => {
      const affected = linksOfTag(id);
      db.prepare('DELETE FROM tags WHERE id = ?').run(id);
      reindexTag(affected);
    })();
    ctx.audit.log(p, 'tag.delete', 'tag', id);
    return { ok: true };
  });

  // ----------------------------------------------------------- Sammlungen
  const collectionBody = z.object({
    name: z.string().trim().min(1).max(60),
    color: color.optional(),
    description: z.string().max(500).optional(),
  });

  app.get('/api/v1/collections', async (req) => {
    need(req);
    return {
      items: db
        .prepare(
          `SELECT c.id, c.name, c.color, c.description, COUNT(l.id) count FROM collections c
           LEFT JOIN links l ON l.collection_id = c.id AND l.archived_at IS NULL GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,
        )
        .all(),
    };
  });

  app.post('/api/v1/collections', async (req, reply) => {
    const p = need(req, 'editor', 'write');
    const body = parse(collectionBody, req.body);
    let id = 0;
    uniqueGuard(() => {
      id = Number(
        db.prepare('INSERT INTO collections(name, color, description, created_at) VALUES (?,?,?,?)').run(body.name, body.color ?? 'slate', body.description ?? '', now())
          .lastInsertRowid,
      );
    }, 'Eine Sammlung');
    ctx.audit.log(p, 'collection.create', 'collection', id, { name: body.name });
    reply.code(201);
    return db.prepare('SELECT id, name, color, description FROM collections WHERE id = ?').get(id);
  });

  app.patch('/api/v1/collections/:id', async (req) => {
    const p = need(req, 'editor', 'write');
    const { id } = parse(idParam, req.params);
    const body = parse(collectionBody.partial(), req.body);
    if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id)) throw notFound('Sammlung');
    uniqueGuard(() => {
      for (const [k, v] of Object.entries(body)) if (v !== undefined) db.prepare(`UPDATE collections SET ${k} = ? WHERE id = ?`).run(v, id);
    }, 'Eine Sammlung');
    ctx.audit.log(p, 'collection.update', 'collection', id, body);
    return db.prepare('SELECT id, name, color, description FROM collections WHERE id = ?').get(id);
  });

  app.delete('/api/v1/collections/:id', async (req) => {
    const p = need(req, 'editor', 'write');
    const { id } = parse(idParam, req.params);
    db.prepare('DELETE FROM collections WHERE id = ?').run(id);
    ctx.audit.log(p, 'collection.delete', 'collection', id);
    return { ok: true };
  });

  // ----------------------------------------------------------- Kampagnen
  const utmField = z.string().trim().max(200).optional();
  const campaignBody = z.object({
    name: z.string().trim().min(1).max(80),
    color: color.optional(),
    utm_source: utmField,
    utm_medium: utmField,
    utm_campaign: utmField,
    utm_term: utmField,
    utm_content: utmField,
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    description: z.string().max(1000).optional(),
    archived: z.boolean().optional(),
  });
  const assertCampaignPeriod = (startsAt: number | null, endsAt: number | null) => {
    if (startsAt !== null && endsAt !== null && endsAt < startsAt) throw new ValidationError('Das Ende der Kampagne muss nach ihrem Beginn liegen.', 'endsAt');
  };
  type CampaignRow = Record<string, unknown> & { id: number; starts_at: number | null; ends_at: number | null; archived: number; created_at: number };
  const serializeCampaign = (c: CampaignRow) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    utm: { utm_source: c.utm_source, utm_medium: c.utm_medium, utm_campaign: c.utm_campaign, utm_term: c.utm_term, utm_content: c.utm_content },
    startsAt: iso(c.starts_at),
    endsAt: iso(c.ends_at),
    description: c.description,
    archived: Boolean(c.archived),
    createdAt: iso(c.created_at),
    links: c.links ?? 0,
    clicks: c.clicks ?? 0,
  });

  app.get('/api/v1/campaigns', async (req) => {
    need(req);
    const rows = db
      .prepare(
        `SELECT c.*, COUNT(l.id) links, COALESCE(SUM(l.click_count), 0) clicks FROM campaigns c
         LEFT JOIN links l ON l.campaign_id = c.id GROUP BY c.id ORDER BY c.archived, c.created_at DESC`,
      )
      .all() as CampaignRow[];
    return { items: rows.map(serializeCampaign) };
  });

  app.post('/api/v1/campaigns', async (req, reply) => {
    const p = need(req, 'editor', 'write');
    const b = parse(campaignBody, req.body);
    assertCampaignPeriod(fromIso(b.startsAt) ?? null, fromIso(b.endsAt) ?? null);
    let id = 0;
    uniqueGuard(() => {
      id = Number(
        db
          .prepare(
            `INSERT INTO campaigns(name, color, utm_source, utm_medium, utm_campaign, utm_term, utm_content, starts_at, ends_at, description, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            b.name,
            b.color ?? 'crimson',
            b.utm_source ?? '',
            b.utm_medium ?? '',
            b.utm_campaign ?? '',
            b.utm_term ?? '',
            b.utm_content ?? '',
            fromIso(b.startsAt),
            fromIso(b.endsAt),
            b.description ?? '',
            now(),
          ).lastInsertRowid,
      );
    }, 'Eine Kampagne');
    ctx.audit.log(p, 'campaign.create', 'campaign', id, { name: b.name });
    reply.code(201);
    return serializeCampaign(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow);
  });

  app.patch('/api/v1/campaigns/:id', async (req) => {
    const p = need(req, 'editor', 'write');
    const { id } = parse(idParam, req.params);
    const b = parse(campaignBody.partial(), req.body);
    const current = db.prepare('SELECT starts_at, ends_at FROM campaigns WHERE id = ?').get(id) as { starts_at: number | null; ends_at: number | null } | undefined;
    if (!current) throw notFound('Kampagne');
    assertCampaignPeriod(
      b.startsAt !== undefined ? (fromIso(b.startsAt) ?? null) : current.starts_at,
      b.endsAt !== undefined ? (fromIso(b.endsAt) ?? null) : current.ends_at,
    );
    const cols: Record<string, unknown> = {};
    for (const k of ['name', 'color', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'description'] as const) {
      if (b[k] !== undefined) cols[k] = b[k];
    }
    if (b.startsAt !== undefined) cols.starts_at = fromIso(b.startsAt);
    if (b.endsAt !== undefined) cols.ends_at = fromIso(b.endsAt);
    if (b.archived !== undefined) cols.archived = b.archived ? 1 : 0;
    uniqueGuard(() => {
      const keys = Object.keys(cols);
      if (keys.length) db.prepare(`UPDATE campaigns SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => cols[k]), id);
    }, 'Eine Kampagne');
    afterOrgChange();
    ctx.audit.log(p, 'campaign.update', 'campaign', id, b);
    return serializeCampaign(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow);
  });

  app.delete('/api/v1/campaigns/:id', async (req) => {
    const p = need(req, 'editor', 'write');
    const { id } = parse(idParam, req.params);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    afterOrgChange();
    ctx.audit.log(p, 'campaign.delete', 'campaign', id);
    return { ok: true };
  });

  // ----------------------------------------------------------- Vorlagen
  const presetSettings = z
    .object({
      domainId: z.number().int().positive().optional(),
      redirectType: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).optional(),
      tags: z.array(z.string().max(40)).max(30).optional(),
      collectionId: z.number().int().positive().nullable().optional(),
      campaignId: z.number().int().positive().nullable().optional(),
      expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
      forwardQuery: z.boolean().optional(),
      protected: z.boolean().optional(),
      slugStyle: z.enum(['random', 'readable']).optional(),
    })
    .strict();

  app.get('/api/v1/presets', async (req) => {
    need(req);
    return {
      items: (db.prepare('SELECT id, name, settings FROM presets ORDER BY name COLLATE NOCASE').all() as { id: number; name: string; settings: string }[]).map(
        (r) => ({ id: r.id, name: r.name, settings: JSON.parse(r.settings) }),
      ),
    };
  });

  app.post('/api/v1/presets', async (req, reply) => {
    const p = need(req, 'member', 'write');
    const b = parse(z.object({ name: z.string().trim().min(1).max(60), settings: presetSettings }), req.body);
    let id = 0;
    uniqueGuard(() => {
      id = Number(
        db.prepare('INSERT INTO presets(name, settings, created_by, created_at) VALUES (?,?,?,?)').run(b.name, JSON.stringify(b.settings), p.userId, now())
          .lastInsertRowid,
      );
    }, 'Eine Vorlage');
    reply.code(201);
    return { id, name: b.name, settings: b.settings };
  });

  app.delete('/api/v1/presets/:id', async (req) => {
    const p = need(req, 'member', 'write');
    const { id } = parse(idParam, req.params);
    const row = db.prepare('SELECT created_by FROM presets WHERE id = ?').get(id) as { created_by: number | null } | undefined;
    if (!row) throw notFound('Vorlage');
    if (row.created_by !== p.userId && p.role !== 'admin' && p.role !== 'editor') throw conflict('Nur die Person, die die Vorlage angelegt hat, oder die Redaktion kann sie löschen.');
    db.prepare('DELETE FROM presets WHERE id = ?').run(id);
    return { ok: true };
  });
}
