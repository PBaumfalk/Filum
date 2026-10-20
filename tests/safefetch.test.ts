import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchBlockedError, classifyAddress, resolveTarget, safeFetch, type FetchPolicy } from '../src/server/lib/safefetch.js';

const strict: FetchPolicy = { allowHosts: [], allowPrivate: false, timeoutMs: 2000, userAgent: 'Filum-Test' };
const local: FetchPolicy = { ...strict, allowHosts: ['127.0.0.1'] };

async function blocked(p: Promise<unknown>): Promise<FetchBlockedError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(FetchBlockedError);
    return e as FetchBlockedError;
  }
  throw new Error('Abruf wurde nicht blockiert');
}

describe('classifyAddress', () => {
  it.each([
    ['127.0.0.1', 'blocked'],
    ['127.255.0.9', 'blocked'],
    ['::1', 'blocked'],
    ['::', 'blocked'],
    ['0.0.0.0', 'blocked'],
    ['169.254.169.254', 'blocked'],
    ['fe80::1', 'blocked'],
    ['224.0.0.1', 'blocked'],
    ['::ffff:127.0.0.1', 'blocked'],
    ['::ffff:7f00:1', 'blocked'],
    ['::FFFF:A9FE:A9FE', 'blocked'],
    ['64:ff9b::a9fe:a9fe', 'blocked'],
    ['64:ff9b::169.254.169.254', 'blocked'],
    ['10.0.0.1', 'private'],
    ['10.255.255.255', 'private'],
    ['172.16.5.4', 'private'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'private'],
    ['fc00::', 'private'],
    ['fd12:3456::1', 'private'],
    ['::ffff:10.1.2.3', 'private'],
    ['::ffff:c0a8:101', 'private'],
    ['8.8.8.8', 'public'],
    ['93.184.216.34', 'public'],
    ['2606:4700:4700::1111', 'public'],
    ['::ffff:8.8.8.8', 'public'],
    ['kein-ip', 'blocked'],
    ['', 'blocked'],
  ])('%s → %s', (ip, expected) => {
    expect(classifyAddress(ip)).toBe(expected);
  });
});

describe('resolveTarget', () => {
  it.each([
    ['http://localhost/'],
    ['http://LOCALHOST:8080/admin'],
    ['http://127.0.0.1/'],
    ['http://127.1/'],
    ['http://2130706433/'],
    ['http://0x7f000001/'],
    ['http://[::1]/'],
    ['http://[::ffff:127.0.0.1]/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://[64:ff9b::a9fe:a9fe]/'],
    ['http://0.0.0.0/'],
  ])('lehnt %s ab', async (url) => {
    const e = await blocked(resolveTarget(url, strict));
    expect(e.reason).toBe('address');
  });

  it('lehnt private Netze ohne Freigabe ab und erlaubt sie mit allowPrivate', async () => {
    expect((await blocked(resolveTarget('http://10.0.0.5/', strict))).reason).toBe('address');
    expect((await blocked(resolveTarget('http://192.168.0.10/', strict))).reason).toBe('address');
    const t = await resolveTarget('http://10.0.0.5/', { ...strict, allowPrivate: true });
    expect(t.address).toBe('10.0.0.5');
    // Loopback bleibt auch mit allowPrivate gesperrt
    expect((await blocked(resolveTarget('http://127.0.0.1/', { ...strict, allowPrivate: true }))).reason).toBe('address');
    expect((await blocked(resolveTarget('http://169.254.169.254/', { ...strict, allowPrivate: true }))).reason).toBe('address');
  });

  it('akzeptiert gesperrte Ziele nur mit ausdrücklicher Freigabe', async () => {
    const t = await resolveTarget('http://127.0.0.1:9999/x', local);
    expect(t.address).toBe('127.0.0.1');
    expect(t.family).toBe(4);
    const viaName = await resolveTarget('http://localhost/', { ...strict, allowHosts: ['localhost'] });
    expect(['127.0.0.1', '::1']).toContain(viaName.address);
    const meta = await resolveTarget('http://169.254.169.254/', { ...strict, allowHosts: ['169.254.0.0/16'] });
    expect(meta.address).toBe('169.254.169.254');
    // Freigabe für 127.0.0.1 gilt nicht für die Metadaten-Adresse
    expect((await blocked(resolveTarget('http://169.254.169.254/', local))).reason).toBe('address');
  });

  it('prüft Schema, Zugangsdaten und Ports', async () => {
    expect((await blocked(resolveTarget('ftp://8.8.8.8/', strict))).reason).toBe('scheme');
    expect((await blocked(resolveTarget('file:///etc/passwd', strict))).reason).toBe('scheme');
    expect((await blocked(resolveTarget('http://u:p@8.8.8.8/', strict))).reason).toBe('scheme');
    expect((await blocked(resolveTarget('kaputt', strict))).reason).toBe('scheme');
    expect((await blocked(resolveTarget('http://8.8.8.8:22/', strict))).reason).toBe('port');
    expect((await blocked(resolveTarget('http://8.8.8.8:6379/', strict))).reason).toBe('port');
    const ok = await resolveTarget('https://8.8.8.8:8443/', strict);
    expect(ok.url.port).toBe('8443');
  });
});

