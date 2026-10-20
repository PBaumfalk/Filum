import path from 'node:path';

/**
 * Zentrale Konfiguration aus Umgebungsvariablen.
 * Jede Variable ist in docs/konfiguration.md beschrieben.
 */

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v.trim();
}

function int(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (v === undefined || v === '') return fallback;
  // Streng: nur Ziffern. parseInt würde "24h" still als 24 lesen.
  if (!/^\d+$/.test(v)) throw new Error(`Umgebungsvariable ${name} muss eine ganze Zahl ohne Einheit sein (ist: "${v}").`);
  return Number(v);
}

const TRUE_WORDS = ['1', 'true', 'yes', 'ja', 'on'];
const FALSE_WORDS = ['0', 'false', 'no', 'nein', 'off'];

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === '') return fallback;
  if (TRUE_WORDS.includes(v)) return true;
  if (FALSE_WORDS.includes(v)) return false;
  throw new Error(`Umgebungsvariable ${name} muss true oder false sein (ist: "${process.env[name]}").`);
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

function list(name: string): string[] {
  return str(name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface Config {
  dataDir: string;
  dbPath: string;
  backupDir: string;
  /** Öffentliche Adresse der Verwaltungsoberfläche, z. B. https://filum.intranet.firma.de */
  appUrl: string;
  adminHost: string;
  /** Verwaltung nur unter dem Host aus APP_URL beantworten */
  strictAdminHost: boolean;
  publicPort: number;
  adminPort: number;
  host: string;
  /** Liste vertrauenswürdiger Proxy-Adressen/Netze für X-Forwarded-* */
  trustProxy: string[] | boolean;
  secureCookies: boolean;
  logLevel: string;
  /** Domain, die beim ersten Start angelegt wird */
  initialDomain: string;
  setupCode: string;
  oidc: {
    issuer: string;
    clientId: string;
    clientSecret: string;
    scopes: string;
    roleClaim: string;
    adminGroups: string[];
    editorGroups: string[];
    memberGroups: string[];
    defaultRole: 'admin' | 'editor' | 'member' | 'viewer' | 'none';
    buttonLabel: string;
  };
  disableLocalLogin: boolean;
  fetch: {
    /** Hosts/Netze, die trotz SSRF-Schutz abgerufen werden dürfen (Intranet-Ziele) */
    allowHosts: string[];
    allowPrivate: boolean;
    timeoutMs: number;
    userAgent: string;
  };
  healthCheckIntervalMin: number;
  backup: {
    intervalHours: number;
    keep: number;
  };
  tessera: {
    url: string;
    token: string;
  };
  version: string;
}

export function loadConfig(): Config {
  const dataDir = path.resolve(str('DATA_DIR', './data'));
  const appUrl = str('APP_URL', 'http://localhost:8081').replace(/\/+$/, '');
  let adminHost = '';
  try {
    adminHost = new URL(appUrl).host.toLowerCase();
  } catch {
    throw new Error(`APP_URL ist keine gültige Adresse: "${appUrl}". Beispiel: https://filum.intranet.firma.de`);
  }
  // Standard: Proxys aus privaten Netzen (Docker-Bridge, LAN) gelten als vertrauenswürdig.
  const tp = str('TRUST_PROXY', 'loopback,linklocal,uniquelocal');
  const tpLower = tp.toLowerCase();
  const trustProxy = tpLower === 'true' ? true : tpLower === 'false' ? false : tp.split(',').map((s) => s.trim()).filter(Boolean);
  const logLevel = str('LOG_LEVEL', 'info').toLowerCase();
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`LOG_LEVEL muss einer dieser Werte sein: ${LOG_LEVELS.join(', ')} (ist: "${str('LOG_LEVEL')}").`);
  }
  const role = str('OIDC_DEFAULT_ROLE', 'member') as Config['oidc']['defaultRole'];
  if (!['admin', 'editor', 'member', 'viewer', 'none'].includes(role)) {
    throw new Error('OIDC_DEFAULT_ROLE muss admin, editor, member, viewer oder none sein.');
  }
  return {
    dataDir,
    dbPath: path.join(dataDir, 'filum.db'),
    backupDir: path.join(dataDir, 'backups'),
    appUrl,
    adminHost,
    strictAdminHost: bool('STRICT_ADMIN_HOST', false),
    publicPort: int('PUBLIC_PORT', 8080),
    adminPort: int('ADMIN_PORT', 8081),
    host: str('HOST', '0.0.0.0'),
    trustProxy,
    secureCookies: bool('SECURE_COOKIES', appUrl.startsWith('https://')),
    logLevel,
    initialDomain: str('DEFAULT_DOMAIN').toLowerCase(),
    setupCode: str('SETUP_CODE'),
    oidc: {
      issuer: str('OIDC_ISSUER'),
      clientId: str('OIDC_CLIENT_ID'),
      clientSecret: str('OIDC_CLIENT_SECRET'),
      scopes: str('OIDC_SCOPES', 'openid profile email groups'),
      roleClaim: str('OIDC_GROUPS_CLAIM', 'groups'),
      adminGroups: list('OIDC_ADMIN_GROUPS'),
      editorGroups: list('OIDC_EDITOR_GROUPS'),
      memberGroups: list('OIDC_MEMBER_GROUPS'),
      defaultRole: role,
      buttonLabel: str('OIDC_BUTTON_LABEL', 'Mit Firmenkonto anmelden'),
    },
    disableLocalLogin: bool('DISABLE_LOCAL_LOGIN', false),
    fetch: {
      allowHosts: list('FETCH_ALLOW_HOSTS'),
      allowPrivate: bool('FETCH_ALLOW_PRIVATE', false),
      timeoutMs: int('FETCH_TIMEOUT_MS', 6000),
      userAgent: str('FETCH_USER_AGENT', 'Filum-Linkpruefung/1.0 (+self-hosted)'),
    },
    healthCheckIntervalMin: int('HEALTH_CHECK_INTERVAL_MIN', 360),
    backup: {
      intervalHours: int('BACKUP_INTERVAL_HOURS', 24),
      keep: int('BACKUP_KEEP', 14),
    },
    tessera: {
      url: str('TESSERA_URL').replace(/\/+$/, ''),
      token: str('TESSERA_TOKEN'),
    },
    // Angezeigte Version (Einstellungen → System, Log). Standard: Version aus package.json, beim Build eingesetzt.
    version: str('FILUM_VERSION', process.env.FILUM_BUILD_VERSION ?? '1.0.0'),
  };
}

export function oidcEnabled(c: Config): boolean {
  return Boolean(c.oidc.issuer && c.oidc.clientId);
}
