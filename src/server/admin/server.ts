import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import type { Ctx } from '../context.js';
import { AppError } from '../lib/errors.js';
import { ValidationError } from '../lib/validate.js';
import { SESSION_COOKIE } from '../services/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDomainRoutes } from './routes/domains.js';
import { registerIoRoutes } from './routes/io.js';
import { registerLinkRoutes } from './routes/links.js';
import { registerOrgRoutes } from './routes/org.js';
import { registerStatsRoutes } from './routes/stats.js';
import { openapi } from './openapi.js';

z.config(z.locales.de());

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function webRoot(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.resolve(here, '../web'), path.resolve(here, '../../../dist/web'), path.resolve(process.cwd(), 'dist/web')]) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

export async function buildAdminServer(ctx: Ctx) {
  const app = Fastify({
    logger: false,
    trustProxy: ctx.config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
    routerOptions: { ignoreDuplicateSlashes: true },
    return503OnClosing: true,
  });

  // Registrierte Routen festhalten (Abgleich mit der OpenAPI-Beschreibung in den Tests)
  const routes: string[] = [];
  app.addHook('onRoute', (r) => {
    for (const m of [r.method].flat()) routes.push(`${m} ${r.url}`);
  });
  app.decorate('registeredRoutes', routes);

  app.decorateRequest('user', null);
  app.decorateRequest('principal', null);
  app.decorateRequest('sessionToken', null);
  app.decorateRequest('sessionHash', null);

  // JSON-Parser, der leere Körper zulässt (viele Clients senden Content-Type auch bei DELETE ohne Inhalt)
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = String(body ?? '').trim();
    if (!text) return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new AppError(400, 'invalid_json', 'Der Anfragekörper ist kein gültiges JSON.'), undefined);
    }
  });

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, {
    global: true,
    max: (req) => (req.principal?.scope ? 600 : 1200),
    timeWindow: '1 minute',
    keyGenerator: (req) => (req.principal ? `u:${req.principal.userId}:${req.principal.tokenId ?? 's'}` : `ip:${req.ip}`),
    allowList: (req) => !req.url.startsWith('/api/'),
    errorResponseBuilder: (_req, c) => ({
      statusCode: 429,
      error: { code: 'rate_limited', message: `Zu viele Anfragen. Bitte in ${Math.ceil(c.ttl / 1000)} Sekunden erneut versuchen.` },
    }),
    hook: 'preHandler',
  });

  // Strikte Trennung: Kommt eine Anfrage für eine öffentliche Kurzlink-Domain hier an,
  // ist der Proxy falsch eingerichtet. Dann wird nichts von der Verwaltung ausgeliefert.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return;
    const host = req.host.toLowerCase();
    const d = ctx.domains.find(host) ?? ctx.domains.find(req.hostname);
    if (d && host !== ctx.config.adminHost) {
      reply
        .code(421)
        .type('text/plain; charset=utf-8')
        .send(
          `Diese Adresse (${host}) ist eine Kurzlink-Domain und wird vom Verwaltungsdienst nicht beantwortet.\n` +
            'Bitte im Reverse Proxy die Kurzlink-Domain auf den öffentlichen Port (8080) leiten, siehe docs/reverse-proxy.md.',
        );
      return reply;
    }
    if (ctx.config.strictAdminHost && host !== ctx.config.adminHost && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
      reply.code(421).type('text/plain; charset=utf-8').send(`Die Verwaltung ist nur unter ${ctx.config.appUrl} erreichbar.`);
      return reply;
    }
  });

  // Anmeldung: Sitzungs-Cookie oder API-Token
  app.addHook('onRequest', async (req) => {
    const authz = req.headers.authorization;
    if (authz) {
      const m = /^Bearer\s+(\S+)$/i.exec(authz);
      if (!m) throw new AppError(401, 'unauthenticated', 'Authorization-Header im Format „Bearer flm_…“ erwartet.');
      const t = ctx.auth.resolveToken(m[1]);
      if (!t) throw new AppError(401, 'unauthenticated', 'Das API-Token ist ungültig, abgelaufen oder widerrufen.');
      req.user = t.user;
      req.principal = {
        userId: t.user.id,
        tokenId: t.tokenId,
        role: t.user.role,
        name: t.user.name || t.user.email,
        label: `${t.user.email} (Token #${t.tokenId})`,
        scope: t.scope,
      };
      return;
    }
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const s = ctx.auth.resolveSession(token);
      if (s) {
        req.user = s.user;
        req.sessionToken = token;
        req.sessionHash = s.sessionHash;
        req.principal = { userId: s.user.id, role: s.user.role, name: s.user.name || s.user.email, label: s.user.email };
      }
    }
  });

  // CSRF-Schutz: schreibende Anfragen mit Cookie brauchen einen eigenen Header und
  // dürfen nur von der eigenen Herkunft kommen. Tokens sind davon nicht betroffen.
  app.addHook('preHandler', async (req) => {
    if (SAFE_METHODS.has(req.method) || req.headers.authorization || !req.url.startsWith('/api/')) return;
    if (req.headers['x-filum'] !== '1') {
      throw new AppError(403, 'csrf', 'Anfrage abgelehnt (Schutz vor Cross-Site-Anfragen). Bitte die Seite neu laden.');
    }
    const origin = req.headers.origin;
    if (origin) {
      let ok = false;
      try {
        const o = new URL(origin);
        ok = o.host.toLowerCase() === req.host.toLowerCase() || origin === new URL(ctx.config.appUrl).origin;
      } catch {
        ok = false;
      }
      if (!ok) throw new AppError(403, 'csrf', 'Anfrage von fremder Herkunft abgelehnt.');
    }
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'same-origin');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    reply.header(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    if (ctx.config.appUrl.startsWith('https://')) reply.header('strict-transport-security', 'max-age=31536000');
    if (req.url.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue?.path.join('.') ?? '';
      return reply.code(400).send({
        error: {
          code: 'invalid',
          message: field ? `${fieldLabel(field)}: ${issue.message}` : issue?.message ?? 'Ungültige Eingabe.',
          field,
          issues: err.issues.slice(0, 20).map((i) => ({ field: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (err instanceof ValidationError) {
      return reply.code(400).send({ error: { code: err.code, message: err.message, field: err.field } });
    }
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, field: err.field, details: err.details } });
    }
    // Parallele Anlage derselben Kurzadresse: die Datenbank entscheidet, die Antwort bleibt 409.
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const onSlug = /links\.(domain_id|slug_key)/.test((err as Error).message);
      return reply.code(409).send({
        error: onSlug
          ? { code: 'conflict', field: 'slug', message: 'Diese Kurzadresse ist bereits vergeben.' }
          : { code: 'conflict', message: 'Dieser Eintrag existiert bereits.' },
      });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      const message =
        status === 413
          ? 'Die Datei oder Anfrage ist zu groß.'
          : status === 415
            ? 'Dieses Datenformat wird hier nicht angenommen.'
            : status === 429
              ? 'Zu viele Anfragen.'
              : (err as Error).message;
      return reply.code(status).send({ error: { code: (err as { code?: string }).code ?? 'bad_request', message } });
    }
    ctx.log.error({ err, url: req.url, method: req.method }, 'Unerwarteter Fehler');
    return reply.code(500).send({ error: { code: 'internal', message: 'Ein interner Fehler ist aufgetreten. Details stehen im Server-Log.' } });
  });

  app.get('/healthz', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    ctx.db.prepare('SELECT 1').get();
    return { status: 'ok', version: ctx.config.version };
  });

  app.get('/api/v1/openapi.json', async () => openapi(ctx));

  await registerAuthRoutes(app, ctx);
  await registerLinkRoutes(app, ctx);
  await registerOrgRoutes(app, ctx);
  await registerStatsRoutes(app, ctx);
  await registerDomainRoutes(app, ctx);
  await registerIoRoutes(app, ctx);
  await registerAdminRoutes(app, ctx);

  app.all('/api/*', async () => {
    throw new AppError(404, 'not_found', 'Diese API-Adresse gibt es nicht. Übersicht: /api/v1/openapi.json');
  });

  const root = webRoot();
  if (root) {
    await app.register(fastifyStatic, {
      root,
      prefix: '/',
      wildcard: false,
      index: false,
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.header('cache-control', 'public, max-age=31536000, immutable');
        else res.header('cache-control', 'no-cache');
      },
    });
    const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return reply.code(404).send({ error: { code: 'not_found', message: 'Nicht gefunden.' } });
      const p = req.url.split('?')[0];
      if (/\.[a-z0-9]{2,5}$/i.test(p)) return reply.code(404).type('text/plain').send('Nicht gefunden');
      return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(indexHtml);
    });
  } else {
    app.get('/', async (_req, reply) =>
      reply.type('text/plain; charset=utf-8').send('Filum-API läuft. Die Oberfläche wurde nicht gebaut (npm run build:web).'),
    );
  }

  return app;
}

const LABELS: Record<string, string> = {
  url: 'Zieladresse',
  slug: 'Kurzadresse',
  title: 'Titel',
  expiresAt: 'Ablaufdatum',
  startsAt: 'Startzeit',
  maxClicks: 'Aufruflimit',
  fallbackUrl: 'Ersatzziel',
  password: 'Passwort',
  email: 'E-Mail',
  name: 'Name',
  host: 'Hostname',
};

function fieldLabel(field: string): string {
  return LABELS[field] ?? field;
}
