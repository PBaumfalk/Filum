import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { intQuery, need, parse } from '../http.js';
import { parseRange } from './links.js';
import { distance } from '../../lib/distance.js';

export async function registerStatsRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/v1/stats', async (req) => {
    need(req);
    const q = req.query as Record<string, string | undefined>;
    return ctx.stats.report(
      {
        campaignId: intQuery(q.campaignId),
        collectionId: intQuery(q.collectionId),
        domainId: intQuery(q.domainId),
        tag: q.tag || undefined,
      },
      parseRange(q),
    );
  });

  app.get('/api/v1/stats/outcomes', async (req) => {
    need(req);
    const q = req.query as Record<string, string | undefined>;
    const res = ctx.stats.outcomesReport(parseRange(q), intQuery(q.domainId));
    // Vertipper-Radar: ähnliche vorhandene Kurzadresse vorschlagen. Nur Kandidaten mit gleichem
    // Anfangszeichen (Indexbereich) und höchstens 2000 je Adresse, damit große Bestände nicht blockieren.
    const candidateStmt = ctx.db.prepare(
      'SELECT id, slug FROM links WHERE domain_id = ? AND slug_key >= ? AND slug_key < ? AND length(slug_key) BETWEEN ? AND ? LIMIT 2000',
    );
    for (const u of res.unknown) {
      const first = u.slug.toLowerCase().slice(0, 1);
      const candidates = candidateStmt.all(
        u.domainId,
        first,
        String.fromCodePoint(first.codePointAt(0)! + 1),
        Math.max(1, u.slug.length - 2),
        u.slug.length + 2,
      ) as { id: number; slug: string }[];
      let best: { id: number; slug: string; d: number } | null = null;
      for (const c of candidates) {
        const d = distance(u.slug.toLowerCase(), c.slug.toLowerCase());
        if (d <= 2 && (!best || d < best.d)) best = { ...c, d };
      }
      u.suggestion = best ? { id: best.id, slug: best.slug } : null;
    }
    return res;
  });

  app.get('/api/v1/stats/campaigns', async (req) => {
    need(req);
    return { items: ctx.stats.campaigns(parseRange(req.query as Record<string, unknown>)) };
  });

  app.delete('/api/v1/stats', async (req) => {
    const p = need(req, 'admin', 'admin');
    // Ausdrücklich verlangt: Ein fehlender Parameter darf nie die gesamte Statistik löschen.
    const { scope } = parse(z.object({ scope: z.enum(['all', 'details']) }), req.query);
    if (scope === 'details') ctx.stats.clearDetails();
    else ctx.stats.clearAll();
    ctx.audit.log(p, scope === 'details' ? 'stats.clear_details' : 'stats.clear_all');
    return { ok: true };
  });
}

export { distance } from '../../lib/distance.js';
