import type { DB } from '../db/db.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { iso, now } from '../lib/time.js';
import type { Role } from './links.js';

export const SESSION_COOKIE = 'filum_session';
export const SESSION_DAYS = 14;
export const TOKEN_PREFIX = 'flm_';

export interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  password_hash: string | null;
  oidc_issuer: string | null;
  oidc_sub: string | null;
  disabled: number;
  created_at: number;
  last_login_at: number | null;
  password_changed_at: number | null;
}

export function serializeUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    disabled: Boolean(u.disabled),
    hasPassword: Boolean(u.password_hash),
    sso: Boolean(u.oidc_sub),
    createdAt: iso(u.created_at),
    lastLoginAt: iso(u.last_login_at),
  };
}

export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, editor: 2, admin: 3 };

export function validatePassword(pw: string): void {
  if (pw.length < 10) throw new AppError(400, 'weak_password', 'Das Passwort muss mindestens 10 Zeichen lang sein.', 'password');
  if (pw.length > 200) throw new AppError(400, 'weak_password', 'Das Passwort darf höchstens 200 Zeichen lang sein.', 'password');
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|passwort|password|qwertz|qwerty)/i.test(pw)) {
    throw new AppError(400, 'weak_password', 'Dieses Passwort ist zu leicht zu erraten.', 'password');
  }
}

/**
 * Bremst Anmeldeversuche: je Konto und je Absender-Adresse. Nur im Speicher,
 * die Adressen werden nicht gespeichert und nach 30 Minuten vergessen.
 */
export class LoginThrottle {
  private attempts = new Map<string, { fails: number; until: number; last: number }>();

  check(keys: string[]): number {
    const t = Date.now();
    let wait = 0;
    for (const k of keys) {
      const a = this.attempts.get(k);
      if (a && a.until > t) wait = Math.max(wait, a.until - t);
    }
    return Math.ceil(wait / 1000);
  }

  fail(keys: string[]): void {
    const t = Date.now();
    for (const k of keys) {
      const a = this.attempts.get(k) ?? { fails: 0, until: 0, last: t };
      a.fails++;
      a.last = t;
      // ab dem 5. Fehlversuch: 2, 4, 8 … Sekunden Sperre, höchstens 15 Minuten
      if (a.fails >= 5) a.until = t + Math.min(2 ** (a.fails - 4) * 1000, 15 * 60_000);
      this.attempts.set(k, a);
    }
    if (this.attempts.size > 50_000) this.sweep();
  }

  succeed(keys: string[]): void {
    for (const k of keys) this.attempts.delete(k);
  }

  sweep(): void {
    const cut = Date.now() - 30 * 60_000;
    for (const [k, a] of this.attempts) if (a.last < cut && a.until < Date.now()) this.attempts.delete(k);
  }
}

export class Auth {
  readonly throttle = new LoginThrottle();

  constructor(private db: DB) {}

  userCount(): number {
    return (this.db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
  }

  getUser(id: number): UserRow {
    const u = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!u) throw notFound('Konto');
    return u;
  }

