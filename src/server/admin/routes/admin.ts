import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../../context.js';
import { currentSchemaVersion } from '../../db/db.js';
import { AppError, notFound } from '../../lib/errors.js';
import { iso } from '../../lib/time.js';
import { serializeUser } from '../../services/auth.js';
import { settingsPatchSchema } from '../../services/settings.js';
import { idParam, need, parse } from '../http.js';

const role = z.enum(['admin', 'editor', 'member', 'viewer']);

export async function registerAdminRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, auth } = ctx;

  // ----------------------------------------------------------- Einstellungen
  app.get('/api/v1/settings', async (req) => {
    need(req);
    return ctx.settings.get();
  });

  app.patch('/api/v1/settings', async (req) => {
    const p = need(req, 'admin', 'admin');
    const patch = parse(settingsPatchSchema, req.body);
    if (patch.timezone) {
      try {
        new Intl.DateTimeFormat('de-DE', { timeZone: patch.timezone });
      } catch {
        throw new AppError(400, 'invalid', 'Unbekannte Zeitzone. Beispiel: Europe/Berlin', 'timezone');
      }
    }
    if (patch.blockedHosts) patch.blockedHosts = [...new Set(patch.blockedHosts.map((h) => h.trim().toLowerCase().replace(/^\*\./, '')).filter(Boolean))];
    const before = ctx.settings.get();
    const next = ctx.settings.update(patch);
    if (patch.analyticsMode === 'basic' && before.analyticsMode === 'extended') ctx.stats.clearDetails();
    ctx.resolver.clear();
    ctx.audit.log(p, 'settings.update', 'settings', null, { keys: Object.keys(patch) });
    return next;
  });

  // Textbaustein für die Datenschutzerklärung, passend zur aktuellen Einstellung
  app.get('/api/v1/settings/privacy-notice', async (req) => {
    need(req);
    const s = ctx.settings.get();
    const org = s.organizationName || '[Name der verantwortlichen Stelle]';
    const parts = [
      `Kurzlinks von ${org}`,
      '',
      `Wenn Sie einen Kurzlink von ${org} aufrufen, leitet unser eigener Server Sie an die hinterlegte Zieladresse weiter. Der Dienst wird von uns selbst betrieben; es sind keine externen Analyse- oder Trackingdienste eingebunden.`,
      '',
    ];
    if (s.analyticsMode === 'off') {
      parts.push('Wir erfassen keine Nutzungsstatistik. Lediglich ein Gesamtzähler je Link wird geführt, soweit ein Link nur eine begrenzte Anzahl von Aufrufen erlaubt. Es werden keine Cookies gesetzt und keine personenbezogenen Daten gespeichert.');
    } else {
      parts.push(
        'Bei jedem Aufruf zählen wir anonym, welcher Kurzlink zu welcher Stunde aufgerufen wurde und ob der Aufruf über einen QR-Code erfolgte. Automatisierte Abrufe (z. B. Link-Vorschauen in Messengern) werden gesondert gezählt.',
      );
      if (s.analyticsMode === 'extended') {
        parts.push(
          'Zusätzlich werten wir tageweise und zusammengefasst aus, von welcher Website (nur Domainname) Besucher kamen, welche Geräteklasse (Smartphone, Tablet, Computer), welches Betriebssystem, welche Browserfamilie und welche Spracheinstellung verwendet wurde. Diese Angaben werden ausschließlich als Summen gespeichert und lassen sich keiner Person zuordnen.',
        );
      }
      parts.push(
        '',
        'Wir speichern dabei keine IP-Adressen, keine Gerätekennungen und keine vollständigen Browserangaben, setzen keine Cookies und erstellen keine Nutzungsprofile. Die IP-Adresse wird nur kurzzeitig im Arbeitsspeicher verwendet, um Missbrauch (z. B. massenhaftes Durchprobieren von Adressen) zu begrenzen, und nicht gespeichert.',
        '',
        `Die zusammengefassten Statistiken werden nach ${s.retentionDays} Tagen gelöscht${s.analyticsMode === 'extended' ? `, die Detailauswertungen nach ${s.detailRetentionDays} Tagen` : ''}.`,
        '',
        'Rechtsgrundlage ist unser berechtigtes Interesse an einem funktionsfähigen, sicheren und bedarfsgerecht gestalteten Linkdienst (Art. 6 Abs. 1 lit. f DSGVO).',
      );
    }
    parts.push('', 'Hinweis: Dieser Text ist ein Formulierungsvorschlag. Bitte prüfen Sie ihn vor der Veröffentlichung im Zusammenhang mit Ihrer übrigen Datenschutzerklärung.');
    return { text: parts.join('\n') };
  });

  // ----------------------------------------------------------- Konten
  app.get('/api/v1/users', async (req) => {
    need(req, 'editor');
    return { items: auth.listUsers().map(serializeUser), invites: req.principal!.role === 'admin' ? auth.listInvites() : [] };
  });

  app.post('/api/v1/users', async (req, reply) => {
    const p = need(req, 'admin', 'admin');
    const body = parse(z.object({ email: z.string().max(254), name: z.string().max(120).default(''), role, password: z.string().max(200) }), req.body);
    const u = await auth.createUser(body);
    ctx.audit.log(p, 'user.create', 'user', u.id, { email: u.email, role: u.role });
    reply.code(201);
    return serializeUser(u);
  });

  app.patch('/api/v1/users/:id', async (req) => {
    const p = need(req, 'admin', 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ name: z.string().max(120).optional(), role: role.optional(), disabled: z.boolean().optional() }), req.body);
    const u = auth.updateUser(id, body, p.userId);
    ctx.audit.log(p, 'user.update', 'user', id, body);
    return serializeUser(u);
  });

  app.post('/api/v1/users/:id/password', async (req) => {
    const p = need(req, 'admin', 'admin');
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ password: z.string().max(200) }), req.body);
    await auth.setPassword(id, body.password);
    auth.revokeAllSessions(id);
    ctx.audit.log(p, 'user.password_reset', 'user', id);
    return { ok: true };
  });

  app.delete('/api/v1/users/:id', async (req) => {
    const p = need(req, 'admin', 'admin');
    const { id } = parse(idParam, req.params);
    const u = auth.getUser(id);
    auth.deleteUser(id, p.userId);
    ctx.audit.log(p, 'user.delete', 'user', id, { email: u.email });
    return { ok: true };
  });

  app.post('/api/v1/invites', async (req, reply) => {
    const p = need(req, 'admin', 'admin');
    const body = parse(z.object({ email: z.string().max(254), role }), req.body);
    const inv = auth.createInvite(body.email, body.role, p.userId);
    ctx.audit.log(p, 'invite.create', 'invite', null, { email: body.email, role: body.role });
    reply.code(201);
    return { url: `${ctx.config.appUrl}/einladung/${inv.token}`, expiresAt: iso(inv.expiresAt) };
  });

  app.delete('/api/v1/invites/:id', async (req) => {
    const p = need(req, 'admin', 'admin');
    const { id } = parse(idParam, req.params);
    auth.revokeInvite(id);
    ctx.audit.log(p, 'invite.revoke', 'invite', id);
    return { ok: true };
  });

  // ----------------------------------------------------------- API-Tokens
  app.get('/api/v1/tokens', async (req) => {
    const p = need(req);
    const all = (req.query as { all?: string }).all === '1' && p.role === 'admin';
    return { items: auth.listTokens(all ? null : p.userId) };
  });

  app.post('/api/v1/tokens', async (req, reply) => {
    const p = need(req);
    if (p.scope) throw new AppError(403, 'forbidden', 'Tokens lassen sich nur in der Oberfläche erstellen, nicht per Token.');
    const body = parse(
      z.object({ name: z.string().trim().min(1).max(80), scope: z.enum(['read', 'write', 'admin']), expiresInDays: z.number().int().min(1).max(3650).nullable().default(365) }),
      req.body,
    );
    const t = auth.createToken(p.userId, body.name, body.scope, body.expiresInDays);
    ctx.audit.log(p, 'token.create', 'token', t.id, { name: body.name, scope: body.scope });
    reply.code(201);
    return { id: t.id, token: t.secret, note: 'Das Token wird nur jetzt angezeigt. Bitte sicher aufbewahren.' };
  });

  app.delete('/api/v1/tokens/:id', async (req) => {
    const p = need(req);
    const { id } = parse(idParam, req.params);
    auth.revokeToken(id, p.userId, p.role === 'admin');
    ctx.audit.log(p, 'token.revoke', 'token', id);
    return { ok: true };
  });

  // ----------------------------------------------------------- Sicherungen
  const backups = ctx.jobs.backups;
  app.get('/api/v1/backups', async (req) => {
    need(req, 'admin', 'admin');
    return {
      items: backups.list(),
      intervalHours: ctx.config.backup.intervalHours,
      keep: ctx.config.backup.keep,
      directory: ctx.config.backupDir,
      lastError: ctx.jobs.lastBackupError,
    };
  });

  app.post('/api/v1/backups', async (req, reply) => {
    const p = need(req, 'admin', 'admin');
    const b = await backups.create('manuell');
    ctx.audit.log(p, 'backup.create', 'backup', null, { name: b.name });
    reply.code(201);
    return b;
  });

  app.get('/api/v1/backups/:name/download', async (req, reply) => {
    const p = need(req, 'admin', 'admin');
    const { name } = req.params as { name: string };
    const file = backups.pathOf(name);
    ctx.audit.log(p, 'backup.download', 'backup', null, { name });
    reply.header('content-disposition', `attachment; filename="filum-${name}"`).type('application/vnd.sqlite3');
    return reply.send(fs.createReadStream(file));
  });

  app.delete('/api/v1/backups/:name', async (req) => {
    const p = need(req, 'admin', 'admin');
    const { name } = req.params as { name: string };
    backups.remove(name);
    ctx.audit.log(p, 'backup.delete', 'backup', null, { name });
    return { ok: true };
  });

  const scheduleRestart = () => {
    setTimeout(() => {
      ctx.log.warn('Neustart für die Wiederherstellung');
      process.kill(process.pid, 'SIGTERM');
    }, 500).unref();
  };

  app.post('/api/v1/backups/:name/restore', async (req) => {
    const p = need(req, 'admin', 'admin');
    const { name } = req.params as { name: string };
    const info = backups.stage(backups.pathOf(name));
    ctx.audit.log(p, 'backup.restore', 'backup', null, { name, ...info });
    scheduleRestart();
    return { ok: true, ...info, message: 'Filum startet neu und spielt die Sicherung ein. Die aktuelle Datenbank wird vorher gesichert.' };
  });

  app.addContentTypeParser(['application/octet-stream', 'application/vnd.sqlite3', 'application/x-sqlite3'], { parseAs: 'buffer', bodyLimit: 512 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );
  app.post('/api/v1/backups/upload', { bodyLimit: 512 * 1024 * 1024 }, async (req) => {
    const p = need(req, 'admin', 'admin');
    if (!Buffer.isBuffer(req.body)) throw new AppError(415, 'invalid', 'Bitte die Sicherungsdatei als application/octet-stream senden.');
    // Ins Datenverzeichnis, nicht nach /tmp (im Container ein kleines tmpfs)
    const tmp = path.join(ctx.config.dataDir, `upload-${process.pid}-${Date.now()}.db`);
    fs.writeFileSync(tmp, req.body);
    try {
      const restore = (req.query as { restore?: string }).restore === '1';
      if (restore) {
        const info = backups.stage(tmp);
        ctx.audit.log(p, 'backup.restore_upload', 'backup', null, info);
        scheduleRestart();
        return { ok: true, ...info, message: 'Filum startet neu und spielt die Sicherung ein. Die aktuelle Datenbank wird vorher gesichert.' };
      }
      const { verifyBackupFile } = await import('../../services/backup.js');
      return verifyBackupFile(tmp);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  // ----------------------------------------------------------- Protokoll, Meldungen, Reserviert
  app.get('/api/v1/audit', async (req) => {
    need(req, 'admin', 'admin');
    const q = req.query as { before?: string; entity?: string; entityId?: string; limit?: string };
    return {
      items: ctx.audit.list({
        limit: Math.min(Number(q.limit) || 100, 500),
        before: Number(q.before) || undefined,
        entity: q.entity || undefined,
        entityId: Number(q.entityId) || undefined,
      }),
    };
  });

  app.get('/api/v1/links/:id/history', async (req) => {
    need(req);
    const { id } = parse(idParam, req.params);
    return { items: ctx.audit.list({ limit: 50, entity: 'link', entityId: id }) };
  });

  app.get('/api/v1/reports', async (req) => {
    need(req, 'editor');
    const rows = db
      .prepare(
        `SELECT r.*, l.slug, l.url, d.host, r.short_label FROM reports r LEFT JOIN links l ON l.id = r.link_id LEFT JOIN domains d ON d.id = l.domain_id
         ORDER BY r.status = 'open' DESC, r.id DESC LIMIT 200`,
      )
      .all() as {
      id: number;
      link_id: number | null;
      created_at: number;
      reason: string;
      message: string;
      status: string;
      slug: string;
      url: string;
      host: string;
      short_label: string | null;
    }[];
    return {
      items: rows.map((r) => ({
        id: r.id,
        linkId: r.link_id,
        // Nach dem Löschen des Links bleibt die beim Melden gemerkte Kurzadresse lesbar.
        shortLabel: r.host ? `${r.host}/${r.slug}` : r.short_label,
        url: r.url,
        at: iso(r.created_at),
        reason: r.reason,
        message: r.message,
        status: r.status,
      })),
    };
  });

  app.patch('/api/v1/reports/:id', async (req) => {
    const p = need(req, 'editor', 'write');
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ status: z.enum(['open', 'dismissed', 'resolved']) }), req.body);
    const r = db.prepare('UPDATE reports SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?').run(body.status, p.userId, Math.floor(Date.now() / 1000), id);
    if (!r.changes) throw notFound('Meldung');
    ctx.audit.log(p, 'report.update', 'report', id, body);
    return { ok: true };
  });

  app.get('/api/v1/reserved', async (req) => {
    need(req, 'admin');
    return {
      items: (db
        .prepare(
          `SELECT t.domain_id, d.host, t.slug, t.former_url, t.deleted_at, u.email FROM slug_tombstones t JOIN domains d ON d.id = t.domain_id
           LEFT JOIN users u ON u.id = t.deleted_by ORDER BY t.deleted_at DESC LIMIT 500`,
        )
        .all() as { domain_id: number; host: string; slug: string; former_url: string; deleted_at: number; email: string | null }[]).map((r) => ({
        domainId: r.domain_id,
        host: r.host,
        slug: r.slug,
        formerUrl: r.former_url,
        deletedAt: iso(r.deleted_at),
        deletedBy: r.email,
      })),
    };
  });

  app.delete('/api/v1/reserved/:domainId/:slug', async (req) => {
    const p = need(req, 'admin', 'admin');
    const { domainId, slug } = req.params as { domainId: string; slug: string };
    const r = db.prepare('DELETE FROM slug_tombstones WHERE domain_id = ? AND slug_key = ?').run(Number(domainId), slug.toLowerCase());
    if (!r.changes) throw notFound('Reservierte Adresse');
    ctx.resolver.invalidate(Number(domainId), slug.toLowerCase());
    ctx.audit.log(p, 'reserved.release', 'domain', Number(domainId), { slug });
    return { ok: true };
  });

  // ----------------------------------------------------------- Systemzustand
  app.get('/api/v1/system', async (req) => {
    need(req, 'admin');
    const size = (f: string) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
    const dbBytes = size(ctx.config.dbPath) + size(`${ctx.config.dbPath}-wal`);
    const lastBackup = ctx.jobs.backups.list()[0] ?? null;
    const warnings: string[] = [];
    if (!ctx.domains.all().some((d) => d.status === 'active')) warnings.push('Es ist keine aktive Kurzlink-Domain eingerichtet.');
    if (ctx.config.backup.intervalHours <= 0) warnings.push('Automatische Sicherungen sind abgeschaltet (BACKUP_INTERVAL_HOURS=0).');
    if (ctx.jobs.lastBackupError) warnings.push(`Letzte automatische Sicherung fehlgeschlagen: ${ctx.jobs.lastBackupError}`);
    if (lastBackup && Date.now() - Date.parse(lastBackup.createdAt) > 3 * 86400_000 && ctx.config.backup.intervalHours > 0) {
      warnings.push('Die neueste Sicherung ist älter als drei Tage.');
    }
    if (!ctx.config.appUrl.startsWith('https://')) warnings.push('APP_URL verwendet kein HTTPS. Im Intranet möglich, aber Anmeldedaten gehen unverschlüsselt über das Netz.');
    const openReports = (db.prepare("SELECT COUNT(*) n FROM reports WHERE status = 'open'").get() as { n: number }).n;
    if (openReports) warnings.push(`${openReports} offene Missbrauchsmeldung${openReports > 1 ? 'en' : ''}.`);
    return {
      version: ctx.config.version,
      schema: currentSchemaVersion(db),
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      uptimeSeconds: Math.round((Date.now() - ctx.startedAt) / 1000),
      dbBytes,
      dataDir: ctx.config.dataDir,
      links: (db.prepare('SELECT COUNT(*) n FROM links').get() as { n: number }).n,
      users: auth.userCount(),
      cacheEntries: ctx.resolver.size(),
      lastBackup,
      appUrl: ctx.config.appUrl,
      publicPort: ctx.config.publicPort,
      adminPort: ctx.config.adminPort,
      oidc: Boolean(ctx.config.oidc.issuer),
      fetchAllowPrivate: ctx.config.fetch.allowPrivate,
      fetchAllowHosts: ctx.config.fetch.allowHosts,
      tessera: ctx.config.tessera.url || null,
      warnings,
      openReports,
    };
  });
}
