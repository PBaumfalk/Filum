import fs from 'node:fs';
import type { Config } from './config.js';
import type { Ctx } from './context.js';
import { openDatabase } from './db/db.js';
import { randomToken, setupCode } from './lib/crypto.js';
import type { Logger } from './lib/log.js';
import { Resolver } from './redirect/resolver.js';
import { buildPublicServer } from './redirect/public.js';
import { buildAdminServer } from './admin/server.js';
import { Audit } from './services/audit.js';
import { Auth } from './services/auth.js';
import { applyStagedRestore, Backups } from './services/backup.js';
import { Domains } from './services/domains.js';
import { Jobs } from './services/jobs.js';
import { Links } from './services/links.js';
import { SettingsStore } from './services/settings.js';
import { Stats } from './services/stats.js';

/** Bricht mit einer verständlichen Meldung ab, wenn das Datenverzeichnis nicht beschreibbar ist. */
export function ensureDataDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (e) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    throw new Error(
      `Das Datenverzeichnis ${dir} ist nicht beschreibbar (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}). ` +
        `Filum läuft als Benutzer-ID ${uid ?? 'unbekannt'}. Bei einem eingebundenen Host-Ordner die Rechte anpassen, ` +
        `z. B. sudo chown -R ${uid ?? 1000}:${uid ?? 1000} <pfad-auf-dem-host>. Siehe docs/handbuch/18-betrieb.md.`,
    );
  }
}

export async function createApp(config: Config, log: Logger) {
  ensureDataDir(config.dataDir);
  const restore = applyStagedRestore(config.dataDir, config.dbPath, config.backupDir);
  if (restore.restored) log.warn({ previous: restore.previous }, 'Sicherung wiederhergestellt; vorheriger Stand wurde gesichert');

  const db = openDatabase(config.dbPath, log, config.backupDir);
  const meta = (key: string) => (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  const setMeta = (key: string, value: string) => db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(key, value);

  let instanceId = meta('instance_id');
  if (!instanceId) {
    instanceId = `filum-${randomToken(16)}`;
    setMeta('instance_id', instanceId);
  }

  const settings = new SettingsStore(db);
  const audit = new Audit(db);
  const domains = new Domains(db);
  const links = new Links(db, domains, settings, audit);
  const stats = new Stats(db, settings, log);
  const auth = new Auth(db);
  const resolver = new Resolver(db);
  const backups = new Backups(db, config.backupDir, config.dataDir);
  const jobs = new Jobs(db, config, log, settings, links, stats, auth, audit, backups);

  links.onChange((keys) => {
    for (const k of keys) resolver.invalidate(k.domainId, k.slugKey);
  });

  // Erste Domain aus der Konfiguration anlegen (nur wenn noch keine existiert)
  if (config.initialDomain && domains.all().length === 0) {
    const d = domains.create({ host: config.initialDomain, kind: 'internal', https: !config.initialDomain.includes('localhost'), isDefault: true, activate: true });
    log.info({ host: d.host }, 'Standarddomain aus DEFAULT_DOMAIN angelegt');
  }

  // Einrichtungscode für das erste Konto – nie ein Standardpasswort
  if (auth.userCount() === 0) {
    let code = meta('setup_code');
    if (config.setupCode) code = config.setupCode;
    if (!code) code = setupCode();
    setMeta('setup_code', code);
    log.warn(`Einrichtungscode: ${code} – unter ${config.appUrl} eingeben, um das erste Admin-Konto anzulegen.`);
  }

  const ctx: Ctx = { config, db, log, settings, audit, domains, links, stats, auth, resolver, jobs, instanceId, startedAt: Date.now() };
  const publicServer = buildPublicServer(ctx);
  const adminServer = await buildAdminServer(ctx);

  return {
    ctx,
    publicServer,
    adminServer,
    start() {
      stats.start();
      jobs.start();
    },
    async close() {
      await jobs.stop();
      await Promise.allSettled([publicServer.close(), adminServer.close()]);
      stats.stop();
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    },
  };
}
