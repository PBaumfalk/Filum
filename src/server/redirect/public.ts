import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type { Ctx } from '../context.js';
import { verifyPassword } from '../lib/crypto.js';
import { now } from '../lib/time.js';
import { applyUtm, slugKey } from '../lib/validate.js';
import { browserFamily, deviceClass, isBot, osFamily, platformForRules, primaryLanguage, referrerHost } from '../lib/ua.js';
import { LoginThrottle } from '../services/auth.js';
import type { DomainRow } from '../services/domains.js';
import { effectiveStatus, linkState } from '../services/links.js';
import { route } from '../services/rules.js';
import type { CachedLink } from './resolver.js';
import { PAGE_CSP, messagePage, notFoundPage, passwordPage, previewPage, reportPage } from './pages.js';
import { distance } from '../lib/distance.js';

/**
 * Öffentlicher Dienst: beantwortet ausschließlich Kurzlinks, Vorschau-,
 * Passwort- und Meldeseiten. Er kennt keine Verwaltungs- oder API-Routen –
 * selbst bei falsch konfiguriertem Proxy ist die Oberfläche hier nicht erreichbar.
 */

/** Einfache Fensterzählung je Schlüssel, nur im Speicher */
class Window {
  private hits = new Map<string, { n: number; start: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
    private maxKeys = 100_000,
  ) {}
  take(key: string): boolean {
    const t = Date.now();
    const e = this.hits.get(key);
    if (!e || t - e.start > this.windowMs) {
      this.hits.set(key, { n: 1, start: t });
      if (this.hits.size > this.maxKeys) this.prune(t);
      return true;
    }
    e.n++;
    return e.n <= this.limit;
  }
  /** Prüft ohne zu zählen, ob das Limit im laufenden Fenster schon erreicht ist. */
  exhausted(key: string): number {
    const e = this.hits.get(key);
    if (!e || Date.now() - e.start > this.windowMs || e.n < this.limit) return 0;
    return Math.ceil((e.start + this.windowMs - Date.now()) / 1000);
  }
  /** Abgelaufene Einträge entfernen; reicht das nicht, die ältere Hälfte. Laufende Sperren bleiben so erhalten. */
  private prune(t: number): void {
    for (const [k, e] of this.hits) if (t - e.start > this.windowMs) this.hits.delete(k);
    if (this.hits.size <= this.maxKeys * 0.9) return;
    const byAge = [...this.hits].sort((a, b) => a[1].start - b[1].start);
    for (const [k] of byAge.slice(0, Math.floor(byAge.length / 2))) this.hits.delete(k);
  }
  get size(): number {
    return this.hits.size;
  }
}

const QR_MARKER = 'qr';
/** Technische Pfade, die keine Vertipper sind (Scanner, Browser, falsch geleitete API-Aufrufe) */
const SYSTEM_PATH = /^(api|\.well-known|_filum|wp-|wordpress|admin|login|favicon|robots|sitemap|apple-touch|\.env|\.git)/i;

export { Window as RateWindow };

