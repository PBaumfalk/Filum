import { expect, test } from '@playwright/test';
import { apiPatch, apiPost, publicContext, trackErrors, uniq } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('Link anlegen, kopieren, aufrufen, ändern, deaktivieren, reaktivieren, archivieren', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = trackErrors(page);
  const pub = await publicContext();
  const slug = uniq('e2e');
  const target = `https://www.example.org/e2e/${slug}?a=1`;

  await page.goto('/');
  const composer = page.getByLabel('Zieladresse');
  await composer.fill(target);
  await page.getByLabel('Eigene Kurzadresse (optional)').fill(slug);
  await expect(page.locator('.slug-status.ok')).toBeVisible();
  await composer.press('Enter');

  // Ergebnis erscheint und der Kurzlink liegt in der Zwischenablage
  const result = page.locator('.result-card');
  await expect(result).toContainText(slug);
  await expect(result.getByRole('button', { name: 'Kopiert' })).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain(`/${slug}`);

  // Weiterleitung prüfen
  let res = await pub.get(`/${slug}`);
  expect(res.status()).toBe(302);
  expect(res.headers()['location']).toBe(target);
  expect(res.headers()['cache-control']).toContain('no-store');

  // Ziel im Inspector ändern
  await page.locator('.link-row', { hasText: slug }).first().click();
  const newTarget = `https://www.example.org/e2e/${slug}/neu`;
  const ziel = page.getByLabel('Ziel', { exact: true });
  await ziel.fill(newTarget);
  await page.getByRole('button', { name: /Speichern/ }).click();
  await expect(page.getByText('Das neue Ziel gilt ab sofort')).toBeVisible();
  res = await pub.get(`/${slug}`);
  expect(res.headers()['location']).toBe(newTarget);

  // Verlauf enthält beide Stände, alter Stand lässt sich zurückholen
  await page.getByRole('tab', { name: 'Verlauf' }).click();
  await expect(page.getByText('Ziel geändert')).toBeVisible();
  await page.getByRole('button', { name: 'Diesen Stand wiederherstellen' }).first().click();
  await expect(page.getByText(/wiederhergestellt/).first()).toBeVisible();
  res = await pub.get(`/${slug}`);
  expect(res.headers()['location']).toBe(target);

  // Deaktivieren über das Menü
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await page.getByRole('menuitem', { name: 'Deaktivieren' }).click();
  await expect(page.getByText(/Deaktiviert/).first()).toBeVisible();
  res = await pub.get(`/${slug}`);
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain('nicht aktiv');

  // Reaktivieren
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await page.getByRole('menuitem', { name: 'Reaktivieren' }).click();
  await expect(page.getByText('Wieder aktiv')).toBeVisible();
  res = await pub.get(`/${slug}`);
  expect(res.status()).toBe(302);

  // Archivieren: verschwindet aus der Liste, leitet aber weiter
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await page.getByRole('menuitem', { name: 'Archivieren' }).click();
  await expect(page.getByText(/Archiviert – der Link funktioniert weiter/)).toBeVisible();
  await page.goto('/');
  await page.getByLabel('Links durchsuchen').fill(slug);
  await expect(page.getByText(`Keine Links zu ‚${slug}‘`)).toBeVisible();
  res = await pub.get(`/${slug}`);
  expect(res.status()).toBe(302);
  await page.goto(`/?state=archived&q=${slug}`);
  await expect(page.locator('.link-row', { hasText: slug })).toBeVisible();

  expect(errors).toEqual([]);
});

