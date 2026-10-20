import dns from 'node:dns/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { AppError, conflict } from '../../lib/errors.js';
import { classifyAddress, safeFetch } from '../../lib/safefetch.js';
import { validateDestination, validateHost } from '../../lib/validate.js';
import { serializeDomain, txtRecordName } from '../../services/domains.js';
import { idParam, need, parse } from '../http.js';

interface CheckStep {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | 'skipped';
  detail: string;
}

export async function registerDomainRoutes(app: FastifyInstance, ctx: Ctx) {
  const { domains } = ctx;

  app.get('/api/v1/domains', async (req) => {
    need(req);
    const counts = domains.linkCounts();
    return {
      items: domains.all().map((d) => serializeDomain(d, counts.get(d.id) ?? 0)),
      txtPrefix: '_filum-challenge',
      adminHost: ctx.config.adminHost,
      publicPort: ctx.config.publicPort,
    };
  });

  app.post('/api/v1/domains', async (req, reply) => {
    const p = need(req, 'admin', 'admin');
    const body = parse(
      z.object({
        host: z.string().max(260),
        kind: z.enum(['internal', 'public']),
        https: z.boolean().optional(),
        isDefault: z.boolean().optional(),
        note: z.string().max(500).optional(),
      }),
      req.body,
    );
    const host = validateHost(body.host);
    if (host === ctx.config.adminHost) {
      throw conflict(
        'Das ist die Adresse der Verwaltungsoberfläche. Kurzlinks brauchen einen eigenen Hostnamen (z. B. go.firma.de), damit Verwaltung und öffentliche Weiterleitung sauber getrennt bleiben.',
        'host',
      );
    }
    const d = domains.create({ ...body, host, activate: body.kind === 'internal' });
    ctx.audit.log(p, 'domain.create', 'domain', d.id, { host: d.host, kind: d.kind });
    reply.code(201);
    return serializeDomain(d, 0);
  });

  app.patch('/api/v1/domains/:id', async (req) => {
    const p = need(req, 'admin', 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({
        kind: z.enum(['internal', 'public']).optional(),
        https: z.boolean().optional(),
        rootUrl: z.string().max(2048).nullable().optional(),
        notFoundUrl: z.string().max(2048).nullable().optional(),
        slugLength: z.number().int().min(4).max(16).optional(),
        permanentMaxAge: z.number().int().min(0).max(31_536_000).optional(),
        previewSuffix: z.boolean().optional(),
        note: z.string().max(500).optional(),
        status: z.enum(['active', 'disabled']).optional(),
        isDefault: z.boolean().optional(),
      }),
      req.body,
    );
    const policy = { allowedSchemes: ['http', 'https'], ownHosts: domains.hosts(), blockedHosts: ctx.settings.get().blockedHosts };
    if (body.rootUrl) body.rootUrl = validateDestination(body.rootUrl, policy, 'rootUrl');
    if (body.notFoundUrl) body.notFoundUrl = validateDestination(body.notFoundUrl, policy, 'notFoundUrl');
    if (body.rootUrl === '') body.rootUrl = null;
    if (body.notFoundUrl === '') body.notFoundUrl = null;
    const d = domains.update(id, body);
    ctx.resolver.clear();
    ctx.audit.log(p, 'domain.update', 'domain', id, body);
    return serializeDomain(d, domains.linkCounts().get(id) ?? 0);
  });

  app.delete('/api/v1/domains/:id', async (req) => {
    const p = need(req, 'admin', 'admin');
    const { id } = parse(idParam, req.params);
    const d = domains.get(id);
    domains.remove(id);
    ctx.audit.log(p, 'domain.delete', 'domain', id, { host: d.host });
    return { ok: true };
  });

  async function httpProbe(host: string, https: boolean): Promise<{ ok: boolean; detail: string }> {
    const url = `${https ? 'https' : 'http'}://${host}/.well-known/filum-verify`;
    try {
      const res = await safeFetch(
        url,
        { allowHosts: [host.split(':')[0]], allowPrivate: true, timeoutMs: 6000, userAgent: ctx.config.fetch.userAgent },
        { maxBytes: 4096, maxRedirects: 0, accept: 'text/plain' },
      );
      const body = res.body.toString('utf8').trim();
      if (res.status === 200 && body === ctx.instanceId) return { ok: true, detail: `${url} antwortet und landet bei dieser Filum-Installation.` };
      if (res.status >= 300 && res.status < 400) {
        return { ok: false, detail: `${url} leitet weiter (HTTP ${res.status} → ${res.headers.location ?? '?'}). Der Proxy sollte die Domain direkt an Filum (Port ${ctx.config.publicPort}) geben.` };
      }
      if (res.status === 421) return { ok: false, detail: `${url} landet beim Verwaltungsport statt beim öffentlichen Port ${ctx.config.publicPort}.` };
      return { ok: false, detail: `${url} antwortet mit HTTP ${res.status}, aber nicht von dieser Filum-Installation. Zeigt der Proxy auf den richtigen Dienst?` };
    } catch (e) {
      return { ok: false, detail: `${url}: ${(e as Error).message}` };
    }
  }

  app.post('/api/v1/domains/:id/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const p = need(req, 'admin', 'admin');
    const { id } = parse(idParam, req.params);
    const { method } = parse(z.object({ method: z.enum(['dns', 'http', 'admin']) }), req.body);
    const d = domains.get(id);
    if (method === 'admin') {
      if (d.kind !== 'internal') {
        throw new AppError(400, 'verify_public', 'Öffentliche Domains brauchen einen technischen Nachweis (DNS-Eintrag oder HTTP-Prüfung).');
      }
      const v = domains.markVerified(id, 'admin');
      ctx.audit.log(p, 'domain.verify', 'domain', id, { method });
      return { ok: true, domain: serializeDomain(v), detail: 'Interne Domain von einem Admin bestätigt.' };
    }
    if (method === 'dns') {
      const r = await domains.checkDns(id);
      if (!r.ok) {
        return {
          ok: false,
          detail:
            r.error ??
            `Unter ${txtRecordName(d.host)} steht nicht der erwartete Wert. Gefunden: ${r.found.length ? r.found.join(', ') : 'nichts'}.`,
        };
      }
      const v = domains.markVerified(id, 'dns');
      ctx.audit.log(p, 'domain.verify', 'domain', id, { method });
      return { ok: true, domain: serializeDomain(v), detail: 'DNS-Eintrag gefunden. Die Domain ist aktiv.' };
    }
    const probe = await httpProbe(d.host, Boolean(d.https));
    if (!probe.ok) return { ok: false, detail: probe.detail };
    const v = domains.markVerified(id, 'http');
    ctx.audit.log(p, 'domain.verify', 'domain', id, { method });
    return { ok: true, domain: serializeDomain(v), detail: probe.detail };
  });

  // Diagnose: DNS, Erreichbarkeit, HTTPS, richtiger Port
  app.post('/api/v1/domains/:id/check', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const p = need(req, 'admin', 'admin');
    const { id } = parse(idParam, req.params);
    const d = domains.get(id);
    const hostname = d.host.split(':')[0];
    const steps: CheckStep[] = [];

    let addresses: string[] = [];
    try {
      addresses = (await dns.lookup(hostname, { all: true })).map((a) => a.address);
      const classes = addresses.map(classifyAddress);
      const internal = classes.every((c) => c !== 'public');
      steps.push({
        id: 'dns',
        label: 'Namensauflösung',
        status: d.kind === 'public' && internal ? 'warning' : 'ok',
        detail:
          `${hostname} zeigt auf ${addresses.join(', ')}.` +
          (d.kind === 'public' && internal
            ? ' Das sind interne Adressen: Von diesem Server aus sieht es so aus, als wäre die Domain nur im Intranet erreichbar. Ob sie von außen erreichbar ist, kann Filum nicht prüfen.'
            : d.kind === 'internal' && !internal
              ? ' Hinweis: Die Adresse ist öffentlich, die Domain ist aber als intern markiert.'
              : ''),
      });
    } catch {
      steps.push({ id: 'dns', label: 'Namensauflösung', status: 'error', detail: `${hostname} lässt sich von diesem Server aus nicht auflösen. Fehlt der DNS-Eintrag?` });
    }

    if (addresses.length) {
      const httpsProbe = await httpProbe(d.host, true);
      const httpProbeRes = await httpProbe(d.host, false);
      steps.push({
        id: 'https',
        label: 'HTTPS über den Reverse Proxy',
        status: httpsProbe.ok ? 'ok' : d.https ? 'error' : 'skipped',
        detail: httpsProbe.ok ? `${httpsProbe.detail} Das Zertifikat ist gültig.` : httpsProbe.detail,
      });
      steps.push({
        id: 'http',
        label: 'HTTP (unverschlüsselt)',
        status: httpProbeRes.ok ? (d.https ? 'warning' : 'ok') : 'skipped',
        detail: httpProbeRes.ok
          ? d.https
            ? `${httpProbeRes.detail} Empfehlung: im Proxy HTTP auf HTTPS umleiten.`
            : httpProbeRes.detail
          : `HTTP liefert nicht direkt Filum (bei HTTPS-Domains normal, wenn der Proxy umleitet). ${httpProbeRes.detail}`,
      });
    } else {
      steps.push({ id: 'https', label: 'HTTPS über den Reverse Proxy', status: 'skipped', detail: 'Übersprungen, weil der Name nicht auflösbar ist.' });
    }

    steps.push({
      id: 'verified',
      label: 'Berechtigung',
      status: d.status === 'active' ? 'ok' : 'warning',
      detail:
        d.status === 'active'
          ? `Bestätigt per ${d.verify_method === 'dns' ? 'DNS-Eintrag' : d.verify_method === 'http' ? 'HTTP-Prüfung' : 'Admin-Freigabe'}.`
          : 'Noch nicht bestätigt. Bis dahin beantwortet Filum keine Kurzlinks unter dieser Domain.',
    });

    const result = { at: new Date().toISOString(), steps, ok: steps.every((s) => s.status === 'ok' || s.status === 'skipped') };
    domains.saveCheck(id, result);
    ctx.audit.log(p, 'domain.check', 'domain', id, { ok: result.ok });
    return result;
  });

  // Konfigurationsbausteine für gängige Reverse Proxys
  app.get('/api/v1/domains/:id/proxy-config', async (req) => {
    need(req, 'admin');
    const { id } = parse(idParam, req.params);
    const d = domains.get(id);
    const host = d.host.split(':')[0];
    const upstream = `filum:${ctx.config.publicPort}`;
    return {
      caddy: `${d.https ? '' : 'http://'}${host} {\n\treverse_proxy ${upstream}\n}`,
      nginx: `server {\n    listen 443 ssl;\n    http2 on;\n    server_name ${host};\n    ssl_certificate     /etc/ssl/${host}/fullchain.pem;\n    ssl_certificate_key /etc/ssl/${host}/privkey.pem;\n\n    location / {\n        proxy_pass http://${upstream};\n        proxy_set_header Host $host;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n\nserver {\n    listen 80;\n    server_name ${host};\n    return 301 https://$host$request_uri;\n}`,
      traefik: `labels:\n  - traefik.enable=true\n  - traefik.http.routers.filum-${host.replace(/[^a-z0-9]/g, '-')}.rule=Host(\`${host}\`)\n  - traefik.http.routers.filum-${host.replace(/[^a-z0-9]/g, '-')}.entrypoints=websecure\n  - traefik.http.routers.filum-${host.replace(/[^a-z0-9]/g, '-')}.tls.certresolver=letsencrypt\n  - traefik.http.routers.filum-${host.replace(/[^a-z0-9]/g, '-')}.service=filum-public\n  - traefik.http.services.filum-public.loadbalancer.server.port=${ctx.config.publicPort}`,
      dns: {
        record: d.kind === 'public' ? `${host}. IN A <öffentliche IP des Proxys>` : `${host}. IN A <IP des Proxys im Intranet>`,
        txt: `${txtRecordName(d.host)}. IN TXT "${d.verify_token}"`,
      },
    };
  });
}
