import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_HOST, SHORT_HOST, createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
  await t.admin.createLink({ url: 'https://ziel.example/', slug: 'vorhanden' });
});
afterAll(async () => {
  await t.close();
});

describe('öffentlicher Dienst kennt keine API', () => {
  it.each([
    ['GET', '/api/v1/links'],
    ['GET', '/api/v1/session'],
    ['GET', '/api/v1/openapi.json'],
    ['GET', '/api/v1/users'],
    ['GET', '/api/v1/backups'],
    ['POST', '/api/v1/login'],
    ['POST', '/api/v1/setup'],
    ['POST', '/api/v1/links'],
    ['PATCH', '/api/v1/settings'],
    ['DELETE', '/api/v1/links/1'],
  ] as const)('%s %s → normale 404-Seite', async (method, url) => {
    const res = await t.app.publicServer.inject({
      method,
      url,
      headers: { host: SHORT_HOST, cookie: `filum_session=${t.admin.cookie}`, 'x-filum': '1', 'content-type': 'application/json' },
      payload: method === 'GET' ? undefined : JSON.stringify({ email: 'admin@filum.test', password: 'x' }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Link nicht gefunden');
    expect(() => JSON.parse(res.body)).toThrow();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('auch mit dem Host der Verwaltung liefert der öffentliche Dienst keine Verwaltung', async () => {
    const res = await t.app.publicServer.inject({ method: 'GET', url: '/api/v1/session', headers: { host: ADMIN_HOST } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Unbekannte Adresse');
    const root = await t.app.publicServer.inject({ method: 'GET', url: '/', headers: { host: ADMIN_HOST } });
    expect(root.statusCode).toBe(404);
  });

  it('die Kurzadresse „api“ ist reserviert', async () => {
    const res = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/', slug: 'api' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('reserved');
  });
});

describe('Verwaltungsdienst antwortet nicht für Kurzlink-Domains', () => {
  it.each([
    ['GET', '/api/v1/session'],
    ['GET', '/'],
    ['POST', '/api/v1/login'],
    ['GET', '/vorhanden'],
  ] as const)('%s %s mit Host go.test → 421', async (method, url) => {
    const res = await t.app.adminServer.inject({
      method,
      url,
      headers: { host: SHORT_HOST, 'x-filum': '1', 'content-type': 'application/json' },
      payload: method === 'POST' ? JSON.stringify({ email: 'admin@filum.test', password: 'Sicheres-Passwort-42' }) : undefined,
    });
    expect(res.statusCode).toBe(421);
    expect(res.body).toContain('Kurzlink-Domain');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('auch mit Port und Großschreibung sowie für neu angelegte Domains', async () => {
    expect((await t.app.adminServer.inject({ url: '/api/v1/session', headers: { host: 'GO.TEST' } })).statusCode).toBe(421);
    await t.admin.json('POST', '/api/v1/domains', { host: 'kurz.test', kind: 'internal' }, 201);
    expect((await t.app.adminServer.inject({ url: '/api/v1/session', headers: { host: 'kurz.test' } })).statusCode).toBe(421);
  });

  it('healthz bleibt erreichbar, die Verwaltung unter ihrem Host ebenfalls', async () => {
    expect((await t.app.adminServer.inject({ url: '/healthz', headers: { host: SHORT_HOST } })).statusCode).toBe(200);
    const ok = await t.admin.get('/api/v1/session');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe('admin@filum.test');
  });

  it('unbekannte API-Pfade liefern JSON-404', async () => {
    const res = await t.admin.get('/api/v1/gibt-es-nicht');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('Verwaltung setzt Sicherheitsheader und no-store für die API', async () => {
    const res = await t.admin.get('/api/v1/links');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
