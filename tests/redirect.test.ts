import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAGE_CSP } from '../src/server/redirect/pages.js';
import { BOT_UA, IPHONE_UA, createTestApp, location, uniqueIp, type TestApp } from './helpers.js';

let t: TestApp;
const future = () => new Date(Date.now() + 86400_000).toISOString();
const past = () => new Date(Date.now() - 86400_000).toISOString();
const form = { 'content-type': 'application/x-www-form-urlencoded' };

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

async function linkRow(id: number) {
  return t.admin.json('GET', `/api/v1/links/${id}`);
}

describe('Weiterleitungsarten und Caching', () => {
  it('302 ist Standard, mit no-store', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/a', slug: 'std' });
    const res = await t.pub('/std');
    expect(res.statusCode).toBe(302);
    expect(location(res)).toBe('https://ziel.example/a');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['cache-control']).not.toContain('public');
    expect(res.body).toBe('');
  });

  it('301 permanent mit begrenzter öffentlicher Cache-Dauer der Domain', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/perm', slug: 'perm', redirectType: 301 });
    const maxAge = t.ctx.domains.get(t.defaultDomainId()).permanent_max_age;
    let res = await t.pub('/perm');
    expect(res.statusCode).toBe(301);
    expect(res.headers['cache-control']).toBe(`public, max-age=${maxAge}`);

    await t.admin.json('PATCH', `/api/v1/domains/${t.defaultDomainId()}`, { permanentMaxAge: 600 });
    res = await t.pub('/perm');
    expect(res.headers['cache-control']).toBe('public, max-age=600');
    await t.admin.json('PATCH', `/api/v1/domains/${t.defaultDomainId()}`, { permanentMaxAge: maxAge });
  });

  it('308 bleibt 308, 307 bleibt 307', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/308', slug: 'p308', redirectType: 308 });
    await t.admin.createLink({ url: 'https://ziel.example/307', slug: 't307', redirectType: 307 });
    expect((await t.pub('/p308')).statusCode).toBe(308);
    const r307 = await t.pub('/t307');
    expect(r307.statusCode).toBe(307);
    expect(r307.headers['cache-control']).toContain('no-store');
  });

  it('permanente Links mit Ablauf, Start, Limit, Regeln oder Passwort werden herabgestuft', async () => {
    const exp = await t.admin.createLink({ url: 'https://ziel.example/x', slug: 'down-exp', redirectType: 301, expiresAt: future() });
    expect(exp.effectiveRedirectType).toBe(302);
    const r1 = await t.pub('/down-exp');
    expect(r1.statusCode).toBe(302);
    expect(r1.headers['cache-control']).toContain('no-store');

    const lim = await t.admin.createLink({ url: 'https://ziel.example/x', slug: 'down-lim', redirectType: 308, maxClicks: 100 });
    expect(lim.effectiveRedirectType).toBe(307);
    expect((await t.pub('/down-lim')).statusCode).toBe(307);

    await t.admin.createLink({ url: 'https://ziel.example/x', slug: 'down-start', redirectType: 308, startsAt: past() });
    expect((await t.pub('/down-start')).statusCode).toBe(307);

    await t.admin.createLink({
      url: 'https://ziel.example/x',
      slug: 'down-rule',
      redirectType: 301,
      routing: { rules: [{ id: 'ios', url: 'https://ziel.example/ios', when: { platform: ['ios'] } }] },
    });
    expect((await t.pub('/down-rule')).statusCode).toBe(302);

    const pw = await t.admin.createLink({ url: 'https://ziel.example/x', slug: 'down-pw', redirectType: 301, password: 'geheim123' });
    expect(pw.effectiveRedirectType).toBe(302);
    const post = await t.pub('/down-pw', { method: 'POST', headers: form, payload: 'password=geheim123', remoteAddress: uniqueIp() });
    expect(post.statusCode).toBe(303);
    expect(post.headers['cache-control']).toContain('no-store');
  });
});

