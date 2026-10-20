import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

/** Regressionstests für Befunde aus den unabhängigen Prüfungen. */

describe('Einstellungen: Änderung eines Feldes lässt alle anderen unberührt (Befund K1)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('setzt nur das übergebene Feld und löscht keine Detailstatistik', async () => {
    await t.admin.json('PATCH', '/api/v1/settings', { analyticsMode: 'off', blockedHosts: ['boese.example'], slugStyle: 'readable' });
    const after = await t.admin.json('PATCH', '/api/v1/settings', { organizationName: 'Neu' });
    expect(after.organizationName).toBe('Neu');
    expect(after.analyticsMode).toBe('off');
    expect(after.blockedHosts).toEqual(['boese.example']);
    expect(after.slugStyle).toBe('readable');
  });

  it('lehnt unbekannte Felder ab', async () => {
    await t.admin.json('PATCH', '/api/v1/settings', { gibtsNicht: 1 }, 400);
  });
});

describe('Reservierte Kurzadressen mit Schrägstrich lassen sich freigeben', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('DELETE mit %2F-kodierter Kurzadresse', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/k', slug: 'team/kalender' });
    await t.admin.json('DELETE', `/api/v1/links/${l.id}`);
    await t.admin.json('POST', '/api/v1/links', { url: 'https://x.example/', slug: 'team/kalender' }, 409);
    await t.admin.json('DELETE', `/api/v1/reserved/${l.domain.id}/${encodeURIComponent('team/kalender')}`);
    await t.admin.json('POST', '/api/v1/links', { url: 'https://x.example/', slug: 'team/kalender' }, 201);
  });
});

describe('Tessera-Anbindung gegen einen nachgebauten Tessera-Endpunkt', () => {
  let t: TestApp;
  let server: http.Server;
  const seen: { auth?: string; body?: Record<string, unknown>; path?: string }[] = [];
  let fail = false;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        seen.push({ auth: req.headers.authorization, body: data ? JSON.parse(data) : undefined, path: req.url });
        if (fail) {
          res.writeHead(403, { 'content-type': 'application/json' }).end('{"error":"Keine Berechtigung"}');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"abc123","name":"x"}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    t = await createTestApp({ config: { tessera: { url: `http://127.0.0.1:${port}`, token: 'tsr_test' } } });
  });
  afterAll(async () => {
    await t.close();
    server.close();
  });

  it('legt einen URL-Code mit dem Kurzlink (inkl. ?qr) an und liefert die Editor-Adresse', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/qr', slug: 'plakat' });
    const r = await t.admin.json('POST', `/api/v1/links/${l.id}/tessera`);
    expect(r.editorUrl).toMatch(/\/codes\/abc123$/);
    const call = seen.at(-1)!;
    expect(call.path).toBe('/api/codes');
    expect(call.auth).toBe('Bearer tsr_test');
    expect(call.body).toMatchObject({ type: 'url', content: { url: `${l.shortUrl}?qr` }, tags: ['Filum'] });
  });

  it('meldet Fehler von Tessera verständlich, ohne abzustürzen', async () => {
    fail = true;
    const l = await t.admin.createLink({ url: 'https://ziel.example/qr2', slug: 'plakat2' });
    const r = await t.admin.json('POST', `/api/v1/links/${l.id}/tessera`, undefined, 502);
    expect(r.error.message).toContain('HTTP 403');
  });
});

describe('404-Seite und Vertipper-Radar', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('schlägt auf internen Domains die ähnliche Kurzadresse vor', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/sem', slug: 'seminar' });
    const res = await t.pub('/semniar');
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Meinten Sie');
    expect(res.body).toContain('href="/seminar"');
  });

  it('macht auf öffentlichen Domains keinen Vorschlag', async () => {
    const id = t.defaultDomainId();
    t.ctx.db.prepare("UPDATE domains SET kind = 'public' WHERE id = ?").run(id);
    t.ctx.domains.reload();
    const res = await t.pub('/semniar');
    expect(res.body).not.toContain('Meinten Sie');
    t.ctx.db.prepare("UPDATE domains SET kind = 'internal' WHERE id = ?").run(id);
    t.ctx.domains.reload();
  });

  it('zählt Systempfade nicht als Vertipper', async () => {
    await t.pub('/api/v1/session');
    await t.pub('/.well-known/security.txt');
    await t.pub('/tippfehlr');
    t.ctx.stats.flush();
    const slugs = (t.ctx.db.prepare('SELECT slug FROM stats_unknown').all() as { slug: string }[]).map((r) => r.slug);
    expect(slugs).toContain('tippfehlr');
    expect(slugs.some((s) => s.startsWith('api') || s.startsWith('.well-known'))).toBe(false);
  });
});
