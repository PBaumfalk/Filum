import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import type { LightMyRequestResponse } from 'fastify';
import { createApp } from '../src/server/app.js';
import type { Config } from '../src/server/config.js';
import type { Role } from '../src/server/services/links.js';

export const SETUP_CODE = '123-456-789';
export const ADMIN_HOST = 'admin.test';
export const SHORT_HOST = 'go.test';
export const ADMIN_EMAIL = 'admin@filum.test';
export const PASSWORD = 'Sicheres-Passwort-42';
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
export const BOT_UA = 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)';

export function makeDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filum-test-'));
}

export function testConfig(dataDir: string, overrides: Partial<Config> = {}): Config {
  return {
    dataDir,
    dbPath: path.join(dataDir, 'filum.db'),
    backupDir: path.join(dataDir, 'backups'),
    appUrl: `http://${ADMIN_HOST}`,
    adminHost: ADMIN_HOST,
    strictAdminHost: false,
    publicPort: 8080,
    adminPort: 8081,
    host: '127.0.0.1',
    trustProxy: ['loopback', 'linklocal', 'uniquelocal'],
    secureCookies: false,
    logLevel: 'silent',
    initialDomain: SHORT_HOST,
    setupCode: SETUP_CODE,
    oidc: {
      issuer: '',
      clientId: '',
      clientSecret: '',
      scopes: 'openid',
      roleClaim: 'groups',
      adminGroups: [],
      editorGroups: [],
      memberGroups: [],
      defaultRole: 'member',
      buttonLabel: 'SSO',
    },
    disableLocalLogin: false,
    fetch: { allowHosts: [], allowPrivate: false, timeoutMs: 2000, userAgent: 'Filum-Test' },
    healthCheckIntervalMin: 0,
    backup: { intervalHours: 0, keep: 3 },
    tessera: { url: '', token: '' },
    version: 'test',
    ...overrides,
  };
}

type App = Awaited<ReturnType<typeof createApp>>;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT' | 'HEAD';

export interface ReqOpts {
  headers?: Record<string, string>;
  /** Roher Body (z. B. CSV) statt JSON */
  raw?: string | Buffer;
  /** CSRF-Header weglassen */
  noCsrf?: boolean;
  remoteAddress?: string;
}