export function buildPublicServer(ctx: Ctx) {
  const app = Fastify({
    logger: false,
    trustProxy: ctx.config.trustProxy,
    bodyLimit: 8 * 1024,
    routerOptions: { ignoreDuplicateSlashes: true, maxParamLength: 500 },
    return503OnClosing: true,
  });

  const notFoundLimiter = new Window(240, 60_000);
  // Zusätzlich IP-unabhängig: Gefälschte oder viele Absenderadressen umgehen die Grenzen je IP nicht.
  const notFoundPerDomain = new Window(3000, 60_000);
  const pwFailsPerLink = new Window(25, 15 * 60_000);
  const reportLimiter = new Window(5, 10 * 60_000);
  const pwThrottle = new LoginThrottle();

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 8 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
      reply.header('content-security-policy', PAGE_CSP);
      reply.header('referrer-policy', 'no-referrer');
      reply.header('x-robots-tag', 'noindex, nofollow');
    }
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    ctx.log.error({ err }, 'Fehler im öffentlichen Dienst');
    reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).type('text/html; charset=utf-8')
      .send(messagePage('Das hat nicht geklappt', 'Bitte versuchen Sie es in einem Moment erneut.'));
  });

  const org = () => ctx.settings.get().organizationName || undefined;

  const html = (reply: FastifyReply, code: number, body: string) => reply.code(code).type('text/html; charset=utf-8').send(body);

  app.get('/healthz', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return { status: 'ok' };
  });

  // Nachweis für die Domain-Prüfung: beweist, dass der Hostname bei dieser Installation ankommt.
  app.get('/.well-known/filum-verify', async (_req, reply) => {
    reply.type('text/plain; charset=utf-8').header('cache-control', 'no-store');
    return ctx.instanceId;
  });

  app.get('/robots.txt', async (_req, reply) => {
    reply.type('text/plain; charset=utf-8').header('cache-control', 'public, max-age=86400');
    return 'User-agent: *\nDisallow: /*+$\n';
  });

  app.get('/favicon.ico', async (_req, reply) => reply.code(204).header('cache-control', 'public, max-age=86400').send());

  function findDomain(req: FastifyRequest): DomainRow | undefined {
    const d = ctx.domains.find(req.host) ?? ctx.domains.find(req.hostname);
    return d && d.status === 'active' ? d : undefined;
  }

  function short(d: DomainRow, slug: string) {
    return `${d.host}/${slug}`;
  }

  /** Antwort für nicht aktive Links (aus, geplant, abgelaufen, Limit erreicht) – oder null, wenn aktiv. */
  function rejectInactive(link: CachedLink, domain: DomainRow, reply: FastifyReply) {
    const state = linkState({
      enabled: link.enabled ? 1 : 0,
      starts_at: link.startsAt,
      expires_at: link.expiresAt,
      max_clicks: link.maxClicks,
      click_count: liveClicks(link),
    });
    if (state === 'active') return null;
    ctx.stats.outcome(domain.id, state === 'disabled' ? 'disabled' : state === 'scheduled' ? 'scheduled' : 'expired');
    if (link.fallbackUrl) return reply.code(302).header('location', link.fallbackUrl).header('cache-control', 'no-store').send();
    const label = short(domain, link.slug);
    if (state === 'disabled') return html(reply, 404, messagePage('Dieser Link ist zurzeit nicht aktiv', 'Bitte versuchen Sie es später erneut oder wenden Sie sich an den Absender.', label, org()));
    if (state === 'scheduled') {
      const when = new Date(link.startsAt! * 1000).toLocaleString('de-DE', { timeZone: ctx.settings.get().timezone, dateStyle: 'long', timeStyle: 'short' });
      return html(reply, 404, messagePage('Dieser Link ist noch nicht freigeschaltet', `Er wird am ${when} Uhr aktiv.`, label, org()));
    }
    return html(reply, 410, messagePage('Dieser Link ist abgelaufen', 'Das Angebot hinter diesem Link ist nicht mehr verfügbar.', label, org()));
  }

  async function handle(req: FastifyRequest<{ Params: { '*': string } }>, reply: FastifyReply, method: 'GET' | 'HEAD' | 'POST') {
    const domain = findDomain(req);
    if (!domain) {
      ctx.stats.outcome(0, 'domain_unknown');
      return html(reply, 404, messagePage('Unbekannte Adresse', 'Unter dieser Adresse ist kein Kurzlink-Dienst eingerichtet.'));
    }
    let path = (req.params['*'] ?? '').replace(/\/+$/, '');
    try {
      path = decodeURIComponent(path);
    } catch {
      /* bleibt roh */
    }

    if (!path) {
      if (domain.root_url) return reply.code(302).header('location', domain.root_url).header('cache-control', 'no-store').send();
      return html(reply, 200, messagePage('Kurzlinks', 'Hier werden Kurzlinks weitergeleitet. Bitte verwenden Sie den vollständigen Link, den Sie erhalten haben.', domain.host, org()));
    }

    // Missbrauch melden: /<slug>+melden
    if (path.endsWith('+melden') && domain.preview_suffix) {
      const slug = path.slice(0, -'+melden'.length);
      const { link } = ctx.resolver.lookup(domain.id, slugKey(slug));
      if (!link || !ctx.settings.get().reportsEnabled) return html(reply, 404, messagePage('Link nicht gefunden', 'Diesen Kurzlink gibt es nicht.', short(domain, slug), org()));
      if (method === 'POST') {
        if (!reportLimiter.take(req.ip)) return html(reply, 429, reportPage({ shortLabel: short(domain, slug), action: `/${slug}+melden`, error: 'Zu viele Meldungen. Bitte später erneut versuchen.', org: org() }));
        const body = (req.body ?? {}) as Record<string, string>;
        const reason = ['phishing', 'malware', 'spam', 'illegal', 'broken', 'other'].includes(body.reason) ? body.reason : 'other';
        ctx.db
          .prepare('INSERT INTO reports(link_id, created_at, reason, message, short_label) VALUES (?,?,?,?,?)')
          .run(link.id, now(), reason, String(body.message ?? '').slice(0, 1000), short(domain, link.slug));
        return html(reply, 200, reportPage({ shortLabel: short(domain, slug), action: '', done: true, org: org() }));
      }
      return html(reply, 200, reportPage({ shortLabel: short(domain, slug), action: `/${slug}+melden`, org: org() }));
    }

    // Vorschau: /<slug>+ zeigt das Ziel, ohne weiterzuleiten.
    if (path.endsWith('+') && domain.preview_suffix && method !== 'POST') {
      const slug = path.slice(0, -1);
      const { link } = ctx.resolver.lookup(domain.id, slugKey(slug));
      if (!link) return html(reply, 404, messagePage('Link nicht gefunden', 'Diesen Kurzlink gibt es nicht.', short(domain, slug), org()));
      ctx.stats.outcome(domain.id, 'preview');
      const state = linkState({ enabled: link.enabled ? 1 : 0, starts_at: link.startsAt, expires_at: link.expiresAt, max_clicks: link.maxClicks, click_count: liveClicks(link) });
      const reportHref = ctx.settings.get().reportsEnabled ? `/${link.slug}+melden` : null;
      if (link.passwordHash) {
        return html(reply, 200, previewPage({ shortLabel: short(domain, link.slug), destination: null, note: 'Das Ziel dieses Links ist durch ein Passwort geschützt.', continueHref: `/${link.slug}`, reportHref, org: org() }));
      }
      // Inaktive Links und Links mit Aufruflimit verraten ihr Ziel nicht ohne gezählten Aufruf.
      const active = state === 'active';
      const showTarget = active && !link.maxClicks;
      const note = !active
        ? 'Dieser Link ist derzeit nicht aktiv.'
        : link.maxClicks
          ? 'Dieser Link kann nur begrenzt oft aufgerufen werden. Das Ziel wird erst beim Aufruf angezeigt.'
          : link.routing
            ? 'Je nach Gerät, Sprache oder Zeitpunkt kann dieser Link auch zu einem anderen Ziel führen.'
            : undefined;
      return html(
        reply,
        200,
        previewPage({
          shortLabel: short(domain, link.slug),
          destination: showTarget ? link.url : null,
          title: showTarget ? link.metaTitle || link.title : null,
          description: showTarget ? link.metaDescription : null,
          note,
          continueHref: state === 'active' ? `/${link.slug}` : null,
          reportHref,
          org: org(),
        }),
      );
    }

    const key = slugKey(path);
    const { link, tomb } = ctx.resolver.lookup(domain.id, key);
    if (!link) {
      if (!notFoundLimiter.take(req.ip) || !notFoundPerDomain.take(`d:${domain.id}`)) {
        return html(reply.header('retry-after', '60'), 429, messagePage('Zu viele Anfragen', 'Bitte warten Sie einen Moment und versuchen Sie es dann erneut.'));
      }
      if (tomb) {
        ctx.stats.outcome(domain.id, 'gone');
        return html(reply, 410, messagePage('Dieser Link wurde entfernt', 'Der Kurzlink ist nicht mehr in Betrieb.', short(domain, path), org()));
      }
      ctx.stats.outcome(domain.id, 'not_found');
      if (method === 'GET' && path.length <= 80 && /^[A-Za-z0-9][A-Za-z0-9._~/-]*$/.test(path) && !SYSTEM_PATH.test(path)) ctx.stats.unknownSlug(domain.id, path);
      if (domain.not_found_url) return reply.code(302).header('location', domain.not_found_url).header('cache-control', 'no-store').send();
      // „Meinten Sie …?“ nur auf internen Domains: Auf öffentlichen würde der Vorschlag beim Durchprobieren helfen.
      const suggestion = domain.kind === 'internal' && method === 'GET' ? nearestSlug(domain.id, path) : null;
      return html(
        reply,
        404,
        notFoundPage(short(domain, path), suggestion ? { href: `/${suggestion}`, label: short(domain, suggestion) } : null, org()),
      );
    }

    const inactive = rejectInactive(link, domain, reply);
    if (inactive) return inactive;

    if (link.passwordHash) {
      const action = `/${link.slug}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
      if (method !== 'POST') {
        ctx.stats.outcome(domain.id, 'password');
        return html(reply, 200, passwordPage({ shortLabel: short(domain, link.slug), action, org: org() }));
      }
      const keys = [`ip:${req.ip}`, `link:${link.id}:${req.ip}`];
      const wait = Math.max(pwThrottle.check(keys), pwFailsPerLink.exhausted(`l:${link.id}`));
      if (wait > 0) {
        return html(reply.header('retry-after', String(wait)), 429, passwordPage({ shortLabel: short(domain, link.slug), action, error: `Zu viele Fehlversuche. Bitte in ${wait} Sekunden erneut versuchen.`, org: org() }));
      }
      const pw = String((req.body as Record<string, string> | undefined)?.password ?? '');
      if (!(await verifyPassword(pw, link.passwordHash))) {
        pwThrottle.fail(keys);
        pwFailsPerLink.take(`l:${link.id}`);
        ctx.stats.outcome(domain.id, 'password_failed');
        return html(reply, 401, passwordPage({ shortLabel: short(domain, link.slug), action, error: 'Das Passwort stimmt nicht.', org: org() }));
      }
      pwThrottle.succeed(keys);
      // Während der Passwortprüfung können parallele Aufrufe das Limit erreicht haben:
      // erneut prüfen und den Aufruf ohne weiteres await buchen.
      const late = rejectInactive(link, domain, reply);
      if (late) return late;
    } else if (method === 'POST') {
      return reply.code(405).header('allow', 'GET, HEAD').send();
    } else if (link.maxClicks && (method === 'HEAD' || isBot(req.headers['user-agent']))) {
      // Links mit Aufruflimit: HEAD und Bots (Link-Vorschauen) sehen das Ziel nicht, sonst wären
      // Einmal-Links ohne Zählung auslesbar.
      ctx.stats.outcome(domain.id, 'preview');
      if (method === 'HEAD') return reply.code(200).header('cache-control', 'no-store').send();
      return html(
        reply,
        200,
        previewPage({
          shortLabel: short(domain, link.slug),
          destination: null,
          note: 'Dieser Link kann nur begrenzt oft aufgerufen werden. Bitte öffnen Sie ihn im Browser.',
          continueHref: null,
          org: org(),
        }),
      );
    }

    // Ziel bestimmen
    const ua = req.headers['user-agent'];
    const facts = {
      platform: platformForRules(ua),
      language: primaryLanguage(req.headers['accept-language']),
      at: now(),
      timezone: ctx.settings.get().timezone,
    };
    const chosen = route(link.url, link.routing, facts);
    let target = chosen.url;
    if (link.utm) target = applyUtm(target, link.utm);

    const query = req.url.includes('?') ? new URLSearchParams(req.url.slice(req.url.indexOf('?') + 1)) : null;
    let qr = false;
    if (query) {
      if (query.has(QR_MARKER) && query.get(QR_MARKER) === '') {
        qr = true;
        query.delete(QR_MARKER);
      }
      if (link.forwardQuery && [...query.keys()].length && /^https?:/i.test(target)) {
        const u = new URL(target);
        // Nur Parameter, die das Ziel selbst nicht setzt – mehrfach vorkommende vollständig übernehmen
        const own = new Set(u.searchParams.keys());
        for (const [k, v] of query) if (!own.has(k)) u.searchParams.append(k, v);
        target = u.toString();
      }
    }

    if (method !== 'HEAD') {
      const bot = isBot(ua);
      const mode = ctx.settings.get().analyticsMode;
      ctx.stats.hit({
        linkId: link.id,
        domainId: domain.id,
        qr,
        bot,
        via: link.routing ? chosen.via : undefined,
        ...(mode === 'extended' && !bot
          ? {
              referrer: referrerHost(req.headers.referer, domain.host),
              device: deviceClass(ua),
              os: osFamily(ua),
              browser: browserFamily(ua),
              language: facts.language || '(keine)',
            }
          : {}),
      });
    }

    const status =
      method === 'POST'
        ? 303
        : effectiveStatus(
            {
              redirect_type: link.redirectType,
              starts_at: link.startsAt,
              expires_at: link.expiresAt,
              max_clicks: link.maxClicks,
              password_hash: link.passwordHash,
            },
            link.routing,
          );
    reply.code(status).header('location', target);
    if (status === 301 || status === 308) {
      // Permanent, aber mit begrenzter Cache-Dauer: so bleibt das Ziel änderbar.
      reply.header('cache-control', `public, max-age=${domain.permanent_max_age}`);
    } else {
      reply.header('cache-control', 'private, no-store, max-age=0');
    }
    if (link.routing) reply.header('vary', 'User-Agent, Accept-Language');
    return reply.send();
  }

  const nearStmt = ctx.db.prepare(
    'SELECT slug FROM links WHERE domain_id = ? AND enabled = 1 AND slug_key >= ? AND slug_key < ? AND length(slug_key) BETWEEN ? AND ? LIMIT 500',
  );
  function nearestSlug(domainId: number, path: string): string | null {
    const key = path.toLowerCase();
    if (key.length < 3 || key.length > 40 || SYSTEM_PATH.test(key)) return null;
    const first = key.slice(0, 1);
    const rows = nearStmt.all(domainId, first, String.fromCodePoint(first.codePointAt(0)! + 1), key.length - 2, key.length + 2) as { slug: string }[];
    let best: { slug: string; d: number } | null = null;
    for (const r of rows) {
      const d = distance(key, r.slug.toLowerCase());
      if (d <= 2 && (!best || d < best.d)) best = { slug: r.slug, d };
    }
    return best?.slug ?? null;
  }

  const clickStmt = ctx.db.prepare('SELECT click_count FROM links WHERE id = ?');
  function liveClicks(link: CachedLink): number {
    if (!link.maxClicks) return link.clickCount;
    const row = clickStmt.get(link.id) as { click_count: number } | undefined;
    return (row?.click_count ?? 0) + (ctx.stats.pendingClicks.get(link.id) ?? 0);
  }

  app.get('/*', (req, reply) => handle(req as FastifyRequest<{ Params: { '*': string } }>, reply, req.method === 'HEAD' ? 'HEAD' : 'GET'));
  app.post('/*', (req, reply) => handle(req as FastifyRequest<{ Params: { '*': string } }>, reply, 'POST'));

  app.setNotFoundHandler((_req, reply) => html(reply, 404, messagePage('Link nicht gefunden', 'Diesen Kurzlink gibt es nicht.')));

  return app;
}
