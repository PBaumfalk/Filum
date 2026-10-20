import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, location, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('Domains', () => {
  it('die Standarddomain aus DEFAULT_DOMAIN ist aktiv', async () => {
    const res = await t.admin.json('GET', '/api/v1/domains');
    expect(res.adminHost).toBe('admin.test');
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ host: 'go.test', kind: 'internal', status: 'active', isDefault: true, baseUrl: 'https://go.test' });
  });

  it('interne Domain ist sofort aktiv und beantwortet Kurzlinks', async () => {
    const d = await t.admin.json('POST', '/api/v1/domains', { host: 'HTTP://Intern.Test/', kind: 'internal', https: false }, 201);
    expect(d).toMatchObject({ host: 'intern.test', status: 'active', verifyMethod: 'admin', baseUrl: 'http://intern.test', isDefault: false });
    const l = await t.admin.createLink({ url: 'https://ziel.example/intern', slug: 'auf-intern', domainId: d.id });
    expect(l.shortUrl).toBe('http://intern.test/auf-intern');
    expect(location(await t.pub('/auf-intern', { headers: { host: 'intern.test' } }))).toBe('https://ziel.example/intern');
    // gleiche Kurzadresse auf anderer Domain ist ein anderer Link
    expect((await t.pub('/auf-intern')).statusCode).toBe(404);
    await t.admin.createLink({ url: 'https://ziel.example/go', slug: 'auf-intern' });
    expect(location(await t.pub('/auf-intern'))).toBe('https://ziel.example/go');
  });

  it('Admin-Host oder doppelte Domain → 409, ungültiger Host → 400', async () => {
    const admin = await t.admin.post('/api/v1/domains', { host: 'admin.test', kind: 'internal' });
    expect(admin.statusCode).toBe(409);
    expect(admin.json().error.field).toBe('host');
    expect((await t.admin.post('/api/v1/domains', { host: 'GO.test', kind: 'internal' })).statusCode).toBe(409);
    expect((await t.admin.post('/api/v1/domains', { host: 'user:pw@x.test', kind: 'internal' })).statusCode).toBe(400);
    expect((await t.admin.post('/api/v1/domains', { host: 'x.test', kind: 'irgendwas' })).statusCode).toBe(400);
  });

  it('öffentliche Domain bleibt bis zum Nachweis ausstehend und beantwortet keine Kurzlinks', async () => {
    const d = await t.admin.json('POST', '/api/v1/domains', { host: 'oeffentlich.test', kind: 'public' }, 201);
    expect(d.status).toBe('pending');
    expect(d.verifyToken).toMatch(/^filum-verify=/);
    await t.admin.createLink({ url: 'https://ziel.example/pending', slug: 'wartend', domainId: d.id });
    const res = await t.pub('/wartend', { headers: { host: 'oeffentlich.test' } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Unbekannte Adresse');

    const verify = await t.admin.post(`/api/v1/domains/${d.id}/verify`, { method: 'admin' });
    expect(verify.statusCode).toBe(400);
    expect(verify.json().error.code).toBe('verify_public');
    const activate = await t.admin.patch(`/api/v1/domains/${d.id}`, { status: 'active' });
    expect(activate.statusCode).toBe(400);
    expect((await t.pub('/wartend', { headers: { host: 'oeffentlich.test' } })).statusCode).toBe(404);

    // Nach erfolgreichem Nachweis (hier direkt gesetzt) antwortet die Domain
    t.ctx.domains.markVerified(d.id, 'dns');
    expect(location(await t.pub('/wartend', { headers: { host: 'oeffentlich.test' } }))).toBe('https://ziel.example/pending');
  });

  it('der Nachweis lässt sich nicht über „deaktivieren → aktivieren“ umgehen', async () => {
    const d = await t.admin.json('POST', '/api/v1/domains', { host: 'umweg.test', kind: 'public' }, 201);
    await t.admin.createLink({ url: 'https://ziel.example/umweg', slug: 'umweg', domainId: d.id });
    expect((await t.admin.json('PATCH', `/api/v1/domains/${d.id}`, { status: 'disabled' })).status).toBe('disabled');
    const res = await t.admin.patch(`/api/v1/domains/${d.id}`, { status: 'active' });
    expect(res.statusCode).toBe(400);
    expect(t.ctx.domains.get(d.id).status).not.toBe('active');
    expect((await t.pub('/umweg', { headers: { host: 'umweg.test' } })).statusCode).toBe(404);
  });

  it('Wechsel einer internen Domain auf „öffentlich“ verlangt einen neuen Nachweis', async () => {
    const d = await t.admin.json('POST', '/api/v1/domains', { host: 'wechsel.test', kind: 'internal' }, 201);
    await t.admin.createLink({ url: 'https://ziel.example/w', slug: 'wechsel', domainId: d.id });
    expect((await t.pub('/wechsel', { headers: { host: 'wechsel.test' } })).statusCode).toBe(302);
    // nicht im selben Schritt wieder aktiv setzen
    expect((await t.admin.patch(`/api/v1/domains/${d.id}`, { kind: 'public', status: 'active' })).statusCode).toBe(400);
    expect(t.ctx.domains.get(d.id)).toMatchObject({ kind: 'internal', status: 'active' });
    const u = await t.admin.json('PATCH', `/api/v1/domains/${d.id}`, { kind: 'public' });
    expect(u.status).toBe('pending');
    expect((await t.pub('/wechsel', { headers: { host: 'wechsel.test' } })).statusCode).toBe(404);
    // Zurück auf „intern“ macht sie nicht von selbst wieder aktiv
    const back = await t.admin.json('PATCH', `/api/v1/domains/${d.id}`, { kind: 'internal' });
    expect(back.status).toBe('pending');
    // interne Domains darf ein Admin bestätigen
    const v = await t.admin.json('POST', `/api/v1/domains/${d.id}/verify`, { method: 'admin' });
    expect(v.ok).toBe(true);
    expect(v.domain.status).toBe('active');
    expect((await t.pub('/wechsel', { headers: { host: 'wechsel.test' } })).statusCode).toBe(302);
  });

  it('PATCH: Start- und Fehlerseite, Vorschau-Suffix, Deaktivieren', async () => {
    const d = await t.admin.json('POST', '/api/v1/domains', { host: 'patch.test', kind: 'internal' }, 201);
    await t.admin.createLink({ url: 'https://ziel.example/p', slug: 'patch-link', domainId: d.id });
    const host = { host: 'patch.test' };

    const loop = await t.admin.patch(`/api/v1/domains/${d.id}`, { rootUrl: 'https://go.test/x' });
    expect(loop.statusCode).toBe(400);
    expect(loop.json().error.code).toBe('loop');
    expect((await t.admin.patch(`/api/v1/domains/${d.id}`, { notFoundUrl: 'javascript:alert(1)' })).statusCode).toBe(400);

    const u = await t.admin.json('PATCH', `/api/v1/domains/${d.id}`, { rootUrl: 'https://firma.example/', notFoundUrl: 'https://firma.example/404', previewSuffix: false });
    expect(u).toMatchObject({ rootUrl: 'https://firma.example/', notFoundUrl: 'https://firma.example/404', previewSuffix: false });
    expect(location(await t.pub('/', { headers: host }))).toBe('https://firma.example/');
    const nf = await t.pub('/gibt-es-nicht', { headers: host });
    expect(nf.statusCode).toBe(302);
    expect(location(nf)).toBe('https://firma.example/404');
    // ohne Vorschau-Suffix ist „/slug+“ keine Vorschau
    const prev = await t.pub('/patch-link+', { headers: host });
    expect(prev.statusCode).toBe(302);
    expect(location(prev)).toBe('https://firma.example/404');

    await t.admin.json('PATCH', `/api/v1/domains/${d.id}`, { rootUrl: null, notFoundUrl: null });
    expect((await t.pub('/', { headers: host })).statusCode).toBe(200);

    await t.admin.json('PATCH', `/api/v1/domains/${d.id}`, { status: 'disabled' });
    expect((await t.pub('/patch-link', { headers: host })).statusCode).toBe(404);
    const create = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/', domainId: d.id });
    expect(create.statusCode).toBe(400);
    expect(create.json().error.code).toBe('domain_disabled');
    await t.admin.json('PATCH', `/api/v1/domains/${d.id}`, { status: 'active' });
    expect((await t.pub('/patch-link', { headers: host })).statusCode).toBe(302);
  });

  it('Standarddomain wechseln', async () => {
    const d = await t.admin.json('POST', '/api/v1/domains', { host: 'standard.test', kind: 'internal', isDefault: true }, 201);
    expect(d.isDefault).toBe(true);
    const l = await t.admin.createLink({ url: 'https://ziel.example/std' });
    expect(l.domain.host).toBe('standard.test');
    const list = await t.admin.json('GET', '/api/v1/domains');
    expect(list.items.filter((x: { isDefault: boolean }) => x.isDefault).map((x: { host: string }) => x.host)).toEqual(['standard.test']);
    await t.admin.json('PATCH', `/api/v1/domains/${list.items.find((x: { host: string }) => x.host === 'go.test').id}`, { isDefault: true });
    expect((await t.admin.createLink({ url: 'https://ziel.example/std2' })).domain.host).toBe('go.test');
  });

  it('Löschen nur ohne Links', async () => {
    const d = await t.admin.json('POST', '/api/v1/domains', { host: 'loeschen.test', kind: 'internal' }, 201);
    const l = await t.admin.createLink({ url: 'https://ziel.example/l', slug: 'loesch', domainId: d.id });
    const res = await t.admin.del(`/api/v1/domains/${d.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toContain('1 Links');
    await t.admin.json('DELETE', `/api/v1/links/${l.id}`);
    // Reservierte (gelöschte) Kurzadressen würden mit der Domain frei: erst nach Freigabe löschbar
    const reserved = await t.admin.del(`/api/v1/domains/${d.id}`);
    expect(reserved.statusCode).toBe(409);
    expect(reserved.json().error.message).toContain('deaktivieren');
    await t.admin.json('DELETE', `/api/v1/reserved/${d.id}/loesch`);
    expect((await t.admin.del(`/api/v1/domains/${d.id}`)).statusCode).toBe(200);
    expect((await t.admin.json('GET', '/api/v1/domains')).items.map((x: { host: string }) => x.host)).not.toContain('loeschen.test');
    expect((await t.pub('/loesch', { headers: { host: 'loeschen.test' } })).statusCode).toBe(404);
    expect((await t.admin.del('/api/v1/domains/999999')).statusCode).toBe(404);
  });

  it('proxy-config liefert Bausteine mit Host, Port und Prüfwert', async () => {
    const d = await t.admin.json('POST', '/api/v1/domains', { host: 'proxy.test', kind: 'public' }, 201);
    const cfg = await t.admin.json('GET', `/api/v1/domains/${d.id}/proxy-config`);
    expect(cfg.caddy).toContain('proxy.test {');
    expect(cfg.caddy).toContain('reverse_proxy filum:8080');
    expect(cfg.nginx).toContain('server_name proxy.test;');
    expect(cfg.nginx).toContain('proxy_pass http://filum:8080;');
    expect(cfg.nginx).toContain('proxy_set_header Host $host;');
    expect(cfg.traefik).toContain('Host(`proxy.test`)');
    expect(cfg.dns.txt).toBe(`_filum-challenge.proxy.test. IN TXT "${d.verifyToken}"`);
    const editor = await t.createUser('editor');
    expect((await editor.get(`/api/v1/domains/${d.id}/proxy-config`)).statusCode).toBe(403);
  });

  it('Ziel auf eine eigene (neue) Domain gilt als Schleife', async () => {
    const res = await t.admin.post('/api/v1/links', { url: 'https://proxy.test/irgendwas' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('loop');
  });
});
