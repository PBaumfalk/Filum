import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, PASSWORD, SETUP_CODE, createTestApp, uniqueIp, type TestApp } from './helpers.js';

describe('Ersteinrichtung', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ setup: false });
  });
  afterAll(async () => {
    await t.close();
  });

  it('meldet, dass die Einrichtung aussteht, und verweigert alles andere', async () => {
    const s = await t.anon.json('GET', '/api/v1/session');
    expect(s.setupRequired).toBe(true);
    expect(s.user).toBeNull();
    expect((await t.anon.get('/api/v1/links')).statusCode).toBe(401);
  });

  it('falscher Code → 403, kein Konto', async () => {
    const res = await t.anon.post('/api/v1/setup', { code: '999-999-999', email: ADMIN_EMAIL, name: 'A', password: PASSWORD }, { remoteAddress: uniqueIp() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('setup_code');
    expect(t.ctx.auth.userCount()).toBe(0);
  });

  it('ohne CSRF-Header → 403', async () => {
    const res = await t.anon.post('/api/v1/setup', { code: SETUP_CODE, email: ADMIN_EMAIL, name: 'A', password: PASSWORD }, { noCsrf: true });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf');
    expect(t.ctx.auth.userCount()).toBe(0);
  });

  it('schwaches Passwort wird abgelehnt', async () => {
    const res = await t.anon.post('/api/v1/setup', { code: SETUP_CODE, email: ADMIN_EMAIL, name: 'A', password: 'kurz' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('weak_password');
    expect(t.ctx.auth.userCount()).toBe(0);
  });

  it('richtiger Code (auch ohne Bindestriche) legt den Admin an und meldet an', async () => {
    const res = await t.anon.post('/api/v1/setup', { code: SETUP_CODE.replace(/-/g, ' '), email: ADMIN_EMAIL, name: 'Admin', password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ email: ADMIN_EMAIL, role: 'admin' });
    const cookie = res.cookies.find((c) => c.name === 'filum_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    const s = await t.app.adminServer.inject({ url: '/api/v1/session', headers: { host: 'admin.test', cookie: `filum_session=${cookie!.value}` } });
    expect(s.json().user.email).toBe(ADMIN_EMAIL);
    expect(s.json().setupRequired).toBe(false);
  });

  it('ein zweites Setup ist nicht möglich – auch nicht mit richtigem Code', async () => {
    const res = await t.anon.post('/api/v1/setup', { code: SETUP_CODE, email: 'zweiter@filum.test', name: 'B', password: PASSWORD });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('setup_done');
    expect(t.ctx.auth.userCount()).toBe(1);
    expect(t.ctx.db.prepare("SELECT value FROM meta WHERE key = 'setup_code'").get()).toBeUndefined();
  });
});

describe('Anmeldung, Sitzungen, CSRF und Tokens', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('falsches Passwort → 401, richtiges → 200 mit Cookie', async () => {
    const ip = uniqueIp();
    const bad = await t.anon.post('/api/v1/login', { email: ADMIN_EMAIL, password: 'falsch-falsch' }, { remoteAddress: ip });
    expect(bad.statusCode).toBe(401);
    expect(bad.headers['set-cookie']).toBeUndefined();
    const unknown = await t.anon.post('/api/v1/login', { email: 'niemand@filum.test', password: PASSWORD }, { remoteAddress: ip });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe(bad.json().error.message);
    const ok = await t.anon.post('/api/v1/login', { email: ' Admin@Filum.test ', password: PASSWORD }, { remoteAddress: ip });
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies.some((c) => c.name === 'filum_session')).toBe(true);
  });

  it('drosselt nach mehreren Fehlversuchen (auch für das richtige Passwort)', async () => {
    const victim = await t.createUser('member');
    const email = (await victim.json('GET', '/api/v1/session')).user.email as string;
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) {
      expect((await t.anon.post('/api/v1/login', { email, password: `falsch-${i}` }, { remoteAddress: ip })).statusCode).toBe(401);
    }
    const blocked = await t.anon.post('/api/v1/login', { email, password: PASSWORD }, { remoteAddress: ip });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('throttled');
    // Sperre gilt je Konto, auch von einer anderen Adresse aus
    const otherIp = await t.anon.post('/api/v1/login', { email, password: PASSWORD }, { remoteAddress: uniqueIp() });
    expect(otherIp.statusCode).toBe(429);
    // andere Konten sind nicht betroffen
    expect((await t.anon.post('/api/v1/login', { email: ADMIN_EMAIL, password: PASSWORD }, { remoteAddress: uniqueIp() })).statusCode).toBe(200);
  });

  it('Abmelden beendet die Sitzung', async () => {
    const c = await t.login(ADMIN_EMAIL);
    expect((await c.get('/api/v1/links')).statusCode).toBe(200);
    expect((await c.post('/api/v1/logout')).statusCode).toBe(200);
    expect((await c.get('/api/v1/links')).statusCode).toBe(401);
  });

  it('ungültiges Cookie gilt als nicht angemeldet', async () => {
    const res = await t.app.adminServer.inject({ url: '/api/v1/links', headers: { host: 'admin.test', cookie: 'filum_session=erfunden' } });
    expect(res.statusCode).toBe(401);
  });

  it('schreibende Anfrage ohne x-filum → 403 (CSRF)', async () => {
    const res = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/csrf' }, { noCsrf: true });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('csrf');
    const wrongValue = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/csrf' }, { noCsrf: true, headers: { 'x-filum': 'yes' } });
    expect(wrongValue.statusCode).toBe(403);
    for (const [m, u] of [
      ['PATCH', '/api/v1/settings'],
      ['DELETE', '/api/v1/links/1'],
      ['POST', '/api/v1/logout'],
    ] as const) {
      expect((await t.admin.req(m, u, {}, { noCsrf: true })).statusCode, `${m} ${u}`).toBe(403);
    }
    const list = await t.admin.json('GET', '/api/v1/links?q=csrf');
    expect(list.total).toBe(0);
  });

  it('fremder Origin → 403, eigener Origin → erlaubt', async () => {
    const evil = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/origin' }, { headers: { origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
    const sub = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/origin' }, { headers: { origin: 'http://admin.test.evil.example' } });
    expect(sub.statusCode).toBe(403);
    const nul = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/origin' }, { headers: { origin: 'null' } });
    expect(nul.statusCode).toBe(403);
    const own = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/origin' }, { headers: { origin: 'http://admin.test' } });
    expect(own.statusCode).toBe(201);
  });

  it('API-Token funktioniert per Bearer ohne CSRF-Header', async () => {
    const tok = await t.tokenClient('write');
    expect(tok.token).toMatch(/^flm_/);
    const res = await tok.post('/api/v1/links', { url: 'https://ziel.example/token', slug: 'per-token' });
    expect(res.statusCode).toBe(201);
    expect(res.json().owner.id).toBe(t.admin.userId);
    // Token dürfen keine Tokens erzeugen und keine Passwörter ändern
    expect((await tok.post('/api/v1/tokens', { name: 'x', scope: 'read' })).statusCode).toBe(403);
    expect((await tok.post('/api/v1/me/password', { current: PASSWORD, next: 'Noch-Sichereres-PW-1' })).statusCode).toBe(403);
    // write-Token eines Admins reicht nicht für Admin-Aufgaben
    expect((await tok.patch('/api/v1/settings', { organizationName: 'X' })).statusCode).toBe(403);
    expect((await tok.get('/api/v1/backups')).statusCode).toBe(403);
    const adminTok = await t.tokenClient('admin');
    expect((await adminTok.patch('/api/v1/settings', { organizationName: 'Per Token' })).statusCode).toBe(200);
  });

  it('read-Token darf lesen, aber nicht schreiben', async () => {
    const tok = await t.tokenClient('read');
    expect((await tok.get('/api/v1/links')).statusCode).toBe(200);
    const res = await tok.post('/api/v1/links', { url: 'https://ziel.example/read' });
    expect(res.statusCode).toBe(403);
    const someLink = (await t.admin.createLink({ url: 'https://ziel.example/r' })).id;
    expect((await tok.patch(`/api/v1/links/${someLink}`, { title: 'x' })).statusCode).toBe(403);
    expect((await tok.del(`/api/v1/links/${someLink}`)).statusCode).toBe(403);
    expect((await tok.post(`/api/v1/links/${someLink}/favorite`, { favorite: true })).statusCode).toBe(403);
  });

  it('widerrufenes, falsches oder kaputtes Token → 401', async () => {
    const tok = await t.tokenClient('write');
    const tokens = await t.admin.json('GET', '/api/v1/tokens');
    const id = tokens.items[0].id;
    expect(tokens.items[0]).not.toHaveProperty('token_hash');
    expect((await tok.get('/api/v1/links')).statusCode).toBe(200);
    await t.admin.json('DELETE', `/api/v1/tokens/${id}`);
    expect((await tok.get('/api/v1/links')).statusCode).toBe(401);
    const bad = await t.app.adminServer.inject({ url: '/api/v1/links', headers: { host: 'admin.test', authorization: 'Bearer flm_erfunden' } });
    expect(bad.statusCode).toBe(401);
    const basic = await t.app.adminServer.inject({ url: '/api/v1/links', headers: { host: 'admin.test', authorization: 'Basic YTpi' } });
    expect(basic.statusCode).toBe(401);
    // Ein falsches Token wird nicht durch ein gültiges Cookie „gerettet“
    const mixed = await t.app.adminServer.inject({
      url: '/api/v1/links',
      headers: { host: 'admin.test', authorization: 'Bearer flm_erfunden', cookie: `filum_session=${t.admin.cookie}` },
    });
    expect(mixed.statusCode).toBe(401);
  });

  it('abgelaufene Tokens gelten nicht', async () => {
    const tok = await t.tokenClient('read');
    t.ctx.db.prepare('UPDATE api_tokens SET expires_at = 1 WHERE token_hash = (SELECT token_hash FROM api_tokens ORDER BY id DESC LIMIT 1)').run();
    expect((await tok.get('/api/v1/links')).statusCode).toBe(401);
  });
});