describe('safeFetch gegen einen lokalen Testserver', () => {
  let server: http.Server;
  let port = 0;
  const hits: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      const base = `http://127.0.0.1:${port}`;
      switch (req.url) {
        case '/ok':
          res.writeHead(200, { 'content-type': 'text/plain' }).end('hallo');
          return;
        case '/metadaten':
          res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
          return;
        case '/metadaten-nat64':
          res.writeHead(302, { location: 'http://[64:ff9b::a9fe:a9fe]/' }).end();
          return;
        case '/mapped':
          res.writeHead(302, { location: `http://[::ffff:127.0.0.1]:${port}/ok` }).end();
          return;
        case '/lokal':
          res.writeHead(302, { location: `${base}/ok` }).end();
          return;
        case '/relativ':
          res.writeHead(301, { location: '/ok' }).end();
          return;
        case '/gross':
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          res.end(Buffer.alloc(200_000, 0x61));
          return;
        case '/langsam':
          setTimeout(() => {
            if (!res.writableEnded) res.writeHead(200).end('zu spät');
          }, 3000).unref();
          return;
        default: {
          const m = /^\/kette\/(\d+)$/.exec(req.url ?? '');
          if (m) {
            res.writeHead(302, { location: `${base}/kette/${Number(m[1]) + 1}` }).end();
            return;
          }
          res.writeHead(404).end();
        }
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  it('ohne Freigabe wird der lokale Server gar nicht abgerufen', async () => {
    const before = hits.length;
    const e = await blocked(safeFetch(`http://127.0.0.1:${port}/ok`, strict));
    expect(e.reason).toBe('address');
    expect(hits.length).toBe(before);
  });

  it('mit Freigabe für 127.0.0.1 klappt der Abruf', async () => {
    const res = await safeFetch(`http://127.0.0.1:${port}/ok`, local);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('hallo');
    expect(res.truncated).toBe(false);
    expect(res.hops).toHaveLength(1);
  });

  it('folgt erlaubten Weiterleitungen und prüft jede Station', async () => {
    const res = await safeFetch(`http://127.0.0.1:${port}/lokal`, local);
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe(`http://127.0.0.1:${port}/ok`);
    expect(res.hops.map((h) => h.status)).toEqual([302, 200]);
    const rel = await safeFetch(`http://127.0.0.1:${port}/relativ`, local);
    expect(rel.body.toString()).toBe('hallo');
  });

  it('folgt keiner Weiterleitung auf die Cloud-Metadaten-Adresse (auch nicht mit Freigabe für 127.0.0.1)', async () => {
    const e = await blocked(safeFetch(`http://127.0.0.1:${port}/metadaten`, local));
    expect(e.reason).toBe('address');
    expect(e.message).toContain('169.254.169.254');
    const e2 = await blocked(safeFetch(`http://127.0.0.1:${port}/metadaten-nat64`, local));
    expect(e2.reason).toBe('address');
  });

  it('folgt keiner Weiterleitung auf eine IPv4-mapped-Loopback-Adresse', async () => {
    const e = await blocked(safeFetch(`http://127.0.0.1:${port}/mapped`, local));
    expect(e.reason).toBe('address');
  });

  it('begrenzt die Zahl der Weiterleitungen', async () => {
    const e = await blocked(safeFetch(`http://127.0.0.1:${port}/kette/0`, local, { maxRedirects: 3 }));
    expect(e.reason).toBe('redirects');
    const noFollow = await safeFetch(`http://127.0.0.1:${port}/lokal`, local, { maxRedirects: 0 }).catch((x) => x);
    expect(noFollow).toBeInstanceOf(FetchBlockedError);
  });

  it('begrenzt die Antwortgröße', async () => {
    const res = await safeFetch(`http://127.0.0.1:${port}/gross`, local, { maxBytes: 1000 });
    expect(res.truncated).toBe(true);
    expect(res.body.length).toBe(1000);
    const full = await safeFetch(`http://127.0.0.1:${port}/gross`, local, { maxBytes: 500_000 });
    expect(full.truncated).toBe(false);
    expect(full.body.length).toBe(200_000);
  });

  it('bricht nach dem Zeitlimit ab', async () => {
    const started = Date.now();
    const e = await blocked(safeFetch(`http://127.0.0.1:${port}/langsam`, { ...local, timeoutMs: 300 }));
    expect(e.reason).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
