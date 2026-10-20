// Erzeugt die Bildschirmfotos für README und Handbuch (docs/screenshots/).
// Startet eine frische Instanz mit Beispieldaten auf 29080/29081, damit keine echten Daten ins Bild geraten.
// Aufruf: npm run build && node scripts/screenshots.mjs
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const ADMIN = 'http://localhost:29081';
const PUB = 'http://localhost:29080';
const CODE = '246-135-975';
const SHORT = 'go.firma.example'; // Kurzlink-Domain im Bild; Aufrufe gehen mit diesem Host-Header an den öffentlichen Port
const OUT = 'docs/screenshots';
const data = mkdtempSync(join(tmpdir(), 'filum-shots-'));

const server = spawn('node', ['dist/server/main.js'], {
  env: { ...process.env, DATA_DIR: data, PUBLIC_PORT: '29080', ADMIN_PORT: '29081', APP_URL: ADMIN, DEFAULT_DOMAIN: SHORT, SETUP_CODE: CODE, LOG_LEVEL: 'warn', HEALTH_CHECK_INTERVAL_MIN: '0' },
  stdio: 'inherit',
});
const stop = () => { server.kill(); rmSync(data, { recursive: true, force: true }); };

/** Aufruf am öffentlichen Port mit Host-Header der Kurzlink-Domain; liefert Status und Text. */
const hit = (path) => new Promise((resolve, reject) => {
  request(`${PUB}${path}`, { headers: { host: SHORT, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0', 'accept-language': 'de-DE' } }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (c) => (body += c));
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject).end();
});

try {
  for (let i = 0; i < 40; i++) {
    if (await fetch(`${ADMIN}/healthz`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  // --lang: native Datumsfelder sonst im US-Format
  const browser = await chromium.launch({ args: ['--lang=de-DE'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: 'light' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  const call = async (method, path, body) => {
    const r = await page.request.fetch(`${ADMIN}${path}`, { method, data: body, headers: { 'x-filum': '1' } });
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const post = (path, body) => call('POST', path, body);
  const shot = async (name, target = page) => {
    await page.waitForLoadState('networkidle');
    await target.screenshot({ path: `${OUT}/${name}.png` });
  };

  await post('/api/v1/setup', { code: CODE, email: 'redaktion@firma.example', name: 'Anna Redaktion', password: 'screenshot-pass-1' });
  // Die Beispielziele existieren nicht: ohne Abschalten stünden alle Links auf „Ziel gestört“
  await call('PATCH', '/api/v1/settings', { fetchPreviews: false, healthChecks: false, organizationName: 'Firma Beispiel' });

  const herbst = await post('/api/v1/campaigns', { name: 'Herbstaktion 2026', color: 'rust', utm_source: 'filum', utm_medium: 'print', utm_campaign: 'herbst-2026', startsAt: '2026-09-15T00:00:00+02:00', endsAt: '2026-11-30T23:59:00+01:00', description: 'Flyer, Plakate und Newsletter' });
  const messe = await post('/api/v1/campaigns', { name: 'Fachmesse Köln', color: 'teal', utm_source: 'messe', utm_medium: 'qr', utm_campaign: 'messe-koeln' });
  const personal = await post('/api/v1/collections', { name: 'Personal', color: 'indigo' });

  const links = [
    { url: 'https://www.firma.example/karriere/ausbildung-2027', slug: 'ausbildung', title: 'Ausbildung 2027', tags: ['Personal', 'Druck'], protected: true, collectionId: personal.id },
    { url: 'https://www.firma.example/events/sommerfest', slug: 'sommerfest', title: 'Sommerfest Anmeldung', tags: ['Intern'] },
    { url: 'https://shop.firma.example/herbst', slug: 'herbst', title: 'Herbstkampagne Shop', tags: ['Marketing'], campaignId: herbst.id },
    { url: 'https://wiki.firma.example/it/vpn-einrichten', slug: 'vpn', title: 'VPN einrichten', tags: ['IT'] },
    {
      url: 'https://www.firma.example/messe/stand-b12', slug: 'messe', title: 'Messe: Stand B12', tags: ['Marketing', 'Druck'], campaignId: messe.id, protected: true,
      expiresAt: '2026-12-31T23:59:00+01:00', fallbackUrl: 'https://www.firma.example/messen',
      routing: { rules: [
        { id: 'r1', label: 'iPhone-App', url: 'https://apps.apple.example/firma', when: { platform: ['ios'] } },
        { id: 'r2', label: 'Englisch', url: 'https://www.firma.example/en/fair/booth-b12', when: { language: ['en'] } },
      ], mainWeight: 50, variants: [] },
    },
    { url: 'https://forms.firma.example/feedback/kantine', slug: 'kantine', title: 'Feedback Kantine', tags: ['Intern'] },
    { url: 'https://shop.firma.example/herbst/newsletter', slug: 'herbst-nl', title: 'Herbst Newsletter', tags: ['Marketing'], campaignId: herbst.id },
  ];
  for (const l of links) await post('/api/v1/links', l);

  // Aufrufe mit Browser-Kennung (sonst zählt Filum sie als Bot); jeder dritte über QR
  const hits = { ausbildung: 42, sommerfest: 17, herbst: 63, 'herbst-nl': 31, vpn: 9, messe: 28, kantine: 5 };
  for (const [slug, n] of Object.entries(hits)) for (let i = 0; i < n; i++) await hit(`/${slug}${i % 3 === 0 ? '?qr' : ''}`);
  // Vertipper für das Radar
  for (const [slug, n] of Object.entries({ hebst: 7, sommerfets: 3, ausbilung: 2 })) for (let i = 0; i < n; i++) await hit(`/${slug}`);

  await call('POST', '/api/v1/users', { email: 'ben.marketing@firma.example', name: 'Ben Marketing', role: 'editor', password: 'Beispiel-Passwort-77' });
  await call('POST', '/api/v1/users', { email: 'clara.vertrieb@firma.example', name: 'Clara Vertrieb', role: 'member', password: 'Beispiel-Passwort-78' });
  await call('POST', '/api/v1/users', { email: 'empfang@firma.example', name: 'Empfang', role: 'viewer', password: 'Beispiel-Passwort-79' });
  await post('/api/v1/invites', { email: 'dana.personal@firma.example', role: 'member' });
  await new Promise((r) => setTimeout(r, 4000)); // Statistik wird alle 3 s geschrieben

  mkdirSync(OUT, { recursive: true });

  // Linkliste und Editor
  await page.goto(`${ADMIN}/`);
  await shot('links');
  await page.getByText('Herbstkampagne Shop').first().click();
  await shot('link-editor');

  // Eingabefeld mit Optionen, dann Ergebnis
  await page.goto(`${ADMIN}/`);
  await page.waitForLoadState('networkidle');
  const composer = page.getByPlaceholder('Lange Adresse einfügen');
  await composer.fill('https://www.firma.example/presse/2026/jahresbericht-nachhaltigkeit?lang=de');
  await page.getByPlaceholder('automatisch').fill('bericht');
  await page.waitForTimeout(600);
  const top = { x: 0, y: 0, width: 1440, height: 330 };
  await page.screenshot({ path: `${OUT}/composer.png`, clip: top });
  await page.getByRole('button', { name: 'Kürzen' }).click();
  await page.getByLabel('Kurzlink in neuem Tab testen').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/composer-ergebnis.png`, clip: top });

  // Editor: Zeitplan und Regeln aufgeklappt; höheres Fenster, damit die Regeln ganz ins Bild passen
  await page.setViewportSize({ width: 1440, height: 1900 });
  await page.goto(`${ADMIN}/`);
  await page.getByText('Messe: Stand B12').first().click();
  await page.waitForLoadState('networkidle');
  const inspector = page.locator('aside, [role="complementary"]').filter({ hasText: 'Bearbeiten' }).last();
  for (const title of ['Zeitplan und Limit', 'Regeln und Varianten']) await page.locator('summary', { hasText: title }).click();
  // Ausschnitt ab „Zeitplan und Limit“ bis zum Ende der ersten Regel – genau der Inhalt von Kapitel 5
  await page.waitForLoadState('networkidle');
  const box = await inspector.boundingBox();
  const from = await page.locator('summary', { hasText: 'Zeitplan und Limit' }).boundingBox();
  const to = await page.getByText('Regel 2', { exact: true }).boundingBox();
  await page.screenshot({ path: `${OUT}/editor-regeln.png`, clip: { x: box.x, y: from.y - 12, width: box.width, height: to.y - from.y } });

  // QR-Reiter
  await page.getByRole('tab', { name: 'QR-Code' }).click();
  await shot('qr', inspector);

  // Analyse
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${ADMIN}/analyse`);
  await page.getByText('24 Std.').click(); // alle Beispielaufrufe liegen in der letzten Stunde
  await shot('analyse');
  const radar = page.locator('section', { hasText: 'Vertipper-Radar' }).last();
  await radar.scrollIntoViewIfNeeded();
  await shot('vertipper', radar);

  // Kampagnen, Domains, Team
  await page.goto(`${ADMIN}/kampagnen`);
  await shot('kampagnen');
  await page.goto(`${ADMIN}/domains`);
  await shot('domains');
  await page.goto(`${ADMIN}/einstellungen/team`);
  await shot('team');

  // Öffentliche Vorschauseite (über den Host-Header abgerufen, im Browser dargestellt)
  const preview = await hit('/herbst+');
  const pv = await ctx.newPage();
  await pv.setViewportSize({ width: 900, height: 700 });
  await pv.setContent(preview.body, { waitUntil: 'load' });
  await pv.screenshot({ path: `${OUT}/vorschau.png` });

  await browser.close();
  console.log(`Bildschirmfotos in ${OUT}/`);
} finally {
  stop();
}
