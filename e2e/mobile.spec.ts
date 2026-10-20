import { expect, test } from '@playwright/test';
import { publicContext, uniq } from './helpers.js';

async function noHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('Smartphone: Link anlegen und bearbeiten ohne seitliches Scrollen', async ({ page }) => {
  await page.goto('/');
  await noHorizontalOverflow(page);
  const slug = uniq('mobil');
  await page.getByLabel('Zieladresse').fill(`https://www.example.org/${slug}`);
  await page.getByLabel('Eigene Kurzadresse (optional)').fill(slug);
  await page.getByRole('button', { name: 'Kürzen' }).click();
  await expect(page.locator('.result-card')).toContainText(slug);
  await page.locator('.result-card').getByRole('button', { name: 'Details' }).click();
  await expect(page.locator('.inspector')).toBeVisible();
  const box = await page.locator('.inspector').boundingBox();
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  const overflow = await page.locator('.inspector-body').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator('.inspector').getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.locator('.inspector')).toHaveCount(0);
  const pub = await publicContext();
  expect((await pub.get(`/${slug}`)).status()).toBe(302);
});

test('Smartphone: Navigation, Analyse und Einstellungen', async ({ page }) => {
  for (const path of ['/analyse', '/domains', '/kampagnen', '/einstellungen/datenschutz', '/api']) {
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    await noHorizontalOverflow(page);
  }
  await page.getByRole('button', { name: 'Navigation öffnen' }).click();
  await page.locator('aside.sidebar').getByRole('link', { name: /Analyse/ }).click();
  await expect(page).toHaveURL(/\/analyse/);
});