describe('Änderungen wirken sofort (Cache-Invalidierung)', () => {
  it('neues Ziel nach PATCH', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/alt', slug: 'wechsel' });
    expect(location(await t.pub('/wechsel'))).toBe('https://ziel.example/alt');
    expect(location(await t.pub('/wechsel'))).toBe('https://ziel.example/alt');
    await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { url: 'https://ziel.example/neu' });
    expect(location(await t.pub('/wechsel'))).toBe('https://ziel.example/neu');
  });

  it('neue Kurzadresse nach Slug-Änderung; die alte bleibt reserviert, nur derselbe Link bekommt sie zurück', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/s', slug: 'vorher-slug' });
    expect((await t.pub('/vorher-slug')).statusCode).toBe(302);
    await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { slug: 'nachher-slug' });
    expect((await t.pub('/nachher-slug')).statusCode).toBe(302);
    expect((await t.pub('/vorher-slug')).statusCode).toBe(410);
    // Ein anderer Link darf die alte Adresse nicht übernehmen …
    await t.admin.json('POST', '/api/v1/links', { url: 'https://fremd.example/', slug: 'vorher-slug' }, 409);
    // … derselbe Link schon.
    await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { slug: 'vorher-slug' });
    expect((await t.pub('/vorher-slug')).statusCode).toBe(302);
    expect((await t.pub('/nachher-slug')).statusCode).toBe(410);
  });

  it('Deaktivieren → 404-Seite, Reaktivieren → wieder 302', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/onoff', slug: 'onoff' });
    expect((await t.pub('/onoff')).statusCode).toBe(302);
    await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { enabled: false });
    const off = await t.pub('/onoff');
    expect(off.statusCode).toBe(404);
    expect(off.headers['content-type']).toContain('text/html');
    expect(off.body).toContain('zurzeit nicht aktiv');
    expect(off.body).not.toContain('ziel.example/onoff');
    expect(off.headers.location).toBeUndefined();
    await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { enabled: true });
    const on = await t.pub('/onoff');
    expect(on.statusCode).toBe(302);
    expect(location(on)).toBe('https://ziel.example/onoff');
  });
});

describe('Zeitsteuerung, Ersatzziel und Aufruflimit', () => {
  it('Ersatzziel bei deaktiviertem Link', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/fb', slug: 'fb-off', enabled: false, fallbackUrl: 'https://ersatz.example/' });
    const res = await t.pub('/fb-off');
    expect(res.statusCode).toBe(302);
    expect(location(res)).toBe('https://ersatz.example/');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('Ablauf → 410, mit Ersatzziel → Ersatzziel', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/exp', slug: 'abgelaufen', expiresAt: past() });
    const res = await t.pub('/abgelaufen');
    expect(res.statusCode).toBe(410);
    expect(res.body).toContain('abgelaufen');
    expect(res.body).not.toContain('ziel.example/exp');

    await t.admin.createLink({ url: 'https://ziel.example/exp', slug: 'abgelaufen-fb', expiresAt: past(), fallbackUrl: 'https://ersatz.example/abgelaufen' });
    const fb = await t.pub('/abgelaufen-fb');
    expect(fb.statusCode).toBe(302);
    expect(location(fb)).toBe('https://ersatz.example/abgelaufen');
  });

  it('Ablauf mitten im Betrieb: zuerst aktiv, nach Setzen eines vergangenen Ablaufs 410', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/live', slug: 'laeuft-ab' });
    expect((await t.pub('/laeuft-ab')).statusCode).toBe(302);
    await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { expiresAt: past() });
    expect((await t.pub('/laeuft-ab')).statusCode).toBe(410);
    expect((await linkRow(l.id)).state).toBe('expired');
  });

  it('Start in der Zukunft → noch nicht freigeschaltet', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/start', slug: 'bald', startsAt: future() });
    expect(l.state).toBe('scheduled');
    const res = await t.pub('/bald');
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('noch nicht freigeschaltet');
    await t.admin.json('PATCH', `/api/v1/links/${l.id}`, { startsAt: past() });
    expect((await t.pub('/bald')).statusCode).toBe(302);
  });

  it('maxClicks: Bots zählen nicht und sehen das Ziel nicht, danach 410', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/lim', slug: 'limit3', maxClicks: 3 });
    for (let i = 0; i < 5; i++) expect((await t.pub('/limit3', { headers: { 'user-agent': BOT_UA } })).statusCode).toBe(200);
    // ohne User-Agent gilt ein Aufruf ebenfalls als automatisiert
    expect((await t.pub('/limit3', { headers: { 'user-agent': '' } })).statusCode).toBe(200);
    t.ctx.stats.flush();
    expect((await linkRow(l.id)).clicks).toBe(0);

    expect((await t.pub('/limit3')).statusCode).toBe(302);
    expect((await t.pub('/limit3')).statusCode).toBe(302);
    t.ctx.stats.flush();
    expect((await linkRow(l.id)).clicks).toBe(2);
    // noch nicht geschriebene Aufrufe zählen sofort mit
    expect((await t.pub('/limit3')).statusCode).toBe(302);
    const over = await t.pub('/limit3');
    expect(over.statusCode).toBe(410);
    t.ctx.stats.flush();
    const row = await linkRow(l.id);
    expect(row.clicks).toBe(3);
    expect(row.state).toBe('limit');
    // HEAD und Bots ändern daran nichts
    expect((await t.pub('/limit3', { headers: { 'user-agent': BOT_UA } })).statusCode).toBe(410);
  });
});

