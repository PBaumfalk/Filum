import type { Config } from '../config.js';
import type { DB } from '../db/db.js';
import type { Logger } from '../lib/log.js';
import { sha256 } from '../lib/crypto.js';
import { decodeHtml, extractMeta, sniffImage } from '../lib/meta.js';
import { FetchBlockedError, safeFetch, type FetchPolicy } from '../lib/safefetch.js';
import { now } from '../lib/time.js';
import type { Audit } from './audit.js';
import type { Auth } from './auth.js';
import type { Backups } from './backup.js';
import type { Links } from './links.js';
import type { SettingsStore } from './settings.js';
import type { Stats } from './stats.js';

/** Kleine Warteschlange mit begrenzter Parallelität; Fehler bleiben im Log. */
class Queue {
  private pending: (() => Promise<void>)[] = [];
  private running = 0;
  private keys = new Set<string>();
  constructor(
    private concurrency: number,
    private log: Logger,
  ) {}
  push(key: string, fn: () => Promise<void>): void {
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.pending.push(async () => {
      try {
        await fn();
      } finally {
        this.keys.delete(key);
      }
    });
    this.pump();
  }
  private pump(): void {
    while (this.running < this.concurrency && this.pending.length) {
      const fn = this.pending.shift()!;
      this.running++;
      fn()
        .catch((err) => this.log.warn({ err }, 'Hintergrundaufgabe fehlgeschlagen'))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
  get size(): number {
    return this.pending.length + this.running;
  }
  /** Wartende Aufgaben verwerfen und laufende höchstens maxMs abwarten */
  async drain(maxMs: number): Promise<void> {
    this.pending = [];
    this.keys.clear();
    const until = Date.now() + maxMs;
    while (this.running && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
  }
  async idle(): Promise<void> {
    while (this.size) await new Promise((r) => setTimeout(r, 25));
  }
}

const HEALTH_TICK_MIN = 15;

export class Jobs {
  private metaQueue: Queue;
  private healthQueue: Queue;
  private timers: NodeJS.Timeout[] = [];
  private stopped = false;
  lastBackupError: string | null = null;

  constructor(
    private db: DB,
    private config: Config,
    private log: Logger,
    private settings: SettingsStore,
    private links: Links,
    private stats: Stats,
    private auth: Auth,
    private audit: Audit,
    readonly backups: Backups,
  ) {
    this.metaQueue = new Queue(2, log);
    this.healthQueue = new Queue(3, log);
  }

  policy(): FetchPolicy {
    return {
      allowHosts: this.config.fetch.allowHosts,
      allowPrivate: this.config.fetch.allowPrivate,
      timeoutMs: this.config.fetch.timeoutMs,
      userAgent: this.config.fetch.userAgent,
    };
  }

  start(): void {
    const every = (ms: number, fn: () => unknown, initialMs = ms) => {
      const run = () => {
        try {
          const r = fn();
          if (r instanceof Promise) r.catch((err) => this.log.error({ err }, 'Geplante Aufgabe fehlgeschlagen'));
        } catch (err) {
          this.log.error({ err }, 'Geplante Aufgabe fehlgeschlagen');
        }
      };
      const first = setTimeout(() => {
        run();
        const t = setInterval(run, ms);
        t.unref();
        this.timers.push(t);
      }, initialMs);
      first.unref();
      this.timers.push(first);
    };
    every(6 * 3600_000, () => this.housekeeping(), 60_000);
    if (this.config.healthCheckIntervalMin > 0) {
      // Alle 15 Minuten ein Teilstück statt einmal je Intervall alles auf einmal
      every(HEALTH_TICK_MIN * 60_000, () => this.scheduleHealthChecks(), 5 * 60_000);
    }
    if (this.config.backup.intervalHours > 0) {
      every(this.config.backup.intervalHours * 3600_000, () => this.autoBackup(), this.firstBackupDelay());
    }
  }

  /** Zeitgeber anhalten, Warteschlangen leeren und laufende Aufgaben kurz abwarten (vor dem Schließen der Datenbank) */
  async stop(maxMs = 3000): Promise<void> {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const until = Date.now() + maxMs;
    await this.metaQueue.drain(maxMs);
    await this.healthQueue.drain(Math.max(0, until - Date.now()));
  }

  private firstBackupDelay(): number {
    const last = this.backups.list().find((b) => b.kind === 'auto');
    if (!last) return 2 * 60_000;
    const due = Date.parse(last.createdAt) + this.config.backup.intervalHours * 3600_000 - Date.now();
    return Math.max(due, 2 * 60_000);
  }

  async autoBackup(): Promise<void> {
    try {
      const b = await this.backups.create('auto');
      const removed = this.backups.rotate(this.config.backup.keep);
      this.lastBackupError = null;
      this.log.info({ backup: b.name, size: b.size, removed }, 'Automatische Sicherung erstellt');
    } catch (err) {
      this.lastBackupError = (err as Error).message;
      this.log.error({ err }, 'Automatische Sicherung fehlgeschlagen');
    }
  }

  housekeeping(): void {
    const pruned = this.stats.prune();
    this.auth.pruneSessions();
    this.audit.prune(730);
    // Bilder ohne Verwendung entfernen
    this.db
      .prepare(
        'DELETE FROM images WHERE id NOT IN (SELECT meta_image_id FROM links WHERE meta_image_id IS NOT NULL UNION SELECT icon_image_id FROM links WHERE icon_image_id IS NOT NULL)',
      )
      .run();
    this.db.pragma('optimize');
    this.log.info({ pruned }, 'Aufräumen abgeschlossen');
  }

  // ------------------------------------------------------------- Vorschau-Daten

  queueMeta(linkId: number): void {
    if (this.stopped || !this.settings.get().fetchPreviews) return;
    this.metaQueue.push(`meta:${linkId}`, () => this.fetchMeta(linkId));
  }

  private storeImage(buf: Buffer): number | null {
    const mime = sniffImage(buf);
    if (!mime) return null;
    const hash = sha256(buf);
    const existing = this.db.prepare('SELECT id FROM images WHERE sha256 = ?').get(hash) as { id: number } | undefined;
    if (existing) return existing.id;
    return Number(this.db.prepare('INSERT INTO images(mime, data, sha256, created_at) VALUES (?,?,?,?)').run(mime, buf, hash, now()).lastInsertRowid);
  }

  private async fetchImage(url: string | null, maxBytes: number): Promise<number | null> {
    if (!url) return null;
    try {
      const res = await safeFetch(url, this.policy(), { maxBytes, accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' });
      if (res.status !== 200 || res.truncated) return null;
      return this.storeImage(res.body);
    } catch {
      return null;
    }
  }

  async fetchMeta(linkId: number): Promise<void> {
    let row;
    try {
      row = this.links.getRow(linkId);
    } catch {
      return;
    }
    if (!/^https?:/i.test(row.url)) return;
    try {
      const res = await safeFetch(row.url, this.policy(), { maxBytes: 768 * 1024 });
      const ct = res.headers['content-type'] ?? '';
      if (res.status >= 200 && res.status < 300 && /html|xml/i.test(ct)) {
        const meta = extractMeta(decodeHtml(res.body, ct), res.finalUrl);
        const imageId = await this.fetchImage(meta.image, 1024 * 1024);
        const iconId = await this.fetchImage(meta.icon, 128 * 1024);
        this.links.saveMeta(linkId, { title: meta.title, description: meta.description, imageId, iconId });
      } else {
        this.links.saveMeta(linkId, { title: '', description: '', imageId: null, iconId: null });
      }
      this.links.saveHealth(linkId, healthFrom(res.status, res.hops.length - 1));
    } catch (e) {
      this.links.saveMeta(linkId, { title: '', description: '', imageId: null, iconId: null });
      this.links.saveHealth(linkId, healthFromError(e));
    }
  }

  // ------------------------------------------------------------- Zielprüfung

  /**
   * Plant fällige Zielprüfungen. Ohne Vorgabe richtet sich die Menge je Durchlauf nach dem
   * Bestand, sodass jeder aktive Link etwa einmal je Intervall drankommt (mit 10 % Reserve).
   * Was noch in der Warteschlange steht, wird angerechnet.
   */
  scheduleHealthChecks(limit?: number): number {
    if (this.stopped || !this.settings.get().healthChecks) return 0;
    const intervalMin = Math.max(this.config.healthCheckIntervalMin, HEALTH_TICK_MIN);
    if (limit === undefined) {
      const active = (this.db.prepare('SELECT COUNT(*) n FROM links WHERE archived_at IS NULL AND enabled = 1').get() as { n: number }).n;
      limit = Math.max(100, Math.ceil((active * 1.1 * HEALTH_TICK_MIN) / intervalMin)) - this.healthQueue.size;
      if (limit <= 0) return 0;
    }
    const cut = now() - intervalMin * 60;
    const ids = this.db
      .prepare(
        `SELECT id FROM links WHERE archived_at IS NULL AND enabled = 1 AND (health_checked_at IS NULL OR health_checked_at < ?)
         ORDER BY COALESCE(health_checked_at, 0) LIMIT ?`,
      )
      .all(cut, limit) as { id: number }[];
    for (const { id } of ids) this.queueHealth(id);
    return ids.length;
  }

  queueHealth(linkId: number): void {
    if (this.stopped) return;
    this.healthQueue.push(`health:${linkId}`, () => this.checkHealth(linkId));
  }

  async checkHealth(linkId: number): Promise<void> {
    let row;
    try {
      row = this.links.getRow(linkId);
    } catch {
      return;
    }
    if (!/^https?:/i.test(row.url)) {
      this.links.saveHealth(linkId, { status: 'skipped', code: null, detail: 'Nur Webadressen werden geprüft.' });
      return;
    }
    try {
      const res = await safeFetch(row.url, this.policy(), { maxBytes: 64 * 1024 });
      this.links.saveHealth(linkId, healthFrom(res.status, res.hops.length - 1));
    } catch (e) {
      this.links.saveHealth(linkId, healthFromError(e));
    }
  }

  async idle(): Promise<void> {
    await this.metaQueue.idle();
    await this.healthQueue.idle();
  }
}

export function healthFrom(status: number, redirects: number): { status: 'ok' | 'broken' | 'warning'; code: number; detail: string } {
  const via = redirects > 0 ? ` (nach ${redirects} Weiterleitung${redirects > 1 ? 'en' : ''})` : '';
  if (status >= 200 && status < 300) return { status: 'ok', code: status, detail: `Ziel erreichbar${via}.` };
  if (status === 404 || status === 410) return { status: 'broken', code: status, detail: `Die Zielseite existiert nicht (HTTP ${status})${via}.` };
  if ([401, 403, 405, 406, 429, 999].includes(status)) {
    return { status: 'warning', code: status, detail: `Das Ziel antwortet, verweigert aber automatische Prüfungen (HTTP ${status}). Im Browser funktioniert es meist.` };
  }
  if (status >= 500) return { status: 'broken', code: status, detail: `Der Zielserver meldet einen Fehler (HTTP ${status})${via}.` };
  return { status: 'warning', code: status, detail: `Unerwartete Antwort (HTTP ${status}).` };
}

export function healthFromError(e: unknown): { status: 'broken' | 'skipped' | 'warning'; code: null; detail: string } {
  if (e instanceof FetchBlockedError) {
    if (e.reason === 'address' || e.reason === 'port' || e.reason === 'scheme') return { status: 'skipped', code: null, detail: e.message };
    if (e.reason === 'redirects') return { status: 'warning', code: null, detail: e.message };
    return { status: 'broken', code: null, detail: e.message };
  }
  const err = e as Error & { code?: string; cause?: { code?: string } };
  const code = err.code ?? err.cause?.code ?? '';
  const map: Record<string, string> = {
    ECONNREFUSED: 'Der Zielserver lehnt Verbindungen ab.',
    ECONNRESET: 'Die Verbindung zum Zielserver wurde abgebrochen.',
    EHOSTUNREACH: 'Der Zielserver ist nicht erreichbar.',
    ENETUNREACH: 'Das Netz des Zielservers ist nicht erreichbar.',
    CERT_HAS_EXPIRED: 'Das HTTPS-Zertifikat des Ziels ist abgelaufen.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Das Ziel verwendet ein selbst signiertes Zertifikat.',
    ERR_TLS_CERT_ALTNAME_INVALID: 'Das HTTPS-Zertifikat passt nicht zum Servernamen.',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Das HTTPS-Zertifikat des Ziels ist nicht vertrauenswürdig.',
  };
  return { status: 'broken', code: null, detail: map[code] ?? `Ziel nicht erreichbar (${code || err.message || 'unbekannter Fehler'}).` };
}