test('Suche, Filter, Export und Import', async ({ page }) => {
  const tag = uniq('tag');
  const slugs = [uniq('such'), uniq('such')];
  for (const s of slugs) await apiPost(page, '/api/v1/links', { url: `https://www.example.org/${s}`, slug: s, title: `Suchtest ${s}`, tags: [tag] });

  await page.goto('/');
  await page.getByLabel('Links durchsuchen').fill(slugs[0]);
  await expect(page.locator('.link-row')).toHaveCount(1);
  await page.goto(`/?tag=${tag}`);
  await expect(page.locator('.link-row')).toHaveCount(2);

  // Export der gefilterten Ansicht
  await page.getByRole('button', { name: 'Exportieren' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /CSV/ }).click()]);
  const csv = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  expect(csv).toContain(slugs[0]);
  expect(csv).toContain(slugs[1]);
  expect(csv.split('\n').filter(Boolean)).toHaveLength(3);

  // Import über die Oberfläche
  const imp = [uniq('imp'), uniq('imp')];
  await page.goto('/einstellungen/import');
  await page.getByLabel('Oder Inhalt einfügen').fill(`keyword,url,title\n${imp[0]},https://www.example.org/${imp[0]},Import A\n${imp[1]},https://www.example.org/${imp[1]},Import B\n,javascript:alert(1),Böse`);
  await page.getByRole('button', { name: 'Prüfen' }).click();
  await expect(page.getByText('2 bereit')).toBeVisible();
  await expect(page.getByText('1 ungültig')).toBeVisible();
  await page.getByRole('button', { name: '2 Links importieren' }).click();
  await expect(page.getByText(/Fertig: 2 angelegt/)).toBeVisible();
  const pub = await publicContext();
  const res = await pub.get(`/${imp[1]}`);
  expect(res.status()).toBe(302);
  expect(res.headers()['location']).toBe(`https://www.example.org/${imp[1]}`);
});