describe('Kurzadresse, Parameter und Kampagnen', () => {
  it('Groß-/Kleinschreibung spielt keine Rolle', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/case', slug: 'MixedCase' });
    for (const p of ['/MixedCase', '/mixedcase', '/MIXEDCASE', '/mixedcase/']) {
      const res = await t.pub(p);
      expect(res.statusCode, p).toBe(302);
      expect(location(res)).toBe('https://ziel.example/case');
    }
    // Groß-/Kleinschreibung gilt auch bei der Anlage: Konflikt
    const dup = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/x', slug: 'mixedCASE' });
    expect(dup.statusCode).toBe(409);
  });

  it('Kurzadressen mit Schrägstrich und kodierten Zeichen', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/team', slug: 'team/kalender' });
    expect(location(await t.pub('/team/kalender'))).toBe('https://ziel.example/team');
    expect(location(await t.pub('/team%2Fkalender'))).toBe('https://ziel.example/team');
  });

  it('Query-Weitergabe: Link-Parameter haben Vorrang', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/p?a=1', slug: 'fq' });
    const u = new URL(location(await t.pub('/fq?a=2&b=3&b=4')));
    expect(u.searchParams.getAll('a')).toEqual(['1']);
    expect(u.searchParams.getAll('b')).toEqual(['3', '4']);
    expect(u.pathname).toBe('/p');

    await t.admin.createLink({ url: 'https://ziel.example/p?a=1', slug: 'fq-aus', forwardQuery: false });
    expect(location(await t.pub('/fq-aus?b=3'))).toBe('https://ziel.example/p?a=1');
  });

  it('?qr wird entfernt und als QR-Aufruf gezählt', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/qr', slug: 'qrlink' });
    expect(location(await t.pub('/qrlink?qr'))).toBe('https://ziel.example/qr');
    const withParam = new URL(location(await t.pub('/qrlink?qr&x=1')));
    expect(withParam.searchParams.has('qr')).toBe(false);
    expect(withParam.searchParams.get('x')).toBe('1');
    // ?qr=1 ist kein Marker, sondern ein normaler Parameter
    expect(new URL(location(await t.pub('/qrlink?qr=1'))).searchParams.get('qr')).toBe('1');
    await t.pub('/qrlink');
    t.ctx.stats.flush();
    const stats = await t.admin.json('GET', `/api/v1/links/${l.id}/stats?range=24h`);
    expect(stats.totals.clicks).toBe(4);
    expect(stats.totals.qr).toBe(2);
  });

  it('UTM-Parameter aus Kampagne und Link (Link überschreibt Kampagne)', async () => {
    const c = await t.admin.json('POST', '/api/v1/campaigns', { name: 'Herbst', utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'herbst26' }, 201);
    await t.admin.createLink({ url: 'https://ziel.example/utm?utm_source=alt&k=v', slug: 'utm', campaignId: c.id, utm: { utm_medium: 'print', utm_content: 'flyer' } });
    const u = new URL(location(await t.pub('/utm')));
    expect(u.searchParams.get('utm_source')).toBe('newsletter');
    expect(u.searchParams.get('utm_medium')).toBe('print');
    expect(u.searchParams.get('utm_campaign')).toBe('herbst26');
    expect(u.searchParams.get('utm_content')).toBe('flyer');
    expect(u.searchParams.get('k')).toBe('v');
    // Kampagne ändern wirkt sofort
    await t.admin.json('PATCH', `/api/v1/campaigns/${c.id}`, { utm_campaign: 'winter26' });
    expect(new URL(location(await t.pub('/utm'))).searchParams.get('utm_campaign')).toBe('winter26');
  });

  it('Startseite der Domain und POST auf normale Links', async () => {
    const root = await t.pub('/');
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('Kurzlinks');
    await t.admin.createLink({ url: 'https://ziel.example/post', slug: 'kein-post' });
    const post = await t.pub('/kein-post', { method: 'POST', headers: form, payload: 'a=1' });
    expect(post.statusCode).toBe(405);
    expect(post.headers.location).toBeUndefined();
  });

  it('HEAD leitet weiter, zählt aber nicht', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/head', slug: 'head' });
    for (let i = 0; i < 3; i++) {
      const res = await t.pub('/head', { method: 'HEAD' });
      expect(res.statusCode).toBe(302);
      expect(location(res)).toBe('https://ziel.example/head');
    }
    t.ctx.stats.flush();
    expect((await linkRow(l.id)).clicks).toBe(0);
    await t.pub('/head');
    t.ctx.stats.flush();
    expect((await linkRow(l.id)).clicks).toBe(1);
  });
});

