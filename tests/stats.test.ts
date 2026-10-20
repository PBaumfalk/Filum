import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayKey, now } from '../src/server/lib/time.js';
import { BOT_UA, IPHONE_UA, createTestApp, uniqueIp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const sum = (series: { clicks: number }[]) => series.reduce((s, x) => s + x.clicks, 0);
const dimMap = (d: { value: string; count: number }[] | undefined) => Object.fromEntries((d ?? []).map((x) => [x.value, x.count]));

describe('Zählung und Auswertung', () => {
  it('Aufrufe erscheinen nach dem Flush in Link- und Gesamtstatistik, Bots getrennt', async () => {
    const l = await t.admin.createLink({ url: 'https://stats.example/a', slug: 'stat-a' });
    const other = await t.admin.createLink({ url: 'https://stats.example/b', slug: 'stat-b' });
    for (let i = 0; i < 3; i++) await t.pub('/stat-a');
    await t.pub('/stat-a?qr');
    await t.pub('/stat-a', { headers: { 'user-agent': BOT_UA } });
    await t.pub('/stat-a', { headers: { 'user-agent': 'curl/8.4.0' } });
    await t.pub('/stat-b');

    // vor dem Flush steht noch nichts in der Datenbank
    expect((t.ctx.db.prepare('SELECT click_count FROM links WHERE id = ?').get(l.id) as { click_count: number }).click_count).toBe(0);
    t.ctx.stats.flush();

    const s = await t.admin.json('GET', `/api/v1/links/${l.id}/stats?range=24h`);
    expect(s.mode).toBe('basic');
    expect(s.totals).toMatchObject({ clicks: 4, qr: 1, bots: 2 });
    expect(s.series).toHaveLength(24);
    expect(sum(s.series)).toBe(4);
    expect(s.top).toEqual([]);
    expect(s.heatmap.flat().reduce((a: number, b: number) => a + b, 0)).toBe(4);

    const s30 = await t.admin.json('GET', `/api/v1/links/${l.id}/stats?range=30d`);
    expect(s30.series).toHaveLength(30);
    expect(s30.range.granularity).toBe('day');
    expect(sum(s30.series)).toBe(4);

    const all = await t.admin.json('GET', '/api/v1/stats?range=7d');
    expect(all.totals.clicks).toBeGreaterThanOrEqual(5);
    const top = Object.fromEntries(all.top.map((x: { id: number; clicks: number }) => [x.id, x.clicks]));
    expect(top[l.id]).toBe(4);
    expect(top[other.id]).toBe(1);

    const link = await t.admin.json('GET', `/api/v1/links/${l.id}`);
    expect(link.clicks).toBe(4);
    expect(link.lastClickAt).not.toBeNull();
    expect(link.spark.reduce((a: number, b: number) => a + b, 0)).toBe(4);

    // Basis-Modus speichert keine Detailauswertungen
    expect(s.dims).toEqual({});
  });

  it('Statistik nach Schlagwort, Kampagne und Zeitraum', async () => {
    const c = await t.admin.json('POST', '/api/v1/campaigns', { name: 'Stat-Kampagne' }, 201);
    const l = await t.admin.createLink({ url: 'https://stats.example/c', slug: 'stat-c', tags: ['statistik'], campaignId: c.id });
    await t.pub('/stat-c');
    await t.pub('/stat-c');
    const byTag = await t.admin.json('GET', '/api/v1/stats?range=24h&tag=STATISTIK');
    expect(byTag.totals.clicks).toBe(2);
    const byCampaign = await t.admin.json('GET', `/api/v1/stats?range=24h&campaignId=${c.id}`);
    expect(byCampaign.top.map((x: { id: number }) => x.id)).toEqual([l.id]);
    const campaigns = await t.admin.json('GET', '/api/v1/stats/campaigns?range=7d');
    expect(campaigns.items.find((x: { id: number }) => x.id === c.id)).toMatchObject({ links: 1, clicks: 2 });
    const today = new Date().toISOString().slice(0, 10);
    const custom = await t.admin.json('GET', `/api/v1/links/${l.id}/stats?from=2020-01-01&to=2020-01-31`);
    expect(custom.totals.clicks).toBe(0);
    expect(custom.series).toHaveLength(31);
    expect((await t.admin.get(`/api/v1/links/${l.id}/stats?from=${today}&to=2020-01-01`)).statusCode).toBe(400);
    expect((await t.admin.get(`/api/v1/links/${l.id}/stats?from=2020-01-01&to=2024-01-01`)).statusCode).toBe(400);
    expect((await t.admin.get(`/api/v1/links/${l.id}/stats?range=1000d`)).statusCode).toBe(400);
  });

  it('Modus „extended“ speichert Herkunft, Gerät, System, Browser und Sprache – nie Rohdaten', async () => {
    await t.admin.json('PATCH', '/api/v1/settings', { analyticsMode: 'extended' });
    const l = await t.admin.createLink({ url: 'https://stats.example/ext', slug: 'stat-ext' });
    await t.pub('/stat-ext', { headers: { referer: 'https://www.news.example/artikel?id=123&user=geheim', 'accept-language': 'en-US,en;q=0.9' } });
    await t.pub('/stat-ext', { headers: { 'user-agent': IPHONE_UA, 'accept-language': 'de-DE' } });
    await t.pub('/stat-ext', { headers: { referer: 'https://go.test/andere' } });
    await t.pub('/stat-ext', { headers: { 'user-agent': BOT_UA, referer: 'https://bot.example/' } });
    t.ctx.stats.flush();
    const s = await t.admin.json('GET', `/api/v1/links/${l.id}/stats?range=7d`);
    expect(s.mode).toBe('extended');
    expect(dimMap(s.dims.referrer)).toEqual({ 'news.example': 1, '(direkt)': 2 });
    expect(dimMap(s.dims.device)).toEqual({ desktop: 2, mobil: 1 });
    expect(dimMap(s.dims.os)).toEqual({ Windows: 2, iOS: 1 });
    expect(dimMap(s.dims.browser)).toEqual({ Chrome: 2, Safari: 1 });
    expect(dimMap(s.dims.language)).toEqual({ en: 1, de: 1, '(keine)': 1 });
    // In der Datenbank stehen keine vollständigen Referrer, IPs oder User-Agents
    const raw = JSON.stringify(t.ctx.db.prepare('SELECT * FROM stats_dims').all());
    expect(raw).not.toContain('geheim');
    expect(raw).not.toContain('Mozilla');
    expect(raw).not.toContain('127.0.0.1');

    // zurück auf basic löscht die Details
    await t.admin.json('PATCH', '/api/v1/settings', { analyticsMode: 'basic' });
    const after = await t.admin.json('GET', `/api/v1/links/${l.id}/stats?range=7d`);
    expect(after.dims).toEqual({});
    expect(after.totals.clicks).toBe(3);
  });

  it('Modus „off“ speichert keine Zeitreihen, zählt aber für Aufruflimits weiter', async () => {
    await t.admin.json('PATCH', '/api/v1/settings', { analyticsMode: 'off' });
    const l = await t.admin.createLink({ url: 'https://stats.example/off', slug: 'stat-off', maxClicks: 2 });
    await t.pub('/stat-off');
    await t.pub('/stat-off?qr');
    await t.pub('/nicht-da-off');
    expect((await t.pub('/stat-off')).statusCode).toBe(410);
    t.ctx.stats.flush();
    const rows = t.ctx.db.prepare('SELECT * FROM stats_hourly WHERE link_id = ?').all(l.id);
    expect(rows).toEqual([]);
    expect(t.ctx.db.prepare("SELECT * FROM stats_unknown WHERE slug = 'nicht-da-off'").all()).toEqual([]);
    const link = await t.admin.json('GET', `/api/v1/links/${l.id}`);
    expect(link.clicks).toBe(2);
    const s = await t.admin.json('GET', `/api/v1/links/${l.id}/stats?range=24h`);
    expect(s.mode).toBe('off');
    expect(s.totals.clicks).toBe(0);
    const notice = await t.admin.json('GET', '/api/v1/settings/privacy-notice');
    expect(notice.text).toContain('keine Nutzungsstatistik');
    await t.admin.json('PATCH', '/api/v1/settings', { analyticsMode: 'basic' });
  });
});

describe('Ergebnisse und unbekannte Kurzadressen', () => {
  it('outcomes zählen not_found, expired, disabled, gone, preview, password und Vorschläge', async () => {
    await t.admin.createLink({ url: 'https://stats.example/sf', slug: 'sommerfest' });
    await t.admin.createLink({ url: 'https://stats.example/e', slug: 'out-exp', expiresAt: new Date(Date.now() - 1000).toISOString() });
    await t.admin.createLink({ url: 'https://stats.example/d', slug: 'out-off', enabled: false });
    await t.admin.createLink({ url: 'https://stats.example/p', slug: 'out-pw', password: 'geheim-1' });
    const gone = await t.admin.createLink({ url: 'https://stats.example/g', slug: 'out-gone' });
    await t.admin.json('DELETE', `/api/v1/links/${gone.id}`);

    const before = await t.admin.json('GET', '/api/v1/stats/outcomes?range=7d');
    const b = Object.fromEntries(before.outcomes.map((o: { outcome: string; count: number }) => [o.outcome, o.count]));
    const ip = uniqueIp();
    await t.pub('/sommerfst', { remoteAddress: ip });
    await t.pub('/sommerfst', { remoteAddress: ip });
    await t.pub('/voellig-unbekannt-xyz', { remoteAddress: ip });
    await t.pub('/out-exp');
    await t.pub('/out-off');
    await t.pub('/out-gone', { remoteAddress: ip });
    await t.pub('/out-pw');
    await t.pub('/sommerfest+');
    await t.pub('/sommerfest');
    await t.pub('/x', { headers: { host: 'fremd.test' } });

    const res = await t.admin.json('GET', '/api/v1/stats/outcomes?range=7d');
    const o = Object.fromEntries(res.outcomes.map((x: { outcome: string; count: number }) => [x.outcome, x.count]));
    const delta = (k: string) => (o[k] ?? 0) - (b[k] ?? 0);
    expect(delta('not_found')).toBe(3);
    expect(delta('expired')).toBe(1);
    expect(delta('disabled')).toBe(1);
    expect(delta('gone')).toBe(1);
    expect(delta('password')).toBe(1);
    expect(delta('preview')).toBe(1);
    expect(delta('redirect')).toBe(1);

    const typo = res.unknown.find((u: { slug: string }) => u.slug === 'sommerfst');
    expect(typo).toMatchObject({ count: 2, host: 'go.test', suggestion: { slug: 'sommerfest' } });
    const far = res.unknown.find((u: { slug: string }) => u.slug === 'voellig-unbekannt-xyz');
    expect(far.suggestion).toBeNull();
    // Unbekannte Adresse wird nicht mehr gelistet, sobald es den Link gibt
    await t.admin.createLink({ url: 'https://stats.example/x', slug: 'Voellig-Unbekannt-XYZ' });
    const later = await t.admin.json('GET', '/api/v1/stats/outcomes?range=7d');
    expect(later.unknown.map((u: { slug: string }) => u.slug)).not.toContain('voellig-unbekannt-xyz');
  });

  it('Erfassung unbekannter Kurzadressen lässt sich abschalten', async () => {
    await t.admin.json('PATCH', '/api/v1/settings', { trackUnknownSlugs: false });
    await t.pub('/ganz-neu-unbekannt', { remoteAddress: uniqueIp() });
    const res = await t.admin.json('GET', '/api/v1/stats/outcomes?range=7d');
    expect(res.unknown.map((u: { slug: string }) => u.slug)).not.toContain('ganz-neu-unbekannt');
    await t.admin.json('PATCH', '/api/v1/settings', { trackUnknownSlugs: true });
  });
});

describe('Löschen und Aufräumen', () => {
  it('Statistik eines Links löschen', async () => {
    const l = await t.admin.createLink({ url: 'https://stats.example/del', slug: 'stat-del' });
    await t.pub('/stat-del');
    await t.pub('/stat-del');
    // nicht geflusht: auch ausstehende Zähler werden mit gelöscht
    await t.admin.json('DELETE', `/api/v1/links/${l.id}/stats`);
    const s = await t.admin.json('GET', `/api/v1/links/${l.id}/stats?range=24h`);
    expect(s.totals.clicks).toBe(0);
    expect((await t.admin.json('GET', `/api/v1/links/${l.id}`)).clicks).toBe(0);
  });

  it('gesamte Statistik löschen (nur Admin)', async () => {
    const l = await t.admin.createLink({ url: 'https://stats.example/all', slug: 'stat-all' });
    await t.pub('/stat-all');
    t.ctx.stats.flush();
    const member = await t.createUser('member');
    expect((await member.del('/api/v1/stats?scope=all')).statusCode).toBe(403);
    await t.admin.json('DELETE', '/api/v1/stats?scope=all');
    expect((await t.admin.json('GET', '/api/v1/stats?range=30d')).totals.clicks).toBe(0);
    expect((await t.admin.json('GET', `/api/v1/links/${l.id}`)).clicks).toBe(0);
    expect((await t.admin.json('GET', '/api/v1/stats/outcomes?range=30d')).outcomes).toEqual([]);
  });

  it('Statistik gelöschter Links wird beim Flush verworfen', async () => {
    const l = await t.admin.createLink({ url: 'https://stats.example/weg', slug: 'stat-weg' });
    await t.pub('/stat-weg');
    await t.admin.json('DELETE', `/api/v1/links/${l.id}`);
    t.ctx.stats.flush();
    expect(t.ctx.db.prepare('SELECT * FROM stats_hourly WHERE link_id = ?').all(l.id)).toEqual([]);
  });

  it('prune löscht nur Daten außerhalb der Aufbewahrungsfristen', async () => {
    const l = await t.admin.createLink({ url: 'https://stats.example/prune', slug: 'stat-prune' });
    const s = t.ctx.settings.get();
    const hourNow = Math.floor(now() / 3600);
    const oldHour = hourNow - (s.retentionDays + 2) * 24;
    const tz = s.timezone;
    const oldDetailDay = dayKey(now() - (s.detailRetentionDays + 2) * 86400, tz);
    const midDay = dayKey(now() - (s.detailRetentionDays - 5) * 86400, tz);
    const oldDay = dayKey(now() - (s.retentionDays + 2) * 86400, tz);
    const today = dayKey(now(), tz);
    const db = t.ctx.db;
    db.prepare('INSERT INTO stats_hourly(link_id, hour, clicks, qr, bots) VALUES (?,?,?,?,?)').run(l.id, oldHour, 5, 0, 0);
    db.prepare('INSERT INTO stats_hourly(link_id, hour, clicks, qr, bots) VALUES (?,?,?,?,?)').run(l.id, hourNow - 24, 7, 0, 0);
    db.prepare('INSERT INTO stats_dims(link_id, day, dim, value, count) VALUES (?,?,?,?,?)').run(l.id, oldDetailDay, 'device', 'alt', 1);
    db.prepare('INSERT INTO stats_dims(link_id, day, dim, value, count) VALUES (?,?,?,?,?)').run(l.id, midDay, 'device', 'neu', 1);
    db.prepare('INSERT INTO stats_outcomes(domain_id, day, outcome, count) VALUES (?,?,?,?)').run(t.defaultDomainId(), oldDay, 'not_found', 9);
    db.prepare('INSERT INTO stats_outcomes(domain_id, day, outcome, count) VALUES (?,?,?,?)').run(t.defaultDomainId(), today, 'gone', 1);
    db.prepare('INSERT INTO stats_unknown(domain_id, slug, day, count) VALUES (?,?,?,?)').run(t.defaultDomainId(), 'uralt', oldDetailDay, 1);

    const res = t.ctx.stats.prune();
    expect(res).toEqual({ hourly: 1, dims: 1, outcomes: 1, unknown: 1 });
    const hours = (db.prepare('SELECT hour FROM stats_hourly WHERE link_id = ?').all(l.id) as { hour: number }[]).map((r) => r.hour);
    expect(hours).toEqual([hourNow - 24]);
    expect((db.prepare('SELECT value FROM stats_dims WHERE link_id = ?').all(l.id) as { value: string }[]).map((r) => r.value)).toEqual(['neu']);
    expect(db.prepare("SELECT * FROM stats_outcomes WHERE outcome = 'gone' AND day = ?").get(today)).toBeTruthy();
    // ein zweiter Lauf löscht nichts mehr
    expect(t.ctx.stats.prune()).toEqual({ hourly: 0, dims: 0, outcomes: 0, unknown: 0 });
  });
});
