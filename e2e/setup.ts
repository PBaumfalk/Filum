import { expect, test as setup } from '@playwright/test';
import { ADMIN } from './helpers.js';

setup('Ersteinrichtung oder Anmeldung', async ({ page }) => {
  await page.goto('/');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
  if ((await heading.textContent())?.includes('einrichten')) {
    await page.getByLabel('Einrichtungscode').fill(process.env.FILUM_SETUP_CODE ?? '');
    await page.getByLabel('Ihr Name').fill('E2E Admin');
    await page.getByLabel('E-Mail').fill(ADMIN.email);
    await page.getByLabel('Passwort', { exact: true }).fill(ADMIN.password);
    await page.getByLabel('Passwort wiederholen').fill(ADMIN.password);
    await page.getByRole('button', { name: /Konto anlegen/ }).click();
  } else {
    await page.getByLabel('E-Mail').fill(ADMIN.email);
    await page.getByLabel('Passwort').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).or(page.locator('aside.sidebar'))).toBeVisible();
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});