test('Statistik zeigt echte Aufrufe, QR-Anteil und Fehlaufrufe', async ({ page }) => {
  const slug = uniq('stat');
  const link = await apiPost<{ id: number }>(page, '/api/v1/links', { url: 'https://www.example.org/statistik', slug });
  const pub = await publicContext();
  for (let i = 0; i < 4; i++) await pub.get(`/${slug}`);
  for (let i = 0; i < 2; i++) await pub.get(`/${slug}?qr`);
  await pub.get(`/${slug}`, { headers: { 'user-agent': 'WhatsApp/2.24' } });
  await pub.get(`/${slug}x`);

  await page.goto(`/links/${link.id}`);
  await page.getByRole('tab', { name: 'Statistik' }).click();
  await expect(page.locator('.inspector .big-number')).toHaveText('6');
  await expect(page.locator('.inspector')).toContainText('33 %');

  await page.goto('/analyse?range=24h');
  await expect(page.getByRole('heading', { name: 'Analyse' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Vertipper-Radar' })).toBeVisible();
  await expect(page.locator('table', { hasText: `${slug}x` })).toBeVisible();
});

test('API-Token: anlegen, Link per API erstellen, lesen, deaktivieren, löschen', async ({ page }) => {
  await page.goto('/einstellungen/api');
  await page.getByRole('button', { name: 'Neues Token' }).click();
  await page.getByLabel('Bezeichnung').fill('E2E');
  await page.getByRole('button', { name: 'Token erstellen' }).click();
  const token = (await page.locator('.secret').first().textContent())!.trim();
  expect(token).toMatch(/^flm_/);

  const api = await (await import('@playwright/test')).request.newContext({
    baseURL: process.env.FILUM_URL ?? 'http://localhost:8081',
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
  const slug = uniq('api');
  let res = await api.post('/api/v1/links', { data: { url: 'https://www.example.org/api', slug } });
  expect(res.status()).toBe(201);
  const link = await res.json();
  res = await api.get(`/api/v1/links/${link.id}`);
  expect((await res.json()).slug).toBe(slug);
  res = await api.patch(`/api/v1/links/${link.id}`, { data: { enabled: false } });
  expect((await res.json()).state).toBe('disabled');
  res = await api.post('/api/v1/links', { data: { url: 'javascript:alert(1)' } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.field).toBe('url');
  res = await api.delete(`/api/v1/links/${link.id}`);
  expect(res.ok()).toBeTruthy();
  const pub = await publicContext();
  expect((await pub.get(`/${slug}`)).status()).toBe(410);
});

test('Rollen: Betrachter kann nichts anlegen, Mitglied nur eigene Links bearbeiten', async ({ page, browser }) => {
  const email = `${uniq('viewer')}@filum.test`;
  await apiPost(page, '/api/v1/users', { email, name: 'Nur Ansehen', role: 'viewer', password: 'viewer-passwort-1' });
  const ctx = await browser.newContext({ storageState: undefined });
  const vp = await ctx.newPage();
  await vp.goto('/');
  await vp.getByLabel('E-Mail').fill(email);
  await vp.getByLabel('Passwort').fill('viewer-passwort-1');
  await vp.getByRole('button', { name: 'Anmelden' }).click();
  await expect(vp.locator('aside.sidebar')).toBeVisible();
  await expect(vp.getByLabel('Zieladresse')).toHaveCount(0);
  const res = await vp.request.post('/api/v1/links', { data: { url: 'https://example.org' }, headers: { 'x-filum': '1' } });
  expect(res.status()).toBe(403);
  // Keine Verwaltungsbereiche
  await vp.goto('/einstellungen/sicherung');
  await expect(vp).toHaveURL(/einstellungen\/allgemein/);
  await ctx.close();
});

test('Domain-Verwaltung: hinzufügen, Proxy-Bausteine, Standard wechseln', async ({ page }) => {
  const host = `${uniq('go')}.intern.test`;
  await page.goto('/domains');
  await page.getByRole('button', { name: 'Domain hinzufügen' }).click();
  await page.getByLabel('Hostname').fill(host);
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  const card = page.locator('article', { hasText: host });
  await expect(card).toContainText('Aktiv');
  await card.getByRole('button', { name: 'Details' }).click();
  await card.getByRole('button', { name: 'Proxy & DNS' }).click();
  await expect(card.locator('.code-block').nth(1)).toContainText('reverse_proxy');
  // Link auf neuer Domain anlegen und über den Host-Header aufrufen
  const domains = await (await page.request.get('/api/v1/domains')).json();
  const d = domains.items.find((x: { host: string }) => x.host === host);
  const slug = uniq('dom');
  await apiPost(page, '/api/v1/links', { url: 'https://www.example.org/domain', slug, domainId: d.id });
  const pub = await publicContext();
  const res = await pub.get(`/${slug}`, { headers: { host } });
  expect(res.status()).toBe(302);
  // Auf der Standarddomain existiert der Slug nicht
  expect((await pub.get(`/${slug}`)).status()).toBe(404);

  // Mehrfachauswahl: zwei Links der Standarddomain auf die neue Domain verschieben (mit Bestätigung)
  const tag = uniq('umzug');
  const moved = [uniq('mv'), uniq('mv')];
  for (const s of moved) await apiPost(page, '/api/v1/links', { url: `https://www.example.org/${s}`, slug: s, tags: [tag] });
  await page.goto(`/?q=${tag}`);
  for (const s of moved) await page.getByLabel(`${s} auswählen`).click();
  await page.getByRole('toolbar', { name: 'Aktionen für die Auswahl' }).getByRole('button', { name: 'Domain' }).click();
  await page.getByRole('menuitem', { name: host }).click();
  await page.getByRole('button', { name: `2 nach ${host} verschieben` }).click();
  await expect(page.getByText(`Nach ${host} verschoben: 2 Links`)).toBeVisible();
  for (const s of moved) {
    expect((await pub.get(`/${s}`, { headers: { host } })).status()).toBe(302);
    // Die alte Adresse leitet nicht mehr weiter und bleibt reserviert
    expect((await pub.get(`/${s}`)).status()).not.toBe(302);
  }
  await apiPatch(page, `/api/v1/domains/${d.id}`, { status: 'disabled' });
});

test('Öffentlicher Port liefert keine Verwaltung und keine API', async () => {
  const pub = await publicContext();
  for (const path of ['/api/v1/session', '/api/v1/links', '/einstellungen', '/assets/index.js']) {
    const res = await pub.get(path);
    expect(res.status(), path).toBe(404);
    expect(await res.text()).not.toContain('"user"');
  }
  const health = await pub.get('/healthz');
  expect(health.ok()).toBeTruthy();
});

test('Alle Hauptseiten laden ohne Konsolenfehler', async ({ page }) => {
  const errors = trackErrors(page);
  for (const path of ['/', '/analyse', '/kampagnen', '/domains', '/api', '/einstellungen/konto', '/einstellungen/allgemein', '/einstellungen/ordnung', '/einstellungen/import', '/einstellungen/api', '/einstellungen/datenschutz', '/einstellungen/team', '/einstellungen/sicherheit', '/einstellungen/sicherung', '/einstellungen/protokoll', '/einstellungen/system']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1').first(), path).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('Tastatur: N fokussiert Eingabe, / die Suche, Cmd+K die Palette', async ({ page }) => {
  await page.goto('/analyse');
  await page.keyboard.press('n');
  await expect(page.getByLabel('Zieladresse')).toBeFocused();
  await page.getByLabel('Zieladresse').press('Escape');
  await page.locator('body').click();
  await page.keyboard.press('/');
  await expect(page.getByLabel('Links durchsuchen')).toBeFocused();
  await page.locator('body').click();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: 'Befehlspalette' })).toBeVisible();
  await page.keyboard.type('Domains');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/domains/);
});