describe('Passwortschutz', () => {
  let id = 0;
  beforeAll(async () => {
    id = (await t.admin.createLink({ url: 'https://ziel.example/geheim-ziel', slug: 'geheim', password: 'Sesam-123' })).id;
  });

  it('GET zeigt ein Formular und verrät das Ziel nicht', async () => {
    const res = await t.pub('/geheim?x=1');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<form');
    expect(res.body).toContain('type="password"');
    expect(res.body).toContain('action="/geheim?x=1"');
    expect(res.body).not.toContain('geheim-ziel');
    expect(res.headers.location).toBeUndefined();
  });

  it('falsches Passwort → 401, richtiges → 303 auf das Ziel (mit Parametern)', async () => {
    const ip = uniqueIp();
    const wrong = await t.pub('/geheim', { method: 'POST', headers: form, payload: 'password=falsch', remoteAddress: ip });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toContain('stimmt nicht');
    expect(wrong.body).not.toContain('geheim-ziel');
    const ok = await t.pub('/geheim?x=1', { method: 'POST', headers: form, payload: 'password=Sesam-123', remoteAddress: ip });
    expect(ok.statusCode).toBe(303);
    expect(location(ok)).toBe('https://ziel.example/geheim-ziel?x=1');
    t.ctx.stats.flush();
    expect((await linkRow(id)).clicks).toBe(1);
  });

  it('drosselt nach vielen Fehlversuchen – auch das richtige Passwort wird dann abgewiesen', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 5; i++) {
      const r = await t.pub('/geheim', { method: 'POST', headers: form, payload: `password=falsch${i}`, remoteAddress: ip });
      expect(r.statusCode).toBe(401);
    }
    const blocked = await t.pub('/geheim', { method: 'POST', headers: form, payload: 'password=Sesam-123', remoteAddress: ip });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers.location).toBeUndefined();
    // eine andere Adresse ist nicht betroffen
    const other = await t.pub('/geheim', { method: 'POST', headers: form, payload: 'password=Sesam-123', remoteAddress: uniqueIp() });
    expect(other.statusCode).toBe(303);
  });
});

