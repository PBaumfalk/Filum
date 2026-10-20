import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOCUMENTED_ROUTES } from '../src/server/admin/openapi.js';
import { createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
  await t.app.adminServer.ready();
});
afterAll(async () => {
  await t.close();
});

/** Nur echte API-Routen: ohne automatisch erzeugte HEAD-Routen und ohne die Sammel-404 */
function apiRoutes(): string[] {
  return [...new Set(t.app.adminServer.registeredRoutes)]
    .filter((r) => r.split(' ')[1].startsWith('/api/v1'))
    .filter((r) => !r.startsWith('HEAD '))
    .sort();
}

describe('OpenAPI-Beschreibung', () => {
  it('erfasst die registrierten Routen', () => {
    const routes = apiRoutes();
    expect(routes.length).toBeGreaterThan(50);
    expect(routes).toContain('GET /api/v1/links');
    expect(routes).toContain('POST /api/v1/links/:id/versions/:versionId/restore');
    expect(t.app.adminServer.registeredRoutes).toContain('GET /api/*');
  });

  it('jede registrierte /api/v1-Route ist dokumentiert', () => {
    const documented = new Set(DOCUMENTED_ROUTES);
    const missing = apiRoutes().filter((r) => !documented.has(r));
    expect(missing).toEqual([]);
  });

  it('jede dokumentierte Route existiert (OIDC nur, wenn eingerichtet)', () => {
    const registered = new Set(apiRoutes());
    const stale = DOCUMENTED_ROUTES.filter((r) => !registered.has(r) && !r.includes('/auth/oidc/'));
    expect(stale).toEqual([]);
  });

  it('openapi.json ist öffentlich lesbar und vollständig', async () => {
    const res = await t.anon.get('/api/v1/openapi.json');
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.servers).toEqual([{ url: 'http://admin.test' }]);
    const ops = Object.entries(spec.paths as Record<string, Record<string, unknown>>).flatMap(([p, o]) =>
      Object.keys(o).map((m) => `${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`),
    );
    expect(ops.sort()).toEqual([...DOCUMENTED_ROUTES].sort());
    // Pfadparameter sind beschrieben
    const restore = spec.paths['/api/v1/links/{id}/versions/{versionId}/restore'].post;
    expect(restore.parameters.map((p: { name: string }) => p.name)).toEqual(['id', 'versionId']);
  });
});
