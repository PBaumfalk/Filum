import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-End-Tests gegen eine laufende Filum-Instanz (z. B. den Docker-Container).
 *   FILUM_URL     Verwaltung, Standard http://localhost:8081
 *   FILUM_PUBLIC  Öffentlicher Port, Standard http://localhost:8080
 *   FILUM_SETUP_CODE  Einrichtungscode, falls die Instanz frisch ist
 * Siehe docs/handbuch/22-tests.md.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.FILUM_URL ?? 'http://localhost:8081',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /setup\.ts/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin.json' }, dependencies: ['setup'], testIgnore: /setup\.ts|mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium', storageState: 'e2e/.auth/admin.json' }, dependencies: ['setup'], testMatch: /mobile\.spec\.ts/ },
  ],
});
