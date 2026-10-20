/**
 * Datenbankmigrationen. Jede Migration läuft genau einmal, in einer Transaktion.
 * Bestehende Migrationen werden NIE geändert – nur neue angehängt. Sonst brechen
 * Installationen, die bereits migriert sind.
 */
export const migrations: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'grundschema',
    sql: `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin','editor','member','viewer')),
  password_hash TEXT,
  oidc_issuer TEXT,
  oidc_sub TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER,
  password_changed_at INTEGER
);
CREATE UNIQUE INDEX users_email ON users(email);
CREATE UNIQUE INDEX users_oidc ON users(oidc_issuer, oidc_sub) WHERE oidc_sub IS NOT NULL;

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE invites (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('read','write','admin')),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE domains (
  id INTEGER PRIMARY KEY,
  host TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('internal','public')),
  is_default INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending','active','disabled')),
  verify_token TEXT NOT NULL,
  verify_method TEXT,
  verified_at INTEGER,
  https INTEGER NOT NULL DEFAULT 1,
  root_url TEXT,
  not_found_url TEXT,
  slug_length INTEGER NOT NULL DEFAULT 6,
  permanent_max_age INTEGER NOT NULL DEFAULT 3600,
  preview_suffix INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  last_check_at INTEGER,
  last_check_result TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE collections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT 'slate',
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT 'crimson',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_term TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  starts_at INTEGER,
  ends_at INTEGER,
  description TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT 'slate'
);

CREATE TABLE links (
  id INTEGER PRIMARY KEY,
  domain_id INTEGER NOT NULL REFERENCES domains(id),
  slug TEXT NOT NULL,
  slug_key TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  redirect_type INTEGER NOT NULL DEFAULT 302 CHECK (redirect_type IN (301,302,307,308)),
  enabled INTEGER NOT NULL DEFAULT 1,
  archived_at INTEGER,
  protected INTEGER NOT NULL DEFAULT 0,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  starts_at INTEGER,
  expires_at INTEGER,
  max_clicks INTEGER,
  fallback_url TEXT,
  password_hash TEXT,
  forward_query INTEGER NOT NULL DEFAULT 1,
  utm TEXT,
  rules TEXT,
  meta_title TEXT,
  meta_description TEXT,
  meta_image_id INTEGER,
  icon_image_id INTEGER,
  meta_fetched_at INTEGER,
  health_status TEXT,
  health_code INTEGER,
  health_detail TEXT,
  health_checked_at INTEGER,
  click_count INTEGER NOT NULL DEFAULT 0,
  last_click_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX links_slug ON links(domain_id, slug_key);
CREATE INDEX links_created ON links(created_at DESC);
CREATE INDEX links_updated ON links(updated_at DESC);
CREATE INDEX links_clicks ON links(click_count DESC);
CREATE INDEX links_campaign ON links(campaign_id);
CREATE INDEX links_collection ON links(collection_id);
CREATE INDEX links_owner ON links(owner_id);

CREATE TABLE link_tags (
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
);
CREATE INDEX link_tags_tag ON link_tags(tag_id);

CREATE TABLE favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, link_id)
);

CREATE TABLE link_versions (
  id INTEGER PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  snapshot TEXT NOT NULL
);
CREATE INDEX link_versions_link ON link_versions(link_id, id DESC);

-- Gelöschte Kurzadressen bleiben reserviert, damit ein gedruckter alter Link
-- nie unbemerkt auf ein fremdes neues Ziel zeigt.
CREATE TABLE slug_tombstones (
  domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  slug_key TEXT NOT NULL,
  slug TEXT NOT NULL,
  former_url TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (domain_id, slug_key)
);

CREATE TABLE presets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  settings TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE images (
  id INTEGER PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- Statistik: ausschließlich Aggregate. Es gibt keine Einzelereignisse,
-- keine IP-Adressen und keine Kennungen von Besuchern.
CREATE TABLE stats_hourly (
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  hour INTEGER NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  qr INTEGER NOT NULL DEFAULT 0,
  bots INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, hour)
) WITHOUT ROWID;
CREATE INDEX stats_hourly_hour ON stats_hourly(hour);

CREATE TABLE stats_dims (
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  dim TEXT NOT NULL,
  value TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day, dim, value)
) WITHOUT ROWID;
CREATE INDEX stats_dims_day ON stats_dims(day);

CREATE TABLE stats_outcomes (
  domain_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (domain_id, day, outcome)
) WITHOUT ROWID;

CREATE TABLE stats_unknown (
  domain_id INTEGER NOT NULL,
  slug TEXT NOT NULL,
  day INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (domain_id, slug, day)
) WITHOUT ROWID;
CREATE INDEX stats_unknown_day ON stats_unknown(day);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  token_id INTEGER,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id INTEGER,
  details TEXT
);
CREATE INDEX audit_ts ON audit_log(ts DESC);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  link_id INTEGER REFERENCES links(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','resolved')),
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at INTEGER
);

-- Volltextsuche über Kurzadresse, Ziel, Titel und Notizen (Teilwortsuche).
CREATE VIRTUAL TABLE links_fts USING fts5(
  slug, url, title, notes, tags,
  content='', contentless_delete=1, tokenize='trigram'
);
`,
  },
  {
    version: 2,
    name: 'reservierung-bei-umbenennung',
    sql: `
-- Auch umbenannte oder verschobene Kurzadressen bleiben reserviert. Damit derselbe
-- Link seine alte Adresse zurückbekommen kann, merkt sich die Reservierung ihre Herkunft.
ALTER TABLE slug_tombstones ADD COLUMN former_link_id INTEGER;
ALTER TABLE slug_tombstones ADD COLUMN reason TEXT NOT NULL DEFAULT 'deleted';
`,
  },
  {
    version: 3,
    name: 'meldungen-bleiben-nach-loeschen',
    sql: `
-- Missbrauchsmeldungen überdauern das Löschen des Links: link_id wird geleert statt die
-- Meldung zu löschen, die Kurzadresse steht zusätzlich in short_label.
CREATE TABLE reports_new (
  id INTEGER PRIMARY KEY,
  link_id INTEGER REFERENCES links(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','resolved')),
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at INTEGER,
  short_label TEXT
);
INSERT INTO reports_new(id, link_id, created_at, reason, message, status, resolved_by, resolved_at, short_label)
  SELECT r.id, r.link_id, r.created_at, r.reason, r.message, r.status, r.resolved_by, r.resolved_at,
         (SELECT d.host || '/' || l.slug FROM links l JOIN domains d ON d.id = l.domain_id WHERE l.id = r.link_id)
  FROM reports r;
DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;
CREATE INDEX reports_link ON reports(link_id);
`,
  },
];
