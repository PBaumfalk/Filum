import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../src/server/admin/routes/io.js';
import { RateWindow } from '../src/server/redirect/public.js';
import { BOT_UA, createTestApp, location, uniqueIp, type TestApp } from './helpers.js';

/** Tests für die Befunde aus dem Architektur-Review. */

const form = { 'content-type': 'application/x-www-form-urlencoded' };

describe('Befunde aus dem Architektur-Review', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const clicksOf = (id: number) => (t.ctx.db.prepare('SELECT click_count FROM links WHERE id = ?').get(id) as { click_count: number }).click_count;

  it('W1: parallele Passwort-Aufrufe überschreiten das Klicklimit nicht', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/einmal', slug: 'w1-einmal', password: 'Sesam-1234', maxClicks: 1 });
    const res = await Promise.all(
      Array.from({ length: 10 }, () => t.pub('/w1-einmal', { method: 'POST', headers: form, payload: 'password=Sesam-1234', remoteAddress: uniqueIp() })),
    );
    expect(res.filter((r) => r.statusCode === 303)).toHaveLength(1);
    expect(res.filter((r) => r.headers.location === 'https://ziel.example/einmal')).toHaveLength(1);
    t.ctx.stats.flush();
    expect(clicksOf(l.id)).toBe(1);
  });

  it('W2: HEAD und Bots erhalten bei Aufruflimit weder Ziel noch Zählung', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/geheim-einmal', slug: 'w2-limit', maxClicks: 1 });
    const head = await t.pub('/w2-limit', { method: 'HEAD' });
    expect(head.statusCode).toBe(200);
    expect(head.headers.location).toBeUndefined();
    const bot = await t.pub('/w2-limit', { headers: { 'user-agent': BOT_UA } });
    expect(bot.statusCode).toBe(200);
    expect(bot.headers.location).toBeUndefined();
    expect(bot.body).not.toContain('geheim-einmal');
    t.ctx.stats.flush();
    expect(clicksOf(l.id)).toBe(0);
    // Ein echter Aufruf funktioniert weiterhin und zählt.
    const ok = await t.pub('/w2-limit');
    expect(location(ok)).toBe('https://ziel.example/geheim-einmal');
    // Ohne Limit bleibt HEAD eine Weiterleitung.
    await t.admin.createLink({ url: 'https://ziel.example/frei', slug: 'w2-frei' });
    expect((await t.pub('/w2-frei', { method: 'HEAD' })).statusCode).toBe(302);
  });

  it('W3: Unique-Verletzung der Datenbank wird zu 409 statt 500', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/a', slug: 'w3-gleich' });
    const links = t.ctx.links;
    const orig = links.slugAvailable.bind(links);
    // Wettlauf nachstellen: Die Vorprüfung hält die Adresse für frei.
    links.slugAvailable = () => ({ available: true });
    try {
      const res = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/b', slug: 'w3-gleich' });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({ code: 'conflict', field: 'slug', message: 'Diese Kurzadresse ist bereits vergeben.' });
    } finally {
      links.slugAvailable = orig;
    }
  });

  it('W3: parallele Anlage derselben Kurzadresse mit Passwort ergibt einmal 201, sonst 409', async () => {
    const res = await Promise.all(
      Array.from({ length: 5 }, (_, i) => t.admin.post('/api/v1/links', { url: `https://ziel.example/p${i}`, slug: 'w3-parallel', password: 'Sesam-1234' })),
    );
    expect(res.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(res.filter((r) => r.statusCode === 409)).toHaveLength(4);
  });

  it('W4: Suchindex folgt dem Umbenennen und Löschen eines Schlagworts', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/fts', slug: 'w4-fts', tags: ['altname'] });
    const search = async (q: string) => (await t.admin.json('GET', `/api/v1/links?q=${q}`)).items.map((i: { id: number }) => i.id);
    expect(await search('altname')).toContain(l.id);
    const tag = l.tags[0];
    await t.admin.json('PATCH', `/api/v1/tags/${tag.id}`, { name: 'neuname' });
    expect(await search('altname')).not.toContain(l.id);
    expect(await search('neuname')).toContain(l.id);
    await t.admin.json('DELETE', `/api/v1/tags/${tag.id}`);
    expect(await search('neuname')).not.toContain(l.id);
    expect(await search('w4-fts')).toContain(l.id);
  });

  it('W5: Statistik löschen verlangt scope', async () => {
    await t.admin.json('DELETE', '/api/v1/stats', undefined, 400);
    await t.admin.json('DELETE', '/api/v1/stats?scope=alles', undefined, 400);
    await t.admin.json('DELETE', '/api/v1/stats?scope=details');
    await t.admin.json('DELETE', '/api/v1/stats?scope=all');
  });

  it('W6: Schreibfehler beim Flush verliert keine Klicks', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/flush', slug: 'w6-flush', maxClicks: 100 });
    t.ctx.stats.flush();
    await t.pub('/w6-flush');
    await t.pub('/w6-flush');
    const db = t.ctx.db;
    const orig = db.transaction;
    db.transaction = (() => {
      throw new Error('Platte voll');
    }) as unknown as typeof db.transaction;
    try {
      t.ctx.stats.flush();
    } finally {
      db.transaction = orig;
    }
    expect(clicksOf(l.id)).toBe(0);
    expect(t.ctx.stats.pendingClicks.get(l.id)).toBe(2);
    await t.pub('/w6-flush');
    t.ctx.stats.flush();
    expect(clicksOf(l.id)).toBe(3);
    expect(t.ctx.stats.pendingClicks.has(l.id)).toBe(false);
    const hourly = db.prepare('SELECT SUM(clicks) n FROM stats_hourly WHERE link_id = ?').get(l.id) as { n: number };
    expect(hourly.n).toBe(3);
  });

  it('W7: Domain mit reservierten Kurzadressen lässt sich nicht löschen', async () => {
    const d = await t.admin.json('POST', '/api/v1/domains', { host: 'w7-reserviert.test', kind: 'internal', https: false }, 201);
    const l = await t.admin.createLink({ url: 'https://ziel.example/w7', slug: 'w7', domainId: d.id });
    await t.admin.json('DELETE', `/api/v1/links/${l.id}`);
    const res = await t.admin.del(`/api/v1/domains/${d.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain('deaktivieren');
    expect(t.ctx.db.prepare('SELECT 1 FROM slug_tombstones WHERE domain_id = ?').get(d.id)).toBeTruthy();
  });

  it('W8: unbekannte ownerId ergibt 400 am Feld ownerId', async () => {
    const res = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/w8', ownerId: 999_999 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.field).toBe('ownerId');
  });

  it('W10: Zielprüfung plant je Durchlauf passend zum Bestand', async () => {
    t.ctx.settings.update({ healthChecks: true });
    const jobs = t.ctx.jobs as unknown as { queueHealth: (id: number) => void; scheduleHealthChecks: (limit?: number) => number };
    const queued: number[] = [];
    const orig = jobs.queueHealth;
    jobs.queueHealth = (id) => queued.push(id);
    try {
      const n = jobs.scheduleHealthChecks();
      expect(n).toBeGreaterThan(0);
      expect(n).toBe(queued.length);
      expect(jobs.scheduleHealthChecks(1)).toBe(1);
    } finally {
      jobs.queueHealth = orig;
      t.ctx.settings.update({ healthChecks: false });
    }
  });

  it('W11: Vorschau inaktiver Links zeigt kein Ziel', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/inaktiv-geheim', slug: 'w11-aus' });
    expect((await t.pub('/w11-aus+')).body).toContain('inaktiv-geheim');
    await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { enabled: false });
    const res = await t.pub('/w11-aus+');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('inaktiv-geheim');
    expect(res.body).toContain('nicht aktiv');
  });

  it('Klein 2: Vorschau-Daten invalidieren den Weiterleitungs-Cache', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/meta', slug: 'k2-meta' });
    expect(t.ctx.resolver.lookup(l.domain.id, 'k2-meta').link?.metaTitle).toBeNull();
    t.ctx.links.saveMeta(l.id, { title: 'Seitentitel', description: 'Text', imageId: null, iconId: null });
    expect(t.ctx.resolver.lookup(l.domain.id, 'k2-meta').link?.metaTitle).toBe('Seitentitel');
  });

  it('Klein 3: deutsche Datumsangaben im Import gelten in der eingestellten Zeitzone', () => {
    const csv = 'url,ablauf\nhttps://ziel.example/a,15.01.2027\nhttps://ziel.example/b,15.07.2027 08:30\nhttps://ziel.example/c,31.02.2027';
    const berlin = parseCsv(csv, () => false, 'Europe/Berlin');
    expect(berlin.rows[0].expiresAt).toBe('2027-01-15T22:59:00.000Z');
    expect(berlin.rows[1].expiresAt).toBe('2027-07-15T06:30:00.000Z');
    expect(berlin.errors.map((e) => e.message).join()).toContain('31.02.2027');
    const ny = parseCsv(csv, () => false, 'America/New_York');
    expect(ny.rows[0].expiresAt).toBe('2027-01-16T04:59:00.000Z');
  });

  it('Klein 6: Steuerzeichen in der Suche führen nicht zu 500', async () => {
    const res = await t.admin.get(`/api/v1/links?q=${encodeURIComponent('ab\u0000cd')}`);
    expect(res.statusCode).toBe(200);
  });

  it('Klein 7: ungültige Kalenderdaten im Zeitraum ergeben 400', async () => {
    await t.admin.json('GET', '/api/v1/stats?from=2026-02-30&to=2026-03-10', undefined, 400);
    await t.admin.json('GET', '/api/v1/stats?from=1999-12-30&to=2000-01-10', undefined, 400);
    await t.admin.json('GET', '/api/v1/stats?from=2026-02-01&to=2026-02-28');
  });

  it('Klein 8: Vertipper-Radar schlägt weiterhin ähnliche Adressen vor', async () => {
    t.ctx.settings.update({ trackUnknownSlugs: true });
    const l = await t.admin.createLink({ url: 'https://ziel.example/radar', slug: 'sommerfest' });
    await t.pub('/sommerfets', { remoteAddress: uniqueIp() });
    const res = await t.admin.json('GET', '/api/v1/stats/outcomes?range=7d');
    const u = res.unknown.find((x: { slug: string }) => x.slug === 'sommerfets');
    expect(u.suggestion).toEqual({ id: l.id, slug: 'sommerfest' });
  });

  it('Klein 10: Kampagnenende vor Beginn ergibt 400', async () => {
    await t.admin.json('POST', '/api/v1/campaigns', { name: 'k10-falsch', startsAt: '2027-02-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' }, 400);
    const c = await t.admin.json('POST', '/api/v1/campaigns', { name: 'k10', startsAt: '2027-02-01T00:00:00Z' }, 201);
    await t.admin.json('PATCH', `/api/v1/campaigns/${c.id}`, { endsAt: '2027-01-01T00:00:00Z' }, 400);
    await t.admin.json('PATCH', `/api/v1/campaigns/${c.id}`, { endsAt: '2027-03-01T00:00:00Z' });
  });

  it('Klein 11: Meldungen bleiben nach dem Löschen des Links lesbar', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/gemeldet', slug: 'k11-melden' });
    const r = await t.pub('/k11-melden+melden', { method: 'POST', headers: form, payload: 'reason=phishing&message=boese', remoteAddress: uniqueIp() });
    expect(r.statusCode).toBe(200);
    await t.admin.json('DELETE', `/api/v1/links/${l.id}`);
    const reports = await t.admin.json('GET', '/api/v1/reports');
    const mine = reports.items.find((x: { message: string }) => x.message === 'boese');
    expect(mine).toBeTruthy();
    expect(mine.linkId).toBeNull();
    expect(mine.shortLabel).toBe(`${l.domain.host}/k11-melden`);
  });

  it('Klein 12: jobs.stop leert die Warteschlangen und wartet höchstens kurz', async () => {
    const jobs = t.ctx.jobs as unknown as { healthQueue: { push: (k: string, fn: () => Promise<void>) => void; size: number } };
    let done = 0;
    for (let i = 0; i < 10; i++) jobs.healthQueue.push(`k12-${i}`, () => new Promise((r) => setTimeout(() => r(void done++), 100)));
    const started = Date.now();
    await t.ctx.jobs.stop();
    expect(Date.now() - started).toBeLessThan(3500);
    expect(jobs.healthQueue.size).toBe(0);
    expect(done).toBe(3);
  });
});

describe('Klein 15: Fensterzähler räumt bei vielen Schlüsseln gezielt auf', () => {
  it('behält laufende Sperren statt alles zu leeren', () => {
    const w = new RateWindow(1, 60_000, 100);
    w.take('gesperrt');
    expect(w.take('gesperrt')).toBe(false);
    for (let i = 0; i < 200; i++) w.take(`k${i}`);
    expect(w.size).toBeLessThanOrEqual(100);
    expect(w.size).toBeGreaterThan(0);
    // Der älteste Eintrag fällt bei Überlauf zwar weg – neuere Sperren bleiben jedoch erhalten.
    const fresh = new RateWindow(1, 60_000, 100);
    for (let i = 0; i < 99; i++) fresh.take(`k${i}`);
    fresh.take('neu');
    expect(fresh.take('neu')).toBe(false);
    fresh.take('ueberlauf');
    expect(fresh.take('neu')).toBe(false);
  });
});
