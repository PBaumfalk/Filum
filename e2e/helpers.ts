import { request, type APIRequestContext, type Page } from '@playwright/test';

export const ADMIN = {
  email: process.env.FILUM_ADMIN_EMAIL ?? 'e2e-admin@filum.test',
  password: process.env.FILUM_ADMIN_PASSWORD ?? 'e2e-passwort-12345',
};
export const ADMIN_URL = process.env.FILUM_URL ?? 'http://localhost:8081';
export const PUBLIC_URL = process.env.FILUM_PUBLIC ?? 'http://localhost:8080';

/** Öffentliche Anfrage ohne Weiterleitungen zu folgen – so sehen wir Status und Location. */
export async function publicContext(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: PUBLIC_URL, maxRedirects: 0, extraHTTPHeaders: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 E2E' } });
}

export async function apiPost<T>(page: Page, path: string, data: unknown): Promise<T> {
  const res = await page.request.post(path, { data, headers: { 'x-filum': '1' } });
  if (!res.ok()) throw new Error(`${path}: ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function apiPatch<T>(page: Page, path: string, data: unknown): Promise<T> {
  const res = await page.request.patch(path, { data, headers: { 'x-filum': '1' } });
  if (!res.ok()) throw new Error(`${path}: ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

export function uniq(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

/** Sammelt Konsolenfehler einer Seite (außer erwarteten Netzwerk-4xx). */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(m.text());
  });
  return errors;
}