  findByEmail(email: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim()) as UserRow | undefined;
  }

  listUsers(): UserRow[] {
    return this.db.prepare('SELECT * FROM users ORDER BY disabled, name COLLATE NOCASE, email').all() as UserRow[];
  }

  async createUser(input: { email: string; name: string; role: Role; password?: string }): Promise<UserRow> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 254) throw new AppError(400, 'invalid', 'Bitte eine gültige E-Mail-Adresse eingeben.', 'email');
    if (this.findByEmail(email)) throw conflict('Für diese E-Mail-Adresse gibt es bereits ein Konto.', 'email');
    let hash: string | null = null;
    if (input.password) {
      validatePassword(input.password);
      hash = await hashPassword(input.password);
    }
    const t = now();
    const id = Number(
      this.db
        .prepare('INSERT INTO users(email, name, role, password_hash, created_at, password_changed_at) VALUES (?,?,?,?,?,?)')
        .run(email, input.name.trim().slice(0, 120), input.role, hash, t, hash ? t : null).lastInsertRowid,
    );
    return this.getUser(id);
  }

  updateUser(id: number, patch: { name?: string; role?: Role; disabled?: boolean }, actingUserId: number): UserRow {
    const u = this.getUser(id);
    if (id === actingUserId && (patch.disabled || (patch.role && patch.role !== u.role))) {
      throw forbidden('Die eigene Rolle oder Sperre kann nur ein anderer Admin ändern.');
    }
    if (u.role === 'admin' && ((patch.role && patch.role !== 'admin') || patch.disabled)) this.assertAnotherAdmin(id);
    if (patch.name !== undefined) this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(patch.name.trim().slice(0, 120), id);
    if (patch.role !== undefined) this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(patch.role, id);
    if (patch.disabled !== undefined) {
      this.db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(patch.disabled ? 1 : 0, id);
      if (patch.disabled) this.revokeAllSessions(id);
    }
    return this.getUser(id);
  }

  private assertAnotherAdmin(exceptId: number): void {
    const n = (this.db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ?").get(exceptId) as { n: number }).n;
    if (!n) throw conflict('Es muss mindestens ein aktiver Admin übrig bleiben.');
  }

  deleteUser(id: number, actingUserId: number): void {
    if (id === actingUserId) throw forbidden('Das eigene Konto kann nicht gelöscht werden.');
    const u = this.getUser(id);
    if (u.role === 'admin') this.assertAnotherAdmin(id);
    // Links bleiben erhalten; sie gehen an die löschende Person über.
    this.db.transaction(() => {
      this.db.prepare('UPDATE links SET owner_id = ? WHERE owner_id = ?').run(actingUserId, id);
      this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    })();
  }

  async setPassword(id: number, password: string): Promise<void> {
    validatePassword(password);
    this.db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(await hashPassword(password), now(), id);
  }

  async checkPassword(email: string, password: string): Promise<UserRow | null> {
    const u = this.findByEmail(email);
    const ok = await verifyPassword(password, u?.password_hash);
    if (!u || !ok || u.disabled) return null;
    return u;
  }

  // ------------------------------------------------------------- Sitzungen

  createSession(userId: number, label: string): { token: string; expiresAt: number } {
    const token = randomToken(32);
    const t = now();
    const expiresAt = t + SESSION_DAYS * 86400;
    this.db
      .prepare('INSERT INTO sessions(id_hash, user_id, created_at, expires_at, last_seen_at, label) VALUES (?,?,?,?,?,?)')
      .run(sha256(token), userId, t, expiresAt, t, label.slice(0, 120));
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(t, userId);
    return { token, expiresAt };
  }

  resolveSession(token: string): { user: UserRow; sessionHash: string } | null {
    if (!token || token.length > 100) return null;
    const hash = sha256(token);
    const row = this.db.prepare('SELECT user_id, expires_at, last_seen_at FROM sessions WHERE id_hash = ?').get(hash) as
      | { user_id: number; expires_at: number; last_seen_at: number }
      | undefined;
    const t = now();
    if (!row || row.expires_at < t) return null;
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as UserRow | undefined;
    if (!user || user.disabled) return null;
    // Gleitende Verlängerung, höchstens einmal pro Stunde geschrieben
    if (t - row.last_seen_at > 3600) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?').run(t, t + SESSION_DAYS * 86400, hash);
    }
    return { user, sessionHash: hash };
  }

  revokeSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(token));
  }

  revokeAllSessions(userId: number, exceptHash?: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash <> ?').run(userId, exceptHash ?? '');
  }

  pruneSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
    this.db.prepare('DELETE FROM invites WHERE expires_at < ? AND used_at IS NULL').run(now() - 7 * 86400);
  }

  // ------------------------------------------------------------- API-Tokens

  createToken(userId: number, name: string, scope: 'read' | 'write' | 'admin', expiresInDays: number | null) {
    const user = this.getUser(userId);
    if (scope === 'admin' && user.role !== 'admin') throw forbidden('Nur Admins können Tokens mit Admin-Rechten erstellen.');
    if (scope === 'write' && user.role === 'viewer') throw forbidden('Ihre Rolle erlaubt nur lesende Tokens.');
    const secret = `${TOKEN_PREFIX}${randomToken(30)}`;
    const t = now();
    const id = Number(
      this.db
        .prepare('INSERT INTO api_tokens(user_id, name, prefix, token_hash, scope, created_at, expires_at) VALUES (?,?,?,?,?,?,?)')
        .run(userId, name.trim().slice(0, 80) || 'Token', secret.slice(0, 10), sha256(secret), scope, t, expiresInDays ? t + expiresInDays * 86400 : null)
        .lastInsertRowid,
    );
    return { id, secret };
  }

  resolveToken(secret: string): { user: UserRow; tokenId: number; scope: 'read' | 'write' | 'admin' } | null {
    if (!secret.startsWith(TOKEN_PREFIX) || secret.length > 100) return null;
    const row = this.db.prepare('SELECT id, user_id, scope, expires_at, revoked_at, last_used_at FROM api_tokens WHERE token_hash = ?').get(sha256(secret)) as
      | { id: number; user_id: number; scope: 'read' | 'write' | 'admin'; expires_at: number | null; revoked_at: number | null; last_used_at: number | null }
      | undefined;
    const t = now();
    if (!row || row.revoked_at || (row.expires_at && row.expires_at < t)) return null;
    const user = this.db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as UserRow | undefined;
    if (!user || user.disabled) return null;
    if (!row.last_used_at || t - row.last_used_at > 60) this.db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(t, row.id);
    return { user, tokenId: row.id, scope: row.scope };
  }

  listTokens(userId: number | null) {
    const rows = (userId === null
      ? this.db.prepare('SELECT t.*, u.email FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.revoked_at IS NULL ORDER BY t.id DESC').all()
      : this.db
          .prepare('SELECT t.*, u.email FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.user_id = ? AND t.revoked_at IS NULL ORDER BY t.id DESC')
          .all(userId)) as {
      id: number;
      user_id: number;
      email: string;
      name: string;
      prefix: string;
      scope: string;
      created_at: number;
      last_used_at: number | null;
      expires_at: number | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      owner: r.email,
      name: r.name,
      prefix: r.prefix,
      scope: r.scope,
      createdAt: iso(r.created_at),
      lastUsedAt: iso(r.last_used_at),
      expiresAt: iso(r.expires_at),
      expired: Boolean(r.expires_at && r.expires_at < now()),
    }));
  }

  revokeToken(id: number, userId: number, isAdmin: boolean): void {
    const row = this.db.prepare('SELECT user_id FROM api_tokens WHERE id = ?').get(id) as { user_id: number } | undefined;
    if (!row) throw notFound('Token');
    if (row.user_id !== userId && !isAdmin) throw forbidden();
    this.db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?').run(now(), id);
  }

  // ------------------------------------------------------------- Einladungen

  createInvite(email: string, role: Role, createdBy: number): { token: string; expiresAt: number } {
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(clean)) throw new AppError(400, 'invalid', 'Bitte eine gültige E-Mail-Adresse eingeben.', 'email');
    if (this.findByEmail(clean)) throw conflict('Für diese E-Mail-Adresse gibt es bereits ein Konto.', 'email');
    const token = randomToken(24);
    const expiresAt = now() + 7 * 86400;
    this.db
      .prepare('INSERT INTO invites(token_hash, email, role, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?)')
      .run(sha256(token), clean, role, createdBy, now(), expiresAt);
    return { token, expiresAt };
  }

  getInvite(token: string): { id: number; email: string; role: Role } | null {
    const row = this.db.prepare('SELECT id, email, role, expires_at, used_at FROM invites WHERE token_hash = ?').get(sha256(token)) as
      | { id: number; email: string; role: Role; expires_at: number; used_at: number | null }
      | undefined;
    if (!row || row.used_at || row.expires_at < now()) return null;
    return { id: row.id, email: row.email, role: row.role };
  }

  async acceptInvite(token: string, name: string, password: string): Promise<UserRow> {
    const inv = this.getInvite(token);
    if (!inv) throw new AppError(400, 'invite_invalid', 'Diese Einladung ist abgelaufen oder wurde schon verwendet. Bitte um eine neue Einladung.');
    const user = await this.createUser({ email: inv.email, name, role: inv.role, password });
    this.db.prepare('UPDATE invites SET used_at = ? WHERE id = ?').run(now(), inv.id);
    return user;
  }

  listInvites() {
    return (this.db
      .prepare('SELECT id, email, role, created_at, expires_at FROM invites WHERE used_at IS NULL AND expires_at > ? ORDER BY id DESC')
      .all(now()) as { id: number; email: string; role: string; created_at: number; expires_at: number }[]).map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      createdAt: iso(i.created_at),
      expiresAt: iso(i.expires_at),
    }));
  }

  revokeInvite(id: number): void {
    this.db.prepare('DELETE FROM invites WHERE id = ?').run(id);
  }

  // ------------------------------------------------------------- OIDC

  upsertOidcUser(issuer: string, sub: string, email: string, name: string, role: Role | null, emailVerified = false): UserRow {
    const existing = this.db.prepare('SELECT * FROM users WHERE oidc_issuer = ? AND oidc_sub = ?').get(issuer, sub) as UserRow | undefined;
    if (existing) {
      if (existing.disabled) throw forbidden('Dieses Konto ist gesperrt.');
      // Rolle aus Gruppen übernehmen, wenn eine Zuordnung konfiguriert ist
      if (role && role !== existing.role) this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, existing.id);
      if (name && name !== existing.name) this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, existing.id);
      return this.getUser(existing.id);
    }
    const byEmail = email ? this.findByEmail(email) : undefined;
    if (byEmail && !emailVerified) {
      throw forbidden('Für diese E-Mail-Adresse gibt es bereits ein Konto. Der Anmeldedienst hat die Adresse nicht als bestätigt gemeldet, daher wird es nicht automatisch verknüpft. Bitte an einen Admin wenden.');
    }
    if (byEmail) {
      // Ein bestehendes lokales Konto wird nur verknüpft, wenn der IdP die Adresse bestätigt hat (Prüfung im Aufrufer).
      if (byEmail.disabled) throw forbidden('Dieses Konto ist gesperrt.');
      this.db.prepare('UPDATE users SET oidc_issuer = ?, oidc_sub = ? WHERE id = ?').run(issuer, sub, byEmail.id);
      if (role && role !== byEmail.role) this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, byEmail.id);
      return this.getUser(byEmail.id);
    }
    if (!role) throw forbidden('Ihr Firmenkonto ist für Filum nicht freigeschaltet. Bitte wenden Sie sich an die IT.');
    const t = now();
    const id = Number(
      this.db
        .prepare('INSERT INTO users(email, name, role, oidc_issuer, oidc_sub, created_at) VALUES (?,?,?,?,?,?)')
        .run((email || `${sub}@oidc.invalid`).toLowerCase(), name.slice(0, 120), role, issuer, sub, t).lastInsertRowid,
    );
    return this.getUser(id);
  }
}

export function hasRole(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
