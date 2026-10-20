import fs from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, Client, PASSWORD, SETUP_CODE, createTestApp, location, makeDataDir, uniqueIp, type TestApp } from './helpers.js';

const dir = makeDataDir();
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Neustart mit demselben Datenverzeichnis', () => {
  let first: TestApp;
  const state: { linkId: number; domainId: number; instanceId: string; tokenSecret: string; userEmail: string; cookie: string } = {
    cookie: '',
    linkId: 0,
    domainId: 0,
    instanceId: '',
    tokenSecret: '',
    userEmail: 'bleibt@filum.test',
  };

  it('erster Lauf: Daten anlegen', async () => {
    first = await createTestApp({ dataDir: dir });
    const l = await first.admin.createLink({ url: 'https://persist.example/ziel', slug: 'persistent', title: 'Bleibt', tags: ['dauer'], redirectType: 301 });
    state.linkId = l.id;
    state.domainId = (await first.admin.json('POST', '/api/v1/domains', { host: 'zweite.test', kind: 'internal', https: false }, 201)).id;
    await first.admin.createLink({ url: 'https://persist.example/zweite', slug: 'auf-zweiter', domainId: state.domainId });
    await first.admin.json('PATCH', '/api/v1/settings', { organizationName: 'Beispiel GmbH', defaultRedirectType: 307, blockedHosts: ['boese.example'] });
    await first.admin.json('POST', '/api/v1/users', { email: state.userEmail, name: 'Bleibt', role: 'editor', password: PASSWORD }, 201);
    state.tokenSecret = (await first.admin.json('POST', '/api/v1/tokens', { name: 'dauer', scope: 'read' }, 201)).token;
    for (let i = 0; i < 3; i++) await first.pub('/persistent');
    state.instanceId = first.ctx.instanceId;
    state.cookie = first.admin.cookie!;
    // Kein expliziter Flush: close() schreibt ausstehende Zähler
    await first.close({ keepDir: true });
  });

  it('zweiter Lauf: alles ist noch da', async () => {
    const t = await createTestApp({ dataDir: dir });
    try {
      expect(t.ctx.instanceId).toBe(state.instanceId);
      // Setup ist erledigt und wird nicht erneut angeboten
      expect((await t.anon.json('GET', '/api/v1/session')).setupRequired).toBe(false);
      expect((await t.anon.post('/api/v1/setup', { code: SETUP_CODE, email: 'x@filum.test', name: 'X', password: PASSWORD })).statusCode).toBe(409);
      // Anmeldung mit Admin und weiterem Konto
      expect((await t.admin.json('GET', '/api/v1/session')).user.email).toBe(ADMIN_EMAIL);
      const editor = await t.login(state.userEmail);
      expect((await editor.json('GET', '/api/v1/session')).user.role).toBe('editor');
      expect((await t.anon.post('/api/v1/login', { email: state.userEmail, password: 'falsch-falsch' }, { remoteAddress: uniqueIp() })).statusCode).toBe(401);
      // Link mit allen Feldern
      const l = await t.admin.json('GET', `/api/v1/links/${state.linkId}`);
      expect(l).toMatchObject({ slug: 'persistent', title: 'Bleibt', url: 'https://persist.example/ziel', redirectType: 301, clicks: 3 });
      expect(l.tags.map((x: { name: string }) => x.name)).toEqual(['dauer']);
      // Weiterleitungen funktionieren (Cache ist leer, alles kommt aus der Datenbank)
      const r = await t.pub('/persistent');
      expect(r.statusCode).toBe(301);
      expect(location(r)).toBe('https://persist.example/ziel');
      expect(location(await t.pub('/auf-zweiter', { headers: { host: 'zweite.test' } }))).toBe('https://persist.example/zweite');
      // Domains
      const domains = (await t.admin.json('GET', '/api/v1/domains')).items.map((d: { host: string; status: string }) => `${d.host}:${d.status}`);
      expect(domains.sort()).toEqual(['go.test:active', 'zweite.test:active']);
      // Einstellungen
      const s = await t.admin.json('GET', '/api/v1/settings');
      expect(s).toMatchObject({ organizationName: 'Beispiel GmbH', defaultRedirectType: 307, blockedHosts: ['boese.example'], fetchPreviews: false });
      expect((await t.admin.createLink({ url: 'https://persist.example/neu' })).redirectType).toBe(307);
      expect((await t.admin.post('/api/v1/links', { url: 'https://boese.example/' })).statusCode).toBe(400);
      // Statistik: 3 Aufrufe aus dem ersten Lauf + 1 Aufruf eben (report() schreibt vorher)
      const stats = await t.admin.json('GET', `/api/v1/links/${state.linkId}/stats?range=24h`);
      expect(stats.totals.clicks).toBe(4);
      // Sitzung aus dem ersten Lauf gilt weiter
      const old = new Client(t.app, state.cookie);
      expect((await old.json('GET', '/api/v1/session')).user.email).toBe(ADMIN_EMAIL);
      // API-Token
      const tokenRes = await t.app.adminServer.inject({ url: '/api/v1/links', headers: { host: 'admin.test', authorization: `Bearer ${state.tokenSecret}` } });
      expect(tokenRes.statusCode).toBe(200);
      // Versionen und Protokoll
      expect((await t.admin.json('GET', `/api/v1/links/${state.linkId}/versions`)).items).toHaveLength(1);
      const audit = await t.admin.json('GET', '/api/v1/audit');
      expect(audit.items.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['setup.complete', 'link.create', 'domain.create', 'settings.update']));
    } finally {
      await t.close({ keepDir: true });
    }
  });

  it('dritter Lauf: Klicks nach dem Neustart werden zu den alten addiert', async () => {
    const t = await createTestApp({ dataDir: dir });
    try {
      await t.pub('/persistent');
      t.ctx.stats.flush();
      expect((await t.admin.json('GET', `/api/v1/links/${state.linkId}`)).clicks).toBe(5);
    } finally {
      await t.close({ keepDir: true });
    }
  });
});
