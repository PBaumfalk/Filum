import type { Config } from './config.js';
import type { DB } from './db/db.js';
import type { Logger } from './lib/log.js';
import type { Resolver } from './redirect/resolver.js';
import type { Audit } from './services/audit.js';
import type { Auth } from './services/auth.js';
import type { Domains } from './services/domains.js';
import type { Links } from './services/links.js';
import type { SettingsStore } from './services/settings.js';
import type { Stats } from './services/stats.js';
import type { Jobs } from './services/jobs.js';

export interface Ctx {
  config: Config;
  db: DB;
  log: Logger;
  settings: SettingsStore;
  audit: Audit;
  domains: Domains;
  links: Links;
  stats: Stats;
  auth: Auth;
  resolver: Resolver;
  jobs: Jobs;
  /** Zufällige Kennung dieser Installation (für den HTTP-Domainnachweis) */
  instanceId: string;
  startedAt: number;
}
