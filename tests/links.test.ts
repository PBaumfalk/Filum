import QRCode from 'qrcode';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, location, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const ids = (list: { items: { id: number }[] }) => list.items.map((l) => l.id);

describe('Anlegen', () => {
  it('automatischer Slug aus dem telefontauglichen Alphabet', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/auto' });
    expect(l.slug).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{6}$/);
    expect(l.shortUrl).toBe(`https://go.test/${l.slug}`);
    expect(l.redirectType).toBe(302);
    expect(l.state).toBe('active');
    expect(l.owner.id).toBe(t.admin.userId);
    expect(location(await t.pub(`/${l.slug}`))).toBe('https://ziel.example/auto');
  });

  it('Slug-Länge der Domain wird beachtet', async () => {
    await t.admin.json('PATCH', `/api/v1/domains/${t.defaultDomainId()}`, { slugLength: 9 });
    const l = await t.admin.createLink({ url: 'https://ziel.example/lang' });
    expect(l.slug).toHaveLength(9);
    await t.admin.json('PATCH', `/api/v1/domains/${t.defaultDomainId()}`, { slugLength: 6 });
  });

  it('eigener Slug, Schema-Ergänzung und Felder', async () => {
    const l = await t.admin.createLink({
      url: 'ziel.example/eigen',
      slug: '/Eigener-Slug/',
      title: '  Titel  ',
      notes: 'Notiz',
      tags: ['Alpha', 'beta', 'alpha'],
      redirectType: 301,
      favorite: true,
    });
    expect(l.slug).toBe('Eigener-Slug');
    expect(l.url).toBe('https://ziel.example/eigen');
    expect(l.title).toBe('Titel');
    expect(l.tags.map((x: { name: string }) => x.name)).toEqual(['Alpha', 'beta']);
    expect(l.favorite).toBe(true);
    expect(l.redirectType).toBe(301);
    expect(l.effectiveRedirectType).toBe(301);
  });

  it('lesbarer Slug aus Pfad und Titel', async () => {
    const s1 = await t.admin.json('GET', `/api/v1/slug/suggest?style=readable&url=${encodeURIComponent('https://ziel.example/docs/Über-uns.html')}`);
    expect(s1.slug).toBe('ueber-uns');
    const s2 = await t.admin.json('GET', `/api/v1/slug/suggest?style=readable&url=https://ziel.example/&title=${encodeURIComponent('Die Sommer-Aktion für 2026')}`);
    expect(s2.slug).toBe('sommer-aktion-2026');
    const s3 = await t.admin.json('GET', '/api/v1/slug/suggest?style=random&url=https://ziel.example/x');
    expect(s3.slug).toMatch(/^[a-z2-9]{6}$/);

    await t.admin.json('PATCH', '/api/v1/settings', { slugStyle: 'readable' });
    const a = await t.admin.createLink({ url: 'https://ziel.example/berichte/Jahresbericht-2025.html' });
    const b = await t.admin.createLink({ url: 'https://ziel.example/archiv/jahresbericht-2025.php' });
    expect(a.slug).toBe('jahresbericht-2025');
    expect(b.slug).toBe('jahresbericht-2025-2');
    await t.admin.json('PATCH', '/api/v1/settings', { slugStyle: 'random' });
  });

  it('Konflikt bei vergebener Kurzadresse (ohne Rücksicht auf Groß/klein)', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/k', slug: 'konflikt' });
    const res = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/k2', slug: 'KONFLIKT' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'conflict', field: 'slug' });
  });

  it('Validierungsfehler kommen mit Code und Feld', async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ url: 'javascript:alert(1)' }, 'scheme', 'url'],
      [{ url: 'https://u:p@ziel.example/' }, 'credentials', 'url'],
      [{ url: 'https://go.test/schleife' }, 'loop', 'url'],
      [{ url: 'https://ziel.example/', slug: 'api' }, 'reserved', 'slug'],
      [{ url: 'https://ziel.example/', slug: 'mit leerzeichen' }, 'invalid', 'slug'],
      [{ url: 'https://ziel.example/', fallbackUrl: 'data:text/html,x' }, 'scheme', 'fallbackUrl'],
      [{ url: 'https://ziel.example/', startsAt: '2030-01-02T00:00:00Z', expiresAt: '2030-01-01T00:00:00Z' }, 'invalid', 'expiresAt'],
      [{ url: 'https://ziel.example/', password: 'abc' }, 'invalid', 'password'],
      [{ url: 'https://ziel.example/', unbekannt: 1 }, 'invalid', ''],
      [{ url: 'https://ziel.example/', collectionId: 9999 }, 'invalid', 'collectionId'],
    ];
    for (const [body, code, field] of cases) {
      const res = await t.admin.post('/api/v1/links', body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().error.code, JSON.stringify(body)).toBe(code);
      expect(res.json().error.field ?? '', JSON.stringify(body)).toBe(field);
    }
  });

  it('Sperrliste wirkt sofort nach Änderung der Einstellungen', async () => {
    await t.admin.json('PATCH', '/api/v1/settings', { blockedHosts: ['*.Gesperrt.example'] });
    expect(t.ctx.settings.get().blockedHosts).toEqual(['gesperrt.example']);
    const res = await t.admin.post('/api/v1/links', { url: 'https://sub.gesperrt.example/x' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('blocked');
    await t.admin.json('PATCH', '/api/v1/settings', { blockedHosts: [] });
    expect((await t.admin.post('/api/v1/links', { url: 'https://sub.gesperrt.example/x' })).statusCode).toBe(201);
  });

  it('Batch-Anlage meldet Fehler je Zeile', async () => {
    const res = await t.admin.post('/api/v1/links/batch', {
      urls: ['https://batch.example/1', 'javascript:alert(1)', 'batch.example/3'],
      defaults: { tags: ['batch'] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.created).toHaveLength(2);
    expect(body.created.map((l: { url: string }) => l.url)).toEqual(['https://batch.example/1', 'https://batch.example/3']);
    expect(body.created[0].tags[0].name).toBe('batch');
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({ index: 1, url: 'javascript:alert(1)' });
    const allBad = await t.admin.post('/api/v1/links/batch', { urls: ['javascript:x'] });
    expect(allBad.statusCode).toBe(400);
  });
});

describe('Ändern, Duplizieren, Archivieren, Löschen', () => {
  it('PATCH ändert nur übergebene Felder', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/p', title: 'Alt', notes: 'bleibt', tags: ['x'] });
    const u = await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { title: 'Neu', tags: ['y', 'z'] });
    expect(u.title).toBe('Neu');
    expect(u.notes).toBe('bleibt');
    expect(u.url).toBe('https://ziel.example/p');
    expect(u.tags.map((x: { name: string }) => x.name)).toEqual(['y', 'z']);
    const bad = await t.admin.patch(`/api/v1/links/${l.id}`, { url: 'file:///etc/passwd' });
    expect(bad.statusCode).toBe(400);
    expect((await t.admin.json('GET', `/api/v1/links/${l.id}`)).url).toBe('https://ziel.example/p');
    expect((await t.admin.patch('/api/v1/links/999999', { title: 'x' })).statusCode).toBe(404);
  });

  it('Passwort setzen und entfernen', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/pw', slug: 'pw-wechsel' });
    expect(l.hasPassword).toBe(false);
    expect(l).not.toHaveProperty('passwordHash');
    const u = await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { password: 'Neues-Passwort' });
    expect(u.hasPassword).toBe(true);
    expect(JSON.stringify(u)).not.toContain('scrypt');
    expect((await t.pub('/pw-wechsel')).statusCode).toBe(200);
    await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { password: null });
    expect((await t.pub('/pw-wechsel')).statusCode).toBe(302);
  });

  it('Duplizieren übernimmt Einstellungen, aber nicht die Kurzadresse', async () => {
    const src = await t.admin.createLink({
      url: 'https://ziel.example/dup',
      slug: 'original',
      title: 'Original',
      tags: ['dup'],
      password: 'dup-geheim',
      redirectType: 307,
      utm: { utm_source: 'x' },
    });
    const res = await t.admin.post(`/api/v1/links/${src.id}/duplicate`);
    expect(res.statusCode).toBe(201);
    const d = res.json();
    expect(d.id).not.toBe(src.id);
    expect(d.slug).not.toBe('original');
    expect(d.title).toBe('Original (Kopie)');
    expect(d.url).toBe(src.url);
    expect(d.redirectType).toBe(307);
    expect(d.hasPassword).toBe(true);
    expect(d.utm).toEqual({ utm_source: 'x' });
    expect(d.tags.map((x: { name: string }) => x.name)).toEqual(['dup']);
    const form = { 'content-type': 'application/x-www-form-urlencoded' };
    expect((await t.pub(`/${d.slug}`, { method: 'POST', headers: form, payload: 'password=dup-geheim' })).statusCode).toBe(303);
  });

  it('archivierte Links leiten weiter, sind aber standardmäßig nicht in der Liste', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/archiv', slug: 'archiviert', title: 'ArchivTitel' });
    await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { archived: true });
    expect(location(await t.pub('/archiviert'))).toBe('https://ziel.example/archiv');
    expect(ids(await t.admin.json('GET', '/api/v1/links?limit=500'))).not.toContain(l.id);
    expect(ids(await t.admin.json('GET', '/api/v1/links?state=archived'))).toContain(l.id);
    expect(ids(await t.admin.json('GET', '/api/v1/links?state=all&limit=500'))).toContain(l.id);
    expect(ids(await t.admin.json('GET', '/api/v1/links?q=ArchivTitel'))).not.toContain(l.id);
    const back = await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { archived: false });
    expect(back.archived).toBe(false);
    expect(ids(await t.admin.json('GET', '/api/v1/links?limit=500'))).toContain(l.id);
  });

  it('geschützte Links: Löschen nur mit confirm=protected, Slug-Änderung → 409', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/schutz', slug: 'geschuetzt', protected: true });
    const del = await t.admin.del(`/api/v1/links/${l.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe('protected');
    const slug = await t.admin.patch(`/api/v1/links/${l.id}`, { slug: 'anders' });
    expect(slug.statusCode).toBe(409);
    expect(slug.json().error.code).toBe('protected');
    const dom = await t.admin.json('POST', '/api/v1/domains', { host: 'zweit.test', kind: 'internal' }, 201);
    const move = await t.admin.patch(`/api/v1/links/${l.id}`, { domainId: dom.id });
    expect(move.statusCode).toBe(409);
    // Groß-/Kleinschreibung ändern ist erlaubt (gleiche Kurzadresse)
    expect((await t.admin.patch(`/api/v1/links/${l.id}`, { slug: 'Geschuetzt' })).statusCode).toBe(200);
    // Ziel darf sich ändern
    expect((await t.admin.patch(`/api/v1/links/${l.id}`, { url: 'https://ziel.example/schutz2' })).statusCode).toBe(200);
    // mit Bestätigung geht es
    expect((await t.admin.patch(`/api/v1/links/${l.id}`, { slug: 'geschuetzt-neu', confirmProtected: true })).statusCode).toBe(200);
    expect((await t.pub('/geschuetzt-neu')).statusCode).toBe(302);
    expect((await t.admin.del(`/api/v1/links/${l.id}?confirm=protected`)).statusCode).toBe(200);
    expect((await t.admin.get(`/api/v1/links/${l.id}`)).statusCode).toBe(404);
    expect((await t.pub('/geschuetzt-neu')).statusCode).toBe(410);
  });

  it('Versionen und Wiederherstellen', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/v1', slug: 'versionen', title: 'V1' });
    await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { url: 'https://ziel.example/v2', title: 'V2' });
    await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { title: 'V2' }); // keine Änderung → keine neue Version
    const v = await t.admin.json('GET', `/api/v1/links/${l.id}/versions`);
    expect(v.items).toHaveLength(2);
    expect(v.items[0]).toMatchObject({ url: 'https://ziel.example/v2', by: 'Admin' });
    expect(v.items[0].summary).toContain('Ziel');
    expect(v.items[1]).toMatchObject({ url: 'https://ziel.example/v1', summary: 'Angelegt' });
    expect(location(await t.pub('/versionen'))).toBe('https://ziel.example/v2');

    const restored = await t.admin.json('POST', `/api/v1/links/${l.id}/versions/${v.items[1].id}/restore`);
    expect(restored.url).toBe('https://ziel.example/v1');
    expect(restored.title).toBe('V1');
    expect(location(await t.pub('/versionen'))).toBe('https://ziel.example/v1');
    const v2 = await t.admin.json('GET', `/api/v1/links/${l.id}/versions`);
    expect(v2.items).toHaveLength(3);
    expect(v2.items[0].summary).toContain('wiederhergestellt');
    // fremde Version → 404
    const other = await t.admin.createLink({ url: 'https://ziel.example/o' });
    const ov = (await t.admin.json('GET', `/api/v1/links/${other.id}/versions`)).items[0].id;
    expect((await t.admin.post(`/api/v1/links/${l.id}/versions/${ov}/restore`)).statusCode).toBe(404);
    // Protokoll
    const hist = await t.admin.json('GET', `/api/v1/links/${l.id}/history`);
    expect(hist.items.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['link.create', 'link.update']));
  });
});

describe('Liste, Suche, Filter, Sortierung', () => {
  let a: number, b: number, c: number;
  beforeAll(async () => {
    const member = await t.createUser('member');
    a = (await t.admin.createLink({ url: 'https://shop.example/sommerfest', slug: 'liste-a', title: 'Einladung Sommerfest', tags: ['Event'], notes: 'Gartenparty' })).id;
    b = (await t.admin.createLink({ url: 'https://shop.example/winterball', slug: 'liste-b', title: 'Winterball', tags: ['event', 'Ball'], favorite: true })).id;
    c = (await member.createLink({ url: 'https://andere.example/xy', slug: 'liste-c', title: 'Xy kurz' })).id;
    await t.admin.json('PATCH', `/api/v1/links/${c}`, { enabled: false });
  });

  it('Volltextsuche (≥ 3 Zeichen) in Titel, Ziel, Notiz, Schlagwort und Slug', async () => {
    expect(ids(await t.admin.json('GET', '/api/v1/links?q=sommer'))).toEqual([a]);
    expect(ids(await t.admin.json('GET', '/api/v1/links?q=Gartenparty'))).toEqual([a]);
    expect(ids(await t.admin.json('GET', '/api/v1/links?q=winterb'))).toEqual([b]);
    expect(ids(await t.admin.json('GET', '/api/v1/links?q=liste-'))).toEqual(expect.arrayContaining([a, b, c]));
    expect(ids(await t.admin.json('GET', '/api/v1/links?q=Ball'))).toEqual([b]);
    // Sonderzeichen brechen die Suche nicht
    expect((await t.admin.get('/api/v1/links?q=%22OR%201%3D1%20--')).statusCode).toBe(200);
    expect((await t.admin.get('/api/v1/links?q=a*b(c)')).statusCode).toBe(200);
  });

  it('Volltextsuche findet geänderte Titel', async () => {
    await t.admin.json('PATCH', `/api/v1/links/${a}`, { title: 'Einladung Herbstfest' });
    expect(ids(await t.admin.json('GET', '/api/v1/links?q=Herbstfest'))).toEqual([a]);
    expect(ids(await t.admin.json('GET', '/api/v1/links?q=Sommerfest'))).toEqual([a]); // steht noch im Ziel
    expect(ids(await t.admin.json('GET', '/api/v1/links?q=Einladung%20Sommer'))).toEqual([]);
  });

  it('kurze Suchbegriffe (< 3 Zeichen) über LIKE, ohne Platzhalter-Effekt', async () => {
    expect(ids(await t.admin.json('GET', '/api/v1/links?q=xy'))).toEqual([c]);
    expect(ids(await t.admin.json('GET', '/api/v1/links?q=XY'))).toEqual([c]);
    expect((await t.admin.json('GET', '/api/v1/links?q=%25')).total).toBe(0);
    expect((await t.admin.json('GET', '/api/v1/links?q=_')).total).toBe(0);
  });

  it('Filter: state, tag, favorite, owner=me', async () => {
    expect(ids(await t.admin.json('GET', '/api/v1/links?state=disabled'))).toEqual([c]);
    expect(ids(await t.admin.json('GET', '/api/v1/links?state=active&q=liste-'))).toEqual(expect.not.arrayContaining([c]));
    expect(ids(await t.admin.json('GET', '/api/v1/links?tag=EVENT')).sort()).toEqual([a, b].sort());
    expect(ids(await t.admin.json('GET', '/api/v1/links?favorite=1'))).toContain(b);
    expect(ids(await t.admin.json('GET', '/api/v1/links?favorite=1'))).not.toContain(a);
    const mine = ids(await t.admin.json('GET', '/api/v1/links?owner=me&limit=500'));
    expect(mine).toEqual(expect.arrayContaining([a, b]));
    expect(mine).not.toContain(c);
    expect((await t.admin.get('/api/v1/links?state=kaputt')).statusCode).toBe(400);
  });

  it('Sortierung und Seiten', async () => {
    const asc = (await t.admin.json('GET', '/api/v1/links?q=liste-&sort=slug&dir=asc')).items.map((l: { slug: string }) => l.slug);
    expect(asc).toEqual(['liste-a', 'liste-b', 'liste-c']);
    const desc = (await t.admin.json('GET', '/api/v1/links?q=liste-&sort=slug&dir=desc')).items.map((l: { slug: string }) => l.slug);
    expect(desc).toEqual(['liste-c', 'liste-b', 'liste-a']);
    const page = await t.admin.json('GET', '/api/v1/links?q=liste-&sort=slug&dir=asc&limit=1&offset=1');
    expect(page.total).toBe(3);
    expect(page.items.map((l: { slug: string }) => l.slug)).toEqual(['liste-b']);
    expect((await t.admin.get('/api/v1/links?sort=drop%20table')).statusCode).toBe(400);
    expect((await t.admin.get('/api/v1/links?limit=100000')).statusCode).toBe(400);
  });

  it('counts', async () => {
    const counts = await t.admin.json('GET', '/api/v1/links/counts');
    const all = await t.admin.json('GET', '/api/v1/links?limit=1');
    expect(counts.live).toBe(all.total);
    expect(counts.disabled).toBe((await t.admin.json('GET', '/api/v1/links?state=disabled&limit=1')).total);
    expect(counts.archived).toBe((await t.admin.json('GET', '/api/v1/links?state=archived&limit=1')).total);
    expect(counts.favorites).toBeGreaterThanOrEqual(1);
    expect(counts.active + counts.disabled + counts.scheduled + counts.expired).toBe(counts.live);
  });
});

describe('Bulk-Aktionen', () => {
  it('deaktivieren, Schlagwörter, Ablauf, Löschen mit Schutz', async () => {
    const x = await t.admin.createLink({ url: 'https://bulk.example/1', slug: 'bulk-1' });
    const y = await t.admin.createLink({ url: 'https://bulk.example/2', slug: 'bulk-2', protected: true });
    const r1 = await t.admin.json('POST', '/api/v1/links/bulk', { ids: [x.id, y.id], action: { type: 'disable' } });
    expect(r1).toMatchObject({ ok: 2, total: 2, failed: [] });
    expect((await t.pub('/bulk-1')).statusCode).toBe(404);

    await t.admin.json('POST', '/api/v1/links/bulk', { ids: [x.id, y.id], action: { type: 'addTags', tags: ['Massen', 'b2'] } });
    await t.admin.json('POST', '/api/v1/links/bulk', { ids: [x.id], action: { type: 'removeTags', tags: ['massen'] } });
    expect((await t.admin.json('GET', `/api/v1/links/${x.id}`)).tags.map((tg: { name: string }) => tg.name)).toEqual(['b2']);
    expect((await t.admin.json('GET', `/api/v1/links/${y.id}`)).tags.map((tg: { name: string }) => tg.name)).toEqual(['b2', 'Massen']);

    const exp = new Date(Date.now() + 7 * 86400_000).toISOString();
    await t.admin.json('POST', '/api/v1/links/bulk', { ids: [x.id, y.id], action: { type: 'setExpiry', expiresAt: exp } });
    expect(Date.parse((await t.admin.json('GET', `/api/v1/links/${x.id}`)).expiresAt)).toBe(Math.floor(Date.parse(exp) / 1000) * 1000);

    const del = await t.admin.json('POST', '/api/v1/links/bulk', { ids: [x.id, y.id, 999999], action: { type: 'delete' } });
    expect(del.ok).toBe(1);
    expect(del.failed.map((f: { id: number }) => f.id).sort()).toEqual([y.id, 999999].sort());
    const del2 = await t.admin.json('POST', '/api/v1/links/bulk', { ids: [y.id], action: { type: 'delete' }, confirmProtected: true });
    expect(del2.ok).toBe(1);
    expect((await t.pub('/bulk-2')).statusCode).toBe(410);
  });

  it('ungültige Aktionen werden abgelehnt', async () => {
    expect((await t.admin.post('/api/v1/links/bulk', { ids: [1], action: { type: 'sprengen' } })).statusCode).toBe(400);
    expect((await t.admin.post('/api/v1/links/bulk', { ids: [], action: { type: 'enable' } })).statusCode).toBe(400);
  });
});

describe('Hilfen: Lookup, Slug-Prüfung, QR', () => {
  it('Lookup findet vorhandene Links zum gleichen Ziel', async () => {
    const l = await t.admin.createLink({ url: 'https://lookup.example/seite' });
    const r1 = await t.admin.json('GET', `/api/v1/lookup?url=${encodeURIComponent('lookup.example/seite')}`);
    expect(r1.items.map((x: { id: number }) => x.id)).toEqual([l.id]);
    const r2 = await t.admin.json('GET', `/api/v1/lookup?url=${encodeURIComponent('https://lookup.example/andere')}`);
    expect(r2.items).toEqual([]);
    expect((await t.admin.json('GET', '/api/v1/lookup?url=')).items).toEqual([]);
    expect((await t.admin.json('GET', '/api/v1/lookup?url=%3A%3A%3A')).items).toEqual([]);
  });

  it('Slug-Prüfung', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/check', slug: 'vergeben' });
    expect(await t.admin.json('GET', '/api/v1/slug/check?slug=frei-123')).toEqual({ slug: 'frei-123', available: true });
    const taken = await t.admin.json('GET', '/api/v1/slug/check?slug=VERGEBEN');
    expect(taken.available).toBe(false);
    expect(taken.reason).toContain('vergeben');
    expect((await t.admin.json('GET', `/api/v1/slug/check?slug=vergeben&exceptId=${l.id}`)).available).toBe(true);
    const reserved = await t.admin.json('GET', '/api/v1/slug/check?slug=api');
    expect(reserved.available).toBe(false);
    expect(reserved.reason).toContain('reserviert');
    expect((await t.admin.json('GET', '/api/v1/slug/check?slug=-x')).available).toBe(false);
  });

  it('QR als SVG und PNG mit ?qr im Inhalt', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/qr', slug: 'qr-code' });
    const opts = { errorCorrectionLevel: 'M' as const, margin: 4, color: { dark: '#18202bff', light: '#ffffffff' } };

    const svg = await t.admin.get(`/api/v1/links/${l.id}/qr`);
    expect(svg.statusCode).toBe(200);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    expect(svg.body).toContain('<svg');
    expect(svg.body).toBe(await QRCode.toString('https://go.test/qr-code?qr', { ...opts, type: 'svg' }));
    expect(svg.body).not.toBe(await QRCode.toString('https://go.test/qr-code', { ...opts, type: 'svg' }));

    const untracked = await t.admin.get(`/api/v1/links/${l.id}/qr?track=0`);
    expect(untracked.body).toBe(await QRCode.toString('https://go.test/qr-code', { ...opts, type: 'svg' }));

    const png = await t.admin.get(`/api/v1/links/${l.id}/qr?format=png&size=256&download=1`);
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['content-disposition']).toBe('attachment; filename="qr-go.test-qr-code.png"');
    expect(png.rawPayload.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.rawPayload.readUInt32BE(16)).toBe(256);
    expect(png.rawPayload.equals(await QRCode.toBuffer('https://go.test/qr-code?qr', { ...opts, type: 'png', width: 256 }))).toBe(true);

    expect((await t.admin.get(`/api/v1/links/${l.id}/qr?format=gif`)).statusCode).toBe(400);
    expect((await t.admin.get(`/api/v1/links/${l.id}/qr?dark=zzzzzz`)).statusCode).toBe(400);
    expect((await t.admin.get('/api/v1/links/999999/qr')).statusCode).toBe(404);
  });

  it('Vorschau-Abruf ist SSRF-geschützt', async () => {
    const res = await t.admin.json('POST', '/api/v1/preview', { url: 'http://127.0.0.1/' });
    expect(res.reachable).toBe(false);
    expect(res.error).toContain('geschütztes Netz');
    const meta = await t.admin.json('POST', '/api/v1/preview', { url: 'http://169.254.169.254/latest/meta-data/' });
    expect(meta.reachable).toBe(false);
  });

  it('Schlagwörter, Sammlungen und Kampagnen', async () => {
    const col = await t.admin.json('POST', '/api/v1/collections', { name: 'Presse', color: 'teal' }, 201);
    expect((await t.admin.post('/api/v1/collections', { name: 'Presse' })).statusCode).toBe(409);
    const l = await t.admin.createLink({ url: 'https://ziel.example/col', collectionId: col.id });
    expect(l.collection).toMatchObject({ id: col.id, name: 'Presse' });
    expect(ids(await t.admin.json('GET', `/api/v1/links?collectionId=${col.id}`))).toEqual([l.id]);
    const cols = await t.admin.json('GET', '/api/v1/collections');
    expect(cols.items.find((c: { id: number }) => c.id === col.id).count).toBe(1);
    await t.admin.json('DELETE', `/api/v1/collections/${col.id}`);
    expect((await t.admin.json('GET', `/api/v1/links/${l.id}`)).collection).toBeNull();
  });
});