describe('Vorschau- und Meldeseite', () => {
  it('/<slug>+ zeigt das Ziel, ohne weiterzuleiten', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/vorschau?a=<b>', slug: 'vorschau', title: 'Mein <Titel>' });
    const res = await t.pub('/vorschau+');
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toContain('https://ziel.example/vorschau?a=%3Cb%3E');
    expect(res.body).toContain('Mein &lt;Titel&gt;');
    expect(res.body).not.toContain('<Titel>');
    expect(res.body).toContain('href="/vorschau"');
    // Vorschau zählt nicht als Aufruf
    t.ctx.stats.flush();
    expect((await linkRow(l.id)).clicks).toBe(0);
  });

  it('bei Passwortschutz zeigt die Vorschau das Ziel nicht', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/streng-geheim', slug: 'pw-vorschau', password: 'abcd1234' });
    const res = await t.pub('/pw-vorschau+');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('streng-geheim');
    expect(res.body).toContain('Passwort');
  });

  it('bei inaktivem Link kein Weiter-Knopf', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/inaktiv', slug: 'inaktiv-vorschau', enabled: false });
    const res = await t.pub('/inaktiv-vorschau+');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('nicht aktiv');
    expect(res.body).not.toContain('href="/inaktiv-vorschau"');
  });

  it('Vorschau für unbekannte Kurzadresse → 404', async () => {
    expect((await t.pub('/gibtsnicht+')).statusCode).toBe(404);
  });

  it('/<slug>+melden legt eine Meldung an', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/melden', slug: 'melden' });
    const form1 = await t.pub('/melden+melden');
    expect(form1.statusCode).toBe(200);
    expect(form1.body).toContain('<form');
    const ip = uniqueIp();
    const res = await t.pub('/melden+melden', {
      method: 'POST',
      headers: form,
      payload: new URLSearchParams({ reason: 'phishing', message: 'Sieht aus wie eine Bank' }).toString(),
      remoteAddress: ip,
    });
    expect(res.statusCode).toBe(200);
    const row = t.ctx.db.prepare('SELECT * FROM reports WHERE link_id = ?').get(l.id) as { reason: string; message: string; status: string };
    expect(row).toMatchObject({ reason: 'phishing', message: 'Sieht aus wie eine Bank', status: 'open' });
    // unbekannter Grund wird zu „other“
    await t.pub('/melden+melden', { method: 'POST', headers: form, payload: 'reason=<script>&message=x', remoteAddress: ip });
    const reports = await t.admin.json('GET', '/api/v1/reports');
    const mine = reports.items.filter((r: { linkId: number }) => r.linkId === l.id);
    expect(mine.map((r: { reason: string }) => r.reason).sort()).toEqual(['other', 'phishing']);
    // höchstens 5 Meldungen je Adresse und 10 Minuten
    for (let i = 0; i < 3; i++) await t.pub('/melden+melden', { method: 'POST', headers: form, payload: 'reason=spam', remoteAddress: ip });
    const limited = await t.pub('/melden+melden', { method: 'POST', headers: form, payload: 'reason=spam', remoteAddress: ip });
    expect(limited.statusCode).toBe(429);
    expect((t.ctx.db.prepare('SELECT COUNT(*) n FROM reports WHERE link_id = ?').get(l.id) as { n: number }).n).toBe(5);
  });
});

describe('Meldungen abschaltbar', () => {
  it('ohne reportsEnabled gibt es weder Meldeseite noch Meldelink', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/ohne-melden', slug: 'ohne-melden' });
    expect((await t.pub('/ohne-melden+')).body).toContain('href="/ohne-melden+melden"');
    await t.admin.json('PATCH', '/api/v1/settings', { reportsEnabled: false });
    expect((await t.pub('/ohne-melden+melden')).statusCode).toBe(404);
    const post = await t.pub('/ohne-melden+melden', { method: 'POST', headers: form, payload: 'reason=spam', remoteAddress: uniqueIp() });
    expect(post.statusCode).toBe(404);
    expect((await t.pub('/ohne-melden+')).body).not.toContain('+melden');
    await t.admin.json('PATCH', '/api/v1/settings', { reportsEnabled: true });
  });
});

