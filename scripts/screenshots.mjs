// Erzeugt die Bildschirmfotos für README und Dokumentation (docs/screenshots/).
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

try {
  for (let i = 0; i < 40; i++) {
    if (await fetch(`${ADMIN}/healthz`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: 'light' });
  const page = await ctx.newPage();
  const post = async (path, body) => {
    const r = await page.request.post(`${ADMIN}${path}`, { data: body, headers: { 'x-filum': '1' } });
    if (!r.ok()) throw new Error(`${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  await post('/api/v1/setup', { code: CODE, email: 'redaktion@firma.example', name: 'Anna Redaktion', password: 'screenshot-pass-1' });
  // Die Beispielziele existieren nicht: ohne Abschalten stünden alle Links auf „Ziel gestört“
  const s = await page.request.patch(`${ADMIN}/api/v1/settings`, { data: { fetchPreviews: false, healthChecks: false, organizationName: 'Firma Beispiel' }, headers: { 'x-filum': '1' } });
  if (!s.ok()) throw new Error(`settings: ${s.status()} ${await s.text()}`);

  const links = [
    { url: 'https://www.firma.example/karriere/ausbildung-2027', slug: 'ausbildung', title: 'Ausbildung 2027', tags: ['Personal', 'Druck'], protected: true },
    { url: 'https://www.firma.example/events/sommerfest', slug: 'sommerfest', title: 'Sommerfest Anmeldung', tags: ['Intern'] },
    { url: 'https://shop.firma.example/herbst?ref=newsletter', slug: 'herbst', title: 'Herbstkampagne Shop', tags: ['Marketing'] },
    { url: 'https://wiki.firma.example/it/vpn-einrichten', slug: 'vpn', title: 'VPN einrichten', tags: ['IT'] },
    { url: 'https://www.firma.example/messe/stand-b12', slug: 'messe', title: 'Messe: Stand B12', tags: ['Marketing', 'Druck'] },
    { url: 'https://forms.firma.example/feedback/kantine', slug: 'kantine', title: 'Feedback Kantine', tags: ['Intern'] },
  ];
  for (const l of links) await post('/api/v1/links', l);

  // Aufrufe mit Browser-Kennung, damit sie nicht als Bot zählen
  const hit = (path) => new Promise((resolve, reject) => {
    request(`${PUB}${path}`, { headers: { host: SHORT, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0' } }, (res) => { res.resume(); res.on('end', resolve); })
      .on('error', reject).end();
  });
  const hits = { ausbildung: 42, sommerfest: 17, herbst: 63, vpn: 9, messe: 28, kantine: 5 };
  for (const [slug, n] of Object.entries(hits)) {
    for (let i = 0; i < n; i++) await hit(`/${slug}${i % 3 === 0 ? '?qr' : ''}`);
  }
  await new Promise((r) => setTimeout(r, 4000)); // Statistik wird alle 3 s geschrieben

  mkdirSync(OUT, { recursive: true });
  await page.goto(`${ADMIN}/`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/links.png` });

  await page.getByText('Herbstkampagne Shop').first().click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/link-editor.png` });

  await page.goto(`${ADMIN}/analyse`);
  await page.getByText('24 Std.').click(); // alle Beispielaufrufe liegen in der letzten Stunde
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/analyse.png` });

  await page.goto(`${ADMIN}/domains`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/domains.png` });

  await browser.close();
  console.log(`Bildschirmfotos in ${OUT}/`);
} finally {
  stop();
}
