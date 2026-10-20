import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { oidcEnabled } from '../../config.js';
import type { Ctx } from '../../context.js';
import { randomToken, safeEqual } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { SESSION_COOKIE, SESSION_DAYS, serializeUser } from '../../services/auth.js';
import type { Role } from '../../services/links.js';
import { need, parse } from '../http.js';

const OIDC_COOKIE = 'filum_oidc';

export async function registerAuthRoutes(app: FastifyInstance, ctx: Ctx) {
  const cookieOpts = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: ctx.config.secureCookies,
  };

  function startSession(req: FastifyRequest, reply: FastifyReply, userId: number) {
    const ua = req.headers['user-agent'] ?? '';
    const label = /Mobile|Android|iPhone/i.test(ua) ? 'Mobilgerät' : 'Browser';
    const s = ctx.auth.createSession(userId, label);
    reply.setCookie(SESSION_COOKIE, s.token, { ...cookieOpts, maxAge: SESSION_DAYS * 86400 });
  }

  app.get('/api/v1/session', async (req) => {
    const setupRequired = ctx.auth.userCount() === 0;
    return {
      user: req.user ? serializeUser(req.user) : null,
      setupRequired,
      oidc: { enabled: oidcEnabled(ctx.config), label: ctx.config.oidc.buttonLabel },
      localLogin: !ctx.config.disableLocalLogin || setupRequired,
      version: ctx.config.version,
      organization: ctx.settings.get().organizationName,
      tessera: Boolean(ctx.config.tessera.url),
      appUrl: ctx.config.appUrl,
    };
  });

  // Erster Start: Einrichtungscode aus dem Container-Log + erstes Admin-Konto
  app.post('/api/v1/setup', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(
      z.object({ code: z.string().max(40), email: z.string().max(254), name: z.string().max(120), password: z.string().max(200) }),
      req.body,
    );
    if (ctx.auth.userCount() > 0) throw new AppError(409, 'setup_done', 'Filum ist bereits eingerichtet. Bitte melden Sie sich an.');
    const wait = ctx.auth.throttle.check([`setup:${req.ip}`]);
    if (wait) throw new AppError(429, 'throttled', `Zu viele Fehlversuche. Bitte in ${wait} Sekunden erneut versuchen.`);
    const expected = ctx.db.prepare("SELECT value FROM meta WHERE key = 'setup_code'").get() as { value: string } | undefined;
    if (!expected || !safeEqual(body.code.replace(/\D/g, ''), expected.value.replace(/\D/g, ''))) {
      ctx.auth.throttle.fail([`setup:${req.ip}`]);
      throw new AppError(403, 'setup_code', 'Der Einrichtungscode stimmt nicht. Sie finden ihn im Container-Log (docker compose logs filum).', 'code');
    }
    const user = await ctx.auth.createUser({ email: body.email, name: body.name, role: 'admin', password: body.password });
    ctx.db.prepare("DELETE FROM meta WHERE key = 'setup_code'").run();
    ctx.audit.log({ userId: user.id, label: user.email }, 'setup.complete', 'user', user.id);
    startSession(req, reply, user.id);
    return { user: serializeUser(user) };
  });

  app.post('/api/v1/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (ctx.config.disableLocalLogin) throw new AppError(403, 'local_disabled', 'Die Anmeldung mit Passwort ist abgeschaltet. Bitte das Firmenkonto verwenden.');
    const body = parse(z.object({ email: z.string().max(254), password: z.string().max(200) }), req.body);
    const keys = [`ip:${req.ip}`, `acct:${body.email.trim().toLowerCase()}`];
    const wait = ctx.auth.throttle.check(keys);
    if (wait) throw new AppError(429, 'throttled', `Zu viele Fehlversuche. Bitte in ${wait} Sekunden erneut versuchen.`);
    const user = await ctx.auth.checkPassword(body.email, body.password);
    if (!user) {
      ctx.auth.throttle.fail(keys);
      ctx.audit.log({ userId: null, label: body.email.slice(0, 120) }, 'login.failed');
      throw new AppError(401, 'invalid_credentials', 'E-Mail oder Passwort stimmen nicht.');
    }
    ctx.auth.throttle.succeed(keys);
    startSession(req, reply, user.id);
    ctx.audit.log({ userId: user.id, label: user.email }, 'login', 'user', user.id);
    return { user: serializeUser(user) };
  });

  app.post('/api/v1/logout', async (req, reply) => {
    if (req.sessionToken) ctx.auth.revokeSession(req.sessionToken);
    reply.clearCookie(SESSION_COOKIE, cookieOpts);
    return { ok: true };
  });

  app.patch('/api/v1/me', async (req) => {
    const p = need(req);
    const body = parse(z.object({ name: z.string().min(1).max(120) }), req.body);
    return { user: serializeUser(ctx.auth.updateUser(p.userId, { name: body.name }, -1)) };
  });

  app.post('/api/v1/me/password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const p = need(req);
    if (p.scope) throw new AppError(403, 'forbidden', 'Passwörter lassen sich nicht per API-Token ändern.');
    const body = parse(z.object({ current: z.string().max(200).optional(), next: z.string().max(200) }), req.body);
    const user = ctx.auth.getUser(p.userId);
    if (user.password_hash) {
      const ok = await ctx.auth.checkPassword(user.email, body.current ?? '');
      if (!ok) throw new AppError(400, 'invalid_credentials', 'Das aktuelle Passwort stimmt nicht.', 'current');
    }
    await ctx.auth.setPassword(p.userId, body.next);
    ctx.auth.revokeAllSessions(p.userId, req.sessionHash ?? undefined);
    ctx.audit.log(p, 'user.password', 'user', p.userId);
    return { ok: true };
  });

  app.post('/api/v1/me/logout-everywhere', async (req) => {
    const p = need(req);
    ctx.auth.revokeAllSessions(p.userId, req.sessionHash ?? undefined);
    return { ok: true };
  });

  // Einladungen annehmen (ohne Anmeldung)
  app.get('/api/v1/invites/:token', async (req) => {
    const { token } = req.params as { token: string };
    const inv = ctx.auth.getInvite(token);
    if (!inv) throw new AppError(404, 'invite_invalid', 'Diese Einladung ist abgelaufen oder wurde schon verwendet.');
    return { email: inv.email, role: inv.role };
  });

  app.post('/api/v1/invites/:token/accept', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const body = parse(z.object({ name: z.string().min(1).max(120), password: z.string().max(200) }), req.body);
    const user = await ctx.auth.acceptInvite(token, body.name, body.password);
    ctx.audit.log({ userId: user.id, label: user.email }, 'invite.accepted', 'user', user.id);
    startSession(req, reply, user.id);
    return { user: serializeUser(user) };
  });

  // ---------------------------------------------------------------- OIDC

  if (!oidcEnabled(ctx.config)) return;
  let configPromise: Promise<oidc.Configuration> | null = null;
  const getConfig = () => {
    configPromise ??= oidc
      .discovery(new URL(ctx.config.oidc.issuer), ctx.config.oidc.clientId, ctx.config.oidc.clientSecret || undefined)
      .catch((e) => {
        configPromise = null;
        throw new AppError(502, 'oidc_discovery', `Der Anmeldedienst (${ctx.config.oidc.issuer}) ist nicht erreichbar: ${(e as Error).message}`);
      });
    return configPromise;
  };
  const pending = new Map<string, { verifier: string; state: string; nonce: string; at: number }>();
  const redirectUri = `${ctx.config.appUrl}/api/v1/auth/oidc/callback`;

  app.get('/api/v1/auth/oidc/start', async (_req, reply) => {
    const config = await getConfig();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const id = randomToken(18);
    for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60_000) pending.delete(k);
    pending.set(id, { verifier, state, nonce, at: Date.now() });
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: ctx.config.oidc.scopes,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    reply.setCookie(OIDC_COOKIE, id, { ...cookieOpts, maxAge: 600 });
    return reply.redirect(url.href, 302);
  });

  app.get('/api/v1/auth/oidc/callback', async (req, reply) => {
    const id = req.cookies[OIDC_COOKIE];
    const entry = id ? pending.get(id) : undefined;
    reply.clearCookie(OIDC_COOKIE, cookieOpts);
    if (!entry) return reply.redirect('/anmelden?fehler=sitzung', 302);
    pending.delete(id!);
    try {
      const config = await getConfig();
      const current = new URL(req.url, ctx.config.appUrl);
      const tokens = await oidc.authorizationCodeGrant(config, current, {
        pkceCodeVerifier: entry.verifier,
        expectedState: entry.state,
        expectedNonce: entry.nonce,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error('Keine ID-Token-Angaben erhalten.');
      let info: Record<string, unknown> = { ...claims };
      try {
        info = { ...info, ...(await oidc.fetchUserInfo(config, tokens.access_token, claims.sub)) };
      } catch {
        /* Userinfo optional */
      }
      const groupsRaw = info[ctx.config.oidc.roleClaim];
      const groups = Array.isArray(groupsRaw) ? groupsRaw.map(String) : typeof groupsRaw === 'string' ? [groupsRaw] : [];
      const o = ctx.config.oidc;
      let role: Role | null = null;
      if (groups.some((g) => o.adminGroups.includes(g))) role = 'admin';
      else if (groups.some((g) => o.editorGroups.includes(g))) role = 'editor';
      else if (groups.some((g) => o.memberGroups.includes(g))) role = 'member';
      else if (o.defaultRole !== 'none') role = o.defaultRole;
      // Nur ausdrücklich bestätigte Adressen dürfen ein vorhandenes lokales Konto übernehmen.
      const emailVerified = info.email_verified === true || info.email_verified === 'true';
      const email = typeof info.email === 'string' ? info.email : '';
      const name = String(info.name ?? info.preferred_username ?? email ?? '');
      const user = ctx.auth.upsertOidcUser(String(claims.iss), claims.sub, email, name, role, emailVerified);
      startSession(req, reply, user.id);
      ctx.audit.log({ userId: user.id, label: user.email }, 'login.oidc', 'user', user.id, { groups: groups.slice(0, 20) });
      return reply.redirect('/', 302);
    } catch (e) {
      ctx.log.warn({ err: e }, 'OIDC-Anmeldung fehlgeschlagen');
      const msg = e instanceof AppError ? e.message : 'Die Anmeldung beim Firmenkonto ist fehlgeschlagen.';
      return reply.redirect(`/anmelden?fehler=${encodeURIComponent(msg)}`, 302);
    }
  });
}