describe('Gelöschte Links und unbekannte Adressen', () => {
  it('gelöschter Link → 410, Kurzadresse bleibt reserviert', async () => {
    const l = await t.admin.createLink({ url: 'https://ziel.example/weg', slug: 'geloescht' });
    expect((await t.pub('/geloescht')).statusCode).toBe(302);
    await t.admin.json('DELETE', `/api/v1/links/${l.id}`);
    const res = await t.pub('/geloescht');
    expect(res.statusCode).toBe(410);
    expect(res.body).toContain('entfernt');
    expect((await t.pub('/GELOESCHT')).statusCode).toBe(410);
    const again = await t.admin.post('/api/v1/links', { url: 'https://anderes.example/', slug: 'Geloescht' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.field).toBe('slug');
    const check = await t.admin.json('GET', '/api/v1/slug/check?slug=geloescht');
    expect(check.available).toBe(false);
    // Freigabe durch Admin macht die Adresse wieder nutzbar
    await t.admin.json('DELETE', `/api/v1/reserved/${t.defaultDomainId()}/geloescht`);
    expect((await t.pub('/geloescht')).statusCode).toBe(404);
    await t.admin.createLink({ url: 'https://anderes.example/', slug: 'geloescht' });
    expect(location(await t.pub('/geloescht'))).toBe('https://anderes.example/');
  });

  it('unbekannte Domain (Host) → 404', async () => {
    await t.admin.createLink({ url: 'https://ziel.example/host', slug: 'hosttest' });
    const res = await t.pub('/hosttest', { headers: { host: 'fremd.test' } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Unbekannte Adresse');
    expect(res.headers.location).toBeUndefined();
    // Host-Vergleich ohne Rücksicht auf Groß-/Kleinschreibung
    expect((await t.pub('/hosttest', { headers: { host: 'GO.TEST' } })).statusCode).toBe(302);
  });

  it('unbekannte Kurzadresse → 404-Seite', async () => {
    const res = await t.pub('/gibt-es-nicht');
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Link nicht gefunden');
  });
});

describe('Regeln und Varianten über HTTP', () => {
  it('Plattform (User-Agent) und Sprache (Accept-Language)', async () => {
    await t.admin.createLink({
      url: 'https://ziel.example/haupt',
      slug: 'regeln',
      routing: {
        rules: [
          { id: 'ios', url: 'https://apps.example/ios', when: { platform: ['ios'] } },
          { id: 'en', url: 'https://ziel.example/en', when: { language: ['en'] } },
        ],
      },
    });
    const ios = await t.pub('/regeln', { headers: { 'user-agent': IPHONE_UA, 'accept-language': 'en-US' } });
    expect(location(ios)).toBe('https://apps.example/ios');
    expect(ios.headers.vary).toBe('User-Agent, Accept-Language');
    expect(location(await t.pub('/regeln', { headers: { 'accept-language': 'en-GB,en;q=0.9,de;q=0.5' } }))).toBe('https://ziel.example/en');
    expect(location(await t.pub('/regeln', { headers: { 'accept-language': 'de-DE,en;q=0.5' } }))).toBe('https://ziel.example/haupt');
    expect(location(await t.pub('/regeln'))).toBe('https://ziel.example/haupt');
  });

  it('Regeln ohne Bedingung und mit gefährlichem Ziel werden abgelehnt', async () => {
    const noCond = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/', routing: { rules: [{ id: 'x', url: 'https://a.example', when: {} }] } });
    expect(noCond.statusCode).toBe(400);
    const js = await t.admin.post('/api/v1/links', {
      url: 'https://ziel.example/',
      routing: { rules: [{ id: 'x', url: 'javascript:alert(1)', when: { platform: ['ios'] } }] },
    });
    expect(js.statusCode).toBe(400);
    expect(js.json().error.field).toBe('routing.rules.0.url');
    const v = await t.admin.post('/api/v1/links', { url: 'https://ziel.example/', routing: { variants: [{ id: 'v', url: 'https://go.test/schleife', weight: 10 }] } });
    expect(v.statusCode).toBe(400);
    expect(v.json().error.code).toBe('loop');
  });

  it('Varianten: Gewichte werden eingehalten und in der Statistik getrennt gezählt', async () => {
    const only = await t.admin.createLink({
      url: 'https://ziel.example/a',
      slug: 'nur-b',
      routing: { mainWeight: 0, variants: [{ id: 'b', url: 'https://ziel.example/b', weight: 100 }] },
    });
    for (let i = 0; i < 10; i++) expect(location(await t.pub('/nur-b'))).toBe('https://ziel.example/b');

    const ab = await t.admin.createLink({
      url: 'https://ziel.example/a',
      slug: 'ab-test',
      routing: { mainWeight: 50, variants: [{ id: 'b', url: 'https://ziel.example/b', weight: 50 }] },
    });
    const counts: Record<string, number> = {};
    for (let i = 0; i < 200; i++) {
      const target = location(await t.pub('/ab-test', { remoteAddress: uniqueIp() }));
      counts[target] = (counts[target] ?? 0) + 1;
    }
    expect(Object.keys(counts).sort()).toEqual(['https://ziel.example/a', 'https://ziel.example/b']);
    expect(counts['https://ziel.example/a']).toBeGreaterThan(50);
    expect(counts['https://ziel.example/b']).toBeGreaterThan(50);

    t.ctx.stats.flush();
    const s1 = await t.admin.json('GET', `/api/v1/links/${only.id}/stats?range=7d`);
    expect(s1.dims.route).toEqual([{ value: 'variant:b', count: 10 }]);
    const s2 = await t.admin.json('GET', `/api/v1/links/${ab.id}/stats?range=7d`);
    const route = Object.fromEntries(s2.dims.route.map((d: { value: string; count: number }) => [d.value, d.count]));
    expect(route.main).toBe(counts['https://ziel.example/a']);
    expect(route['variant:b']).toBe(counts['https://ziel.example/b']);
  });
});

describe('Sicherheitsheader und Missbrauchsschutz', () => {
  it('HTML-Seiten haben CSP und Schutzheader', async () => {
    for (const p of ['/gibt-es-nicht-header', '/geheim', '/']) {
      const res = await t.pub(p);
      expect(res.headers['content-type'], p).toContain('text/html');
      expect(res.headers['content-security-policy']).toBe(PAGE_CSP);
      expect(PAGE_CSP).toContain("default-src 'none'");
      expect(PAGE_CSP).toContain("frame-ancestors 'none'");
      expect(PAGE_CSP).not.toContain('unsafe-inline');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.body).not.toMatch(/<script/i);
    }
  });

  it('Weiterleitungen setzen keine Cookies und haben nosniff', async () => {
    const res = await t.pub('/std');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('robots.txt, healthz und Domain-Nachweis', async () => {
    const robots = await t.pub('/robots.txt');
    expect(robots.statusCode).toBe(200);
    expect(robots.body).toContain('Disallow: /*+$');
    expect((await t.pub('/healthz')).json()).toEqual({ status: 'ok' });
    expect((await t.pub('/.well-known/filum-verify')).body).toBe(t.ctx.instanceId);
  });

  it('viele unbekannte Kurzadressen von einer Adresse → 429', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 240; i++) {
      const r = await t.pub(`/rate-${i}`, { remoteAddress: ip });
      expect(r.statusCode).toBe(404);
    }
    const limited = await t.pub('/rate-x', { remoteAddress: ip });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    // vorhandene Links funktionieren für diese Adresse weiter, andere Adressen sind nicht betroffen
    expect((await t.pub('/std', { remoteAddress: ip })).statusCode).toBe(302);
    expect((await t.pub('/rate-y', { remoteAddress: uniqueIp() })).statusCode).toBe(404);
  });
});