describe('Rollen und Berechtigungen', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('viewer darf ansehen, aber nichts anlegen oder ändern', async () => {
    const viewer = await t.createUser('viewer');
    const adminLink = await t.admin.createLink({ url: 'https://ziel.example/v' });
    expect((await viewer.get('/api/v1/links')).statusCode).toBe(200);
    expect((await viewer.get(`/api/v1/links/${adminLink.id}`)).json().canEdit).toBe(false);
    expect((await viewer.post('/api/v1/links', { url: 'https://ziel.example/viewer' })).statusCode).toBe(403);
    expect((await viewer.post('/api/v1/links/batch', { urls: ['https://ziel.example/viewer'] })).statusCode).toBe(403);
    expect((await viewer.patch(`/api/v1/links/${adminLink.id}`, { title: 'x' })).statusCode).toBe(403);
    expect((await viewer.post('/api/v1/tags', { name: 'neu' })).statusCode).toBe(403);
    // Favoriten sind persönlich und auch für viewer erlaubt
    expect((await viewer.post(`/api/v1/links/${adminLink.id}/favorite`, { favorite: true })).statusCode).toBe(200);
    // viewer bekommt nur lesende Tokens
    expect((await viewer.post('/api/v1/tokens', { name: 'w', scope: 'write' })).statusCode).toBe(403);
    expect((await viewer.post('/api/v1/tokens', { name: 'r', scope: 'read' })).statusCode).toBe(201);
  });

  it('member bearbeitet nur eigene Links', async () => {
    const member = await t.createUser('member');
    const other = await t.createUser('member');
    const own = await member.createLink({ url: 'https://ziel.example/m', slug: 'member-eigen' });
    expect(own.canEdit).toBe(true);
    const foreign = await other.createLink({ url: 'https://ziel.example/o', slug: 'member-fremd' });
    const adminLink = await t.admin.createLink({ url: 'https://ziel.example/a' });

    expect((await member.patch(`/api/v1/links/${own.id}`, { title: 'Meins' })).statusCode).toBe(200);
    expect((await member.patch(`/api/v1/links/${foreign.id}`, { title: 'Fremd' })).statusCode).toBe(403);
    expect((await member.patch(`/api/v1/links/${adminLink.id}`, { url: 'https://boese.example/' })).statusCode).toBe(403);
    expect((await member.del(`/api/v1/links/${adminLink.id}`)).statusCode).toBe(403);
    expect((await member.del(`/api/v1/stats`)).statusCode).toBe(403);
    expect((await member.req('DELETE', `/api/v1/links/${adminLink.id}/stats`)).statusCode).toBe(403);
    const list = await member.json('GET', `/api/v1/links?owner=me`);
    expect(list.items.map((l: { id: number }) => l.id)).toEqual([own.id]);
    // keine Links für andere anlegen, nicht übertragen
    expect((await member.post('/api/v1/links', { url: 'https://ziel.example/x', ownerId: t.admin.userId })).statusCode).toBe(403);
    expect((await member.patch(`/api/v1/links/${own.id}`, { ownerId: t.admin.userId })).statusCode).toBe(403);
    // Bulk: fremde Links schlagen einzeln fehl
    const bulk = await member.json('POST', '/api/v1/links/bulk', { ids: [own.id, adminLink.id], action: { type: 'disable' } });
    expect(bulk.ok).toBe(1);
    expect(bulk.failed.map((f: { id: number }) => f.id)).toEqual([adminLink.id]);
    expect((await t.admin.json('GET', `/api/v1/links/${adminLink.id}`)).enabled).toBe(true);
    // member darf keine Konten sehen
    expect((await member.get('/api/v1/users')).statusCode).toBe(403);
    expect((await member.post('/api/v1/collections', { name: 'x' })).statusCode).toBe(403);
  });

  it('editor bearbeitet alle Links, verwaltet aber keine Domains, Konten oder Einstellungen', async () => {
    const editor = await t.createUser('editor');
    const adminLink = await t.admin.createLink({ url: 'https://ziel.example/e' });
    expect((await editor.patch(`/api/v1/links/${adminLink.id}`, { title: 'Von Redaktion' })).statusCode).toBe(200);
    expect((await editor.post('/api/v1/collections', { name: 'Redaktion' })).statusCode).toBe(201);
    expect((await editor.get('/api/v1/users')).statusCode).toBe(200);
    expect((await editor.get('/api/v1/users')).json().invites).toEqual([]);
    expect((await editor.post('/api/v1/domains', { host: 'red.test', kind: 'internal' })).statusCode).toBe(403);
    expect((await editor.patch(`/api/v1/domains/${t.defaultDomainId()}`, { note: 'x' })).statusCode).toBe(403);
    expect((await editor.patch('/api/v1/settings', { organizationName: 'Redaktion' })).statusCode).toBe(403);
    expect((await editor.post('/api/v1/users', { email: 'x@filum.test', role: 'admin', password: PASSWORD })).statusCode).toBe(403);
    expect((await editor.post('/api/v1/invites', { email: 'x@filum.test', role: 'admin' })).statusCode).toBe(403);
    expect((await editor.get('/api/v1/backups')).statusCode).toBe(403);
    expect((await editor.post('/api/v1/backups')).statusCode).toBe(403);
    expect((await editor.get('/api/v1/audit')).statusCode).toBe(403);
    expect((await editor.post('/api/v1/tokens', { name: 'a', scope: 'admin' })).statusCode).toBe(403);
    expect((await editor.del('/api/v1/stats')).statusCode).toBe(403);
    expect(t.ctx.settings.get().organizationName).toBe('');
  });

  it('admin verwaltet Konten; Rollen wirken sofort', async () => {
    const u = await t.admin.json('POST', '/api/v1/users', { email: 'wechsel@filum.test', name: 'W', role: 'viewer', password: PASSWORD }, 201);
    const c = await t.login('wechsel@filum.test');
    expect((await c.post('/api/v1/links', { url: 'https://ziel.example/w' })).statusCode).toBe(403);
    await t.admin.json('PATCH', `/api/v1/users/${u.id}`, { role: 'member' });
    expect((await c.post('/api/v1/links', { url: 'https://ziel.example/w' })).statusCode).toBe(201);
    // Sperren beendet die Sitzung
    await t.admin.json('PATCH', `/api/v1/users/${u.id}`, { disabled: true });
    expect((await c.get('/api/v1/links')).statusCode).toBe(401);
    expect((await t.anon.post('/api/v1/login', { email: 'wechsel@filum.test', password: PASSWORD }, { remoteAddress: uniqueIp() })).statusCode).toBe(401);
    // doppelte E-Mail
    expect((await t.admin.post('/api/v1/users', { email: 'WECHSEL@filum.test', role: 'viewer', password: PASSWORD })).statusCode).toBe(409);
  });

  it('letzter Admin kann sich nicht selbst degradieren, sperren oder löschen', async () => {
    const me = t.admin.userId;
    expect((await t.admin.patch(`/api/v1/users/${me}`, { role: 'editor' })).statusCode).toBe(403);
    expect((await t.admin.patch(`/api/v1/users/${me}`, { disabled: true })).statusCode).toBe(403);
    expect((await t.admin.del(`/api/v1/users/${me}`)).statusCode).toBe(403);
    expect((await t.admin.json('GET', '/api/v1/session')).user.role).toBe('admin');
    // Auf Dienstebene: ohne zweiten aktiven Admin kein Herabstufen
    const editor = await t.admin.json('POST', '/api/v1/users', { email: 'nicht-admin@filum.test', name: 'N', role: 'editor', password: PASSWORD }, 201);
    expect(() => t.ctx.auth.updateUser(me, { role: 'editor' }, editor.id)).toThrow(/mindestens ein aktiver Admin/);
    expect(() => t.ctx.auth.deleteUser(me, editor.id)).toThrow(/mindestens ein aktiver Admin/);
  });

  it('mit zweitem Admin darf der erste herabgestuft werden', async () => {
    const second = await t.admin.json('POST', '/api/v1/users', { email: 'admin2@filum.test', name: 'A2', role: 'admin', password: PASSWORD }, 201);
    const a2 = await t.login('admin2@filum.test');
    const r = await a2.patch(`/api/v1/users/${t.admin.userId}`, { role: 'editor' });
    expect(r.statusCode).toBe(200);
    expect(r.json().role).toBe('editor');
    // jetzt ist admin2 der letzte Admin und kann sich nicht selbst degradieren
    expect((await a2.patch(`/api/v1/users/${second.id}`, { role: 'member' })).statusCode).toBe(403);
    // zurück
    await a2.json('PATCH', `/api/v1/users/${t.admin.userId}`, { role: 'admin' });
  });

  it('Einladung erzeugen und annehmen', async () => {
    const inv = await t.admin.json('POST', '/api/v1/invites', { email: 'Neu@Filum.test', role: 'editor' }, 201);
    expect(inv.url).toMatch(/^http:\/\/admin\.test\/einladung\//);
    const token = inv.url.split('/').pop() as string;
    const users = await t.admin.json('GET', '/api/v1/users');
    expect(users.invites.map((i: { email: string }) => i.email)).toContain('neu@filum.test');

    const info = await t.anon.json('GET', `/api/v1/invites/${token}`);
    expect(info).toEqual({ email: 'neu@filum.test', role: 'editor' });
    const weak = await t.anon.post(`/api/v1/invites/${token}/accept`, { name: 'Neu', password: 'kurz' });
    expect(weak.statusCode).toBe(400);
    const res = await t.anon.post(`/api/v1/invites/${token}/accept`, { name: 'Neue Person', password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ email: 'neu@filum.test', role: 'editor', name: 'Neue Person' });
    expect(res.cookies.some((c) => c.name === 'filum_session')).toBe(true);
    // nur einmal verwendbar
    expect((await t.anon.get(`/api/v1/invites/${token}`)).statusCode).toBe(404);
    expect((await t.anon.post(`/api/v1/invites/${token}/accept`, { name: 'X', password: PASSWORD })).statusCode).toBe(400);
    expect((await t.anon.get('/api/v1/invites/erfunden')).statusCode).toBe(404);
    // Anmeldung mit dem neuen Konto
    const c = await t.login('neu@filum.test');
    expect((await c.json('GET', '/api/v1/session')).user.role).toBe('editor');
    // Einladung für vorhandenes Konto
    expect((await t.admin.post('/api/v1/invites', { email: 'neu@filum.test', role: 'viewer' })).statusCode).toBe(409);
  });

  it('zurückgezogene Einladung ist ungültig', async () => {
    const inv = await t.admin.json('POST', '/api/v1/invites', { email: 'zurueck@filum.test', role: 'viewer' }, 201);
    const token = inv.url.split('/').pop() as string;
    const id = (await t.admin.json('GET', '/api/v1/users')).invites.find((i: { email: string }) => i.email === 'zurueck@filum.test').id;
    await t.admin.json('DELETE', `/api/v1/invites/${id}`);
    expect((await t.anon.get(`/api/v1/invites/${token}`)).statusCode).toBe(404);
  });

  it('Passwort ändern beendet andere Sitzungen', async () => {
    await t.admin.json('POST', '/api/v1/users', { email: 'pw@filum.test', name: 'P', role: 'member', password: PASSWORD }, 201);
    const a = await t.login('pw@filum.test');
    const b = await t.login('pw@filum.test');
    expect((await a.post('/api/v1/me/password', { current: 'falsch', next: 'Neues-Passwort-77' })).statusCode).toBe(400);
    expect((await a.post('/api/v1/me/password', { current: PASSWORD, next: 'Neues-Passwort-77' })).statusCode).toBe(200);
    expect((await a.get('/api/v1/links')).statusCode).toBe(200);
    expect((await b.get('/api/v1/links')).statusCode).toBe(401);
    await t.login('pw@filum.test', 'Neues-Passwort-77');
  });
});