let ipCounter = 0;
/** Eindeutige Absenderadresse, damit Drosselungen sich nicht gegenseitig stören */
export function uniqueIp(): string {
  ipCounter++;
  return `10.77.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

/** Anfragen an den Verwaltungsdienst mit Sitzungs-Cookie oder API-Token */
export class Client {
  constructor(
    private app: App,
    readonly cookie: string | null,
    readonly token: string | null = null,
    readonly userId = 0,
  ) {}

  async req(method: Method, url: string, body?: unknown, opts: ReqOpts = {}): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { host: ADMIN_HOST, ...(opts.headers ?? {}) };
    if (this.cookie) headers.cookie = `filum_session=${this.cookie}`;
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (method !== 'GET' && method !== 'HEAD' && !this.token && !opts.noCsrf) headers['x-filum'] = '1';
    let payload: string | Buffer | undefined;
    if (opts.raw !== undefined) payload = opts.raw;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['content-type'] ??= 'application/json';
    }
    return this.app.adminServer.inject({ method, url, headers, payload, remoteAddress: opts.remoteAddress });
  }

  get(url: string, opts?: ReqOpts) {
    return this.req('GET', url, undefined, opts);
  }
  post(url: string, body?: unknown, opts?: ReqOpts) {
    return this.req('POST', url, body ?? {}, opts);
  }
  patch(url: string, body?: unknown, opts?: ReqOpts) {
    return this.req('PATCH', url, body ?? {}, opts);
  }
  del(url: string, opts?: ReqOpts) {
    return this.req('DELETE', url, undefined, opts);
  }

  /** JSON lesen und Status prüfen */
  async json<T = any>(method: Method, url: string, body?: unknown, expected = 200): Promise<T> {
    const res = await this.req(method, url, body, {});
    if (res.statusCode !== expected) {
      throw new Error(`${method} ${url}: erwartet ${expected}, erhalten ${res.statusCode}: ${res.body}`);
    }
    return res.json() as T;
  }

  /** Link anlegen und das Ergebnis liefern */
  async createLink(input: Record<string, unknown>): Promise<any> {
    return this.json('POST', '/api/v1/links', input, 201);
  }
}

export interface TestApp {
  app: App;
  ctx: App['ctx'];
  dataDir: string;
  admin: Client;
  anon: Client;
  /** Anfrage an den öffentlichen Dienst (Host go.test) */
  pub(url: string, opts?: { method?: Method; headers?: Record<string, string>; payload?: string; remoteAddress?: string }): Promise<LightMyRequestResponse>;
  login(email: string, password?: string): Promise<Client>;
  createUser(role: Role, email?: string): Promise<Client>;
  tokenClient(scope: 'read' | 'write' | 'admin', owner?: Client): Promise<Client>;
  defaultDomainId(): number;
  close(opts?: { keepDir?: boolean }): Promise<void>;
}

export const silentLog = pino({ level: 'silent' });

let userCounter = 0;

/**
 * Startet Filum auf einem frischen (oder vorhandenen) Datenverzeichnis, führt bei
 * Bedarf die Einrichtung über die API aus und liefert Helfer für Anfragen.
 */
export async function createTestApp(opts: { dataDir?: string; setup?: boolean; config?: Partial<Config> } = {}): Promise<TestApp> {
  const dataDir = opts.dataDir ?? makeDataDir();
  const app = await createApp(testConfig(dataDir, opts.config), silentLog);
  // Keine Abrufe ins Internet: Vorschau-Daten und Zielprüfung aus
  const s = app.ctx.settings.get();
  if (s.fetchPreviews || s.healthChecks) {
    app.ctx.settings.update({ fetchPreviews: false, healthChecks: false });
  }
  const anon = new Client(app, null);

  const login = async (email: string, password = PASSWORD): Promise<Client> => {
    const res = await anon.req('POST', '/api/v1/login', { email, password }, { remoteAddress: uniqueIp() });
    if (res.statusCode !== 200) throw new Error(`Anmeldung ${email} fehlgeschlagen: ${res.statusCode} ${res.body}`);
    const cookie = res.cookies.find((c) => c.name === 'filum_session');
    if (!cookie) throw new Error('Kein Sitzungs-Cookie');
    return new Client(app, cookie.value, null, (res.json() as { user: { id: number } }).user.id);
  };

  let admin: Client = anon;
  if (opts.setup !== false && app.ctx.auth.userCount() === 0) {
    const res = await anon.req('POST', '/api/v1/setup', { code: SETUP_CODE, email: ADMIN_EMAIL, name: 'Admin', password: PASSWORD });
    if (res.statusCode !== 200) throw new Error(`Einrichtung fehlgeschlagen: ${res.statusCode} ${res.body}`);
    const cookie = res.cookies.find((c) => c.name === 'filum_session')!;
    admin = new Client(app, cookie.value, null, (res.json() as { user: { id: number } }).user.id);
  } else if (opts.setup !== false) {
    admin = await login(ADMIN_EMAIL);
  }

  const t: TestApp = {
    app,
    ctx: app.ctx,
    dataDir,
    admin,
    anon,
    pub(url, o = {}) {
      return app.publicServer.inject({
        method: o.method ?? 'GET',
        url,
        headers: { host: SHORT_HOST, 'user-agent': BROWSER_UA, ...(o.headers ?? {}) },
        payload: o.payload,
        remoteAddress: o.remoteAddress,
      });
    },
    login,
    async createUser(role, email) {
      userCounter++;
      const mail = email ?? `${role}${userCounter}-${Date.now()}@filum.test`;
      await admin.json('POST', '/api/v1/users', { email: mail, name: `${role} ${userCounter}`, role, password: PASSWORD }, 201);
      return login(mail);
    },
    async tokenClient(scope, owner = admin) {
      const res = await owner.json('POST', '/api/v1/tokens', { name: `t-${scope}`, scope }, 201);
      return new Client(app, null, res.token as string, owner.userId);
    },
    defaultDomainId() {
      return app.ctx.domains.default()!.id;
    },
    async close(o = {}) {
      await app.close();
      if (!o.keepDir) fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return t;
}

/** Location-Header als URL */
export function location(res: LightMyRequestResponse): string {
  return String(res.headers.location ?? '');
}
