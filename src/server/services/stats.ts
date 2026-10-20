import type { DB } from '../db/db.js';
import type { Logger } from '../lib/log.js';
import { dayKey, dayKeyToIso, formatter, now } from '../lib/time.js';
import type { SettingsStore } from './settings.js';

/**
 * Datensparsame Statistik.
 * – Nie gespeichert: IP-Adressen, User-Agents, Cookies, Kennungen, vollständige Referrer.
 * – „basic“: Aufrufe je Link und Stunde, davon QR und Bots; Ergebnisse je Domain und Tag.
 * – „extended“: zusätzlich Tageszähler nach Herkunfts-Domain, Gerätetyp, Betriebssystem,
 *   Browserfamilie und Sprache.
 * Zähler werden im Speicher gesammelt und alle paar Sekunden gebündelt geschrieben.
 */

export type Outcome =
  | 'redirect'
  | 'not_found'
  | 'gone'
  | 'disabled'
  | 'scheduled'
  | 'expired'
  | 'password'
  | 'password_failed'
  | 'preview'
  | 'domain_unknown';

export interface HitInfo {
  linkId: number;
  domainId: number;
  qr: boolean;
  bot: boolean;
  /** nur bei Links mit Regeln/Varianten gesetzt */
  via?: string;
  referrer?: string;
  device?: string;
  os?: string;
  browser?: string;
  language?: string;
}

const MAX_UNKNOWN_PER_DAY = 2000;

export class Stats {
  private hourly = new Map<string, { clicks: number; qr: number; bots: number }>();
  private dims = new Map<string, number>();
  private outcomes = new Map<string, number>();
  private unknown = new Map<string, number>();
  private unknownToday = new Map<string, number>();
  private clicks = new Map<number, { n: number; last: number }>();
  private timer: NodeJS.Timeout | null = null;
  /** Zusätzliche (noch nicht geschriebene) Aufrufe je Link, für Klick-Limits */
  pendingClicks = new Map<number, number>();

  constructor(
    private db: DB,
    private settings: SettingsStore,
    private log: Logger,
  ) {}

  start(intervalMs = 3000): void {
    this.timer = setInterval(() => this.flush(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush();
  }

  private mode() {
    return this.settings.get().analyticsMode;
  }

  hit(h: HitInfo): void {
    const t = now();
    // Der Gesamtzähler je Link wird immer geführt, weil Aufruflimits ihn brauchen.
    // Bots zählen nicht, damit Link-Vorschauen kein Limit verbrauchen.
    if (!h.bot) {
      const c = this.clicks.get(h.linkId) ?? { n: 0, last: 0 };
      c.n++;
      c.last = t;
      this.clicks.set(h.linkId, c);
      this.pendingClicks.set(h.linkId, (this.pendingClicks.get(h.linkId) ?? 0) + 1);
    }
    const mode = this.mode();
    if (mode === 'off') return;
    const hour = Math.floor(t / 3600);
    const key = `${h.linkId}:${hour}`;
    const e = this.hourly.get(key) ?? { clicks: 0, qr: 0, bots: 0 };
    if (h.bot) e.bots++;
    else {
      e.clicks++;
      if (h.qr) e.qr++;
    }
    this.hourly.set(key, e);
    this.outcome(h.domainId, 'redirect');
    if (h.bot) return;
    const day = dayKey(t, this.settings.get().timezone);
    // Nur bei Links mit Regeln oder Varianten: welches Ziel wurde gewählt?
    if (h.via) this.dim(h.linkId, day, 'route', h.via);
    if (mode === 'extended') {
      if (h.referrer) this.dim(h.linkId, day, 'referrer', h.referrer);
      if (h.device) this.dim(h.linkId, day, 'device', h.device);
      if (h.os) this.dim(h.linkId, day, 'os', h.os);
      if (h.browser) this.dim(h.linkId, day, 'browser', h.browser);
      if (h.language) this.dim(h.linkId, day, 'language', h.language);
    }
  }

  private dim(linkId: number, day: number, dim: string, value: string): void {
    const k = `${linkId}\u0000${day}\u0000${dim}\u0000${value}`;
    this.dims.set(k, (this.dims.get(k) ?? 0) + 1);
  }

  outcome(domainId: number, outcome: Outcome): void {
    if (this.mode() === 'off') return;
    const day = dayKey(now(), this.settings.get().timezone);
    const k = `${domainId}\u0000${day}\u0000${outcome}`;
    this.outcomes.set(k, (this.outcomes.get(k) ?? 0) + 1);
  }

  unknownSlug(domainId: number, slug: string): void {
    const s = this.settings.get();
    if (s.analyticsMode === 'off' || !s.trackUnknownSlugs) return;
    const day = dayKey(now(), s.timezone);
    const capKey = `${domainId}:${day}`;
    const k = `${domainId}\u0000${slug.slice(0, 80)}\u0000${day}`;
    if (!this.unknown.has(k)) {
      const n = this.unknownToday.get(capKey) ?? 0;
      if (n >= MAX_UNKNOWN_PER_DAY) return;
      this.unknownToday.set(capKey, n + 1);
    }
    this.unknown.set(k, (this.unknown.get(k) ?? 0) + 1);
  }

  flush(): void {
    if (!this.hourly.size && !this.dims.size && !this.outcomes.size && !this.unknown.size && !this.clicks.size) return;
    const hourly = this.hourly;
    const dims = this.dims;
    const outcomes = this.outcomes;
    const unknown = this.unknown;
    const clicks = this.clicks;
    this.hourly = new Map();
    this.dims = new Map();
    this.outcomes = new Map();
    this.unknown = new Map();
    this.clicks = new Map();
    try {
      this.db.transaction(() => {
        const exists = this.db.prepare('SELECT 1 FROM links WHERE id = ?');
        const h = this.db.prepare(
          `INSERT INTO stats_hourly(link_id, hour, clicks, qr, bots) VALUES (?,?,?,?,?)
           ON CONFLICT(link_id, hour) DO UPDATE SET clicks = clicks + excluded.clicks, qr = qr + excluded.qr, bots = bots + excluded.bots`,
        );
        for (const [k, v] of hourly) {
          const [linkId, hour] = k.split(':').map(Number);
          if (exists.get(linkId)) h.run(linkId, hour, v.clicks, v.qr, v.bots);
        }
        const d = this.db.prepare(
          `INSERT INTO stats_dims(link_id, day, dim, value, count) VALUES (?,?,?,?,?)
           ON CONFLICT(link_id, day, dim, value) DO UPDATE SET count = count + excluded.count`,
        );
        for (const [k, n] of dims) {
          const [linkId, day, dim, value] = k.split('\u0000');
          if (exists.get(Number(linkId))) d.run(Number(linkId), Number(day), dim, value, n);
        }
        const o = this.db.prepare(
          `INSERT INTO stats_outcomes(domain_id, day, outcome, count) VALUES (?,?,?,?)
           ON CONFLICT(domain_id, day, outcome) DO UPDATE SET count = count + excluded.count`,
        );
        for (const [k, n] of outcomes) {
          const [domainId, day, outcome] = k.split('\u0000');
          o.run(Number(domainId), Number(day), outcome, n);
        }
        const u = this.db.prepare(
          `INSERT INTO stats_unknown(domain_id, slug, day, count) VALUES (?,?,?,?)
           ON CONFLICT(domain_id, slug, day) DO UPDATE SET count = count + excluded.count`,
        );
        for (const [k, n] of unknown) {
          const [domainId, slug, day] = k.split('\u0000');
          u.run(Number(domainId), slug, Number(day), n);
        }
        const c = this.db.prepare('UPDATE links SET click_count = click_count + ?, last_click_at = MAX(COALESCE(last_click_at, 0), ?) WHERE id = ?');
        for (const [id, v] of clicks) c.run(v.n, v.last, id);
      })();
      for (const [id, v] of clicks) {
        const rest = (this.pendingClicks.get(id) ?? 0) - v.n;
        if (rest > 0) this.pendingClicks.set(id, rest);
        else this.pendingClicks.delete(id);
      }
    } catch (err) {
      // Nichts verwerfen: Zähler zurückmischen, der nächste Durchlauf versucht es erneut.
      // pendingClicks bleibt unverändert und passt so weiter zu den offenen Klicks.
      for (const [k, v] of hourly) {
        const e = this.hourly.get(k);
        if (e) {
          e.clicks += v.clicks;
          e.qr += v.qr;
          e.bots += v.bots;
        } else this.hourly.set(k, v);
      }
      for (const [src, dst] of [
        [dims, this.dims],
        [outcomes, this.outcomes],
        [unknown, this.unknown],
      ] as const) {
        for (const [k, n] of src) dst.set(k, (dst.get(k) ?? 0) + n);
      }
      for (const [id, v] of clicks) {
        const e = this.clicks.get(id);
        if (e) {
          e.n += v.n;
          e.last = Math.max(e.last, v.last);
        } else this.clicks.set(id, v);
      }
      this.log.error({ err }, 'Statistik konnte nicht geschrieben werden');
    }
  }

  /** Löscht Statistik, die älter ist als die eingestellte Aufbewahrungsfrist. */
  prune(): { hourly: number; dims: number; outcomes: number; unknown: number } {
    const s = this.settings.get();
    const t = now();
    const hourCut = Math.floor((t - s.retentionDays * 86400) / 3600);
    const dayCut = dayKey(t - s.detailRetentionDays * 86400, s.timezone);
    const dayCutLong = dayKey(t - s.retentionDays * 86400, s.timezone);
    const unknownCut = dayKey(t - Math.min(s.detailRetentionDays, 90) * 86400, s.timezone);
    this.unknownToday.clear();
    return {
      hourly: this.db.prepare('DELETE FROM stats_hourly WHERE hour < ?').run(hourCut).changes,
      dims: this.db.prepare('DELETE FROM stats_dims WHERE day < ?').run(dayCut).changes,
      outcomes: this.db.prepare('DELETE FROM stats_outcomes WHERE day < ?').run(dayCutLong).changes,
      unknown: this.db.prepare('DELETE FROM stats_unknown WHERE day < ?').run(unknownCut).changes,
    };
  }

  clearLink(linkId: number): void {
    this.flush();
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM stats_hourly WHERE link_id = ?').run(linkId);
      this.db.prepare('DELETE FROM stats_dims WHERE link_id = ?').run(linkId);
      this.db.prepare('UPDATE links SET click_count = 0, last_click_at = NULL WHERE id = ?').run(linkId);
    })();
    this.pendingClicks.delete(linkId);
  }

  clearAll(): void {
    this.flush();
    this.db.transaction(() => {
      for (const t of ['stats_hourly', 'stats_dims', 'stats_outcomes', 'stats_unknown']) this.db.prepare(`DELETE FROM ${t}`).run();
      this.db.prepare('UPDATE links SET click_count = 0, last_click_at = NULL').run();
    })();
    this.pendingClicks.clear();
  }

  clearDetails(): void {
    this.flush();
    this.db.prepare("DELETE FROM stats_dims WHERE dim <> 'route'").run();
  }

  // ------------------------------------------------------------------ Auswertung

  private scopeSql(scope: StatsScope): { join: string; where: string; args: unknown[] } {
    if (scope.linkId) return { join: '', where: 's.link_id = ?', args: [scope.linkId] };
    const where: string[] = [];
    const args: unknown[] = [];
    if (scope.campaignId) {
      where.push('l.campaign_id = ?');
      args.push(scope.campaignId);
    }
    if (scope.collectionId) {
      where.push('l.collection_id = ?');
      args.push(scope.collectionId);
    }
    if (scope.domainId) {
      where.push('l.domain_id = ?');
      args.push(scope.domainId);
    }
    if (scope.tag) {
      where.push('EXISTS (SELECT 1 FROM link_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.link_id = l.id AND t.name = ? COLLATE NOCASE)');
      args.push(scope.tag);
    }
    return { join: 'JOIN links l ON l.id = s.link_id', where: where.length ? where.join(' AND ') : '1 = 1', args };
  }

  report(scope: StatsScope, range: StatsRange) {
    this.flush();
    const s = this.settings.get();
    const tz = s.timezone;
    const { fromHour, toHour, buckets, granularity } = rangeBuckets(range, tz);
    const sc = this.scopeSql(scope);

    const rows = this.db
      .prepare(
        `SELECT s.hour, SUM(s.clicks) clicks, SUM(s.qr) qr, SUM(s.bots) bots FROM stats_hourly s ${sc.join}
         WHERE ${sc.where} AND s.hour >= ? AND s.hour < ? GROUP BY s.hour`,
      )
      .all(...sc.args, fromHour, toHour) as { hour: number; clicks: number; qr: number; bots: number }[];

    const series = buckets.map((b) => ({ t: b.label, start: b.start, clicks: 0, qr: 0, bots: 0 }));
    const index = new Map(buckets.map((b, i) => [b.key, i]));
    const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const fmt = formatter(tz, 'wd-h', { weekday: 'short', hour: '2-digit', hourCycle: 'h23' }, 'en-GB');
    let total = 0;
    let qr = 0;
    let bots = 0;
    for (const r of rows) {
      const sec = r.hour * 3600;
      const key = granularity === 'hour' ? r.hour : dayKey(sec, tz);
      const i = index.get(key);
      if (i !== undefined) {
        series[i].clicks += r.clicks;
        series[i].qr += r.qr;
        series[i].bots += r.bots;
      }
      total += r.clicks;
      qr += r.qr;
      bots += r.bots;
      const parts = fmt.formatToParts(new Date(sec * 1000));
      const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
      const hr = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
      if (wd >= 0) heat[wd][hr] += r.clicks;
    }

    // Vergleichszeitraum gleicher Länge direkt davor
    const span = toHour - fromHour;
    const prev = this.db
      .prepare(`SELECT COALESCE(SUM(s.clicks), 0) n FROM stats_hourly s ${sc.join} WHERE ${sc.where} AND s.hour >= ? AND s.hour < ?`)
      .get(...sc.args, fromHour - span, fromHour) as { n: number };

    const fromDay = dayKey(fromHour * 3600, tz);
    const toDay = dayKey(toHour * 3600 - 1, tz);
    const dimRows = this.db
      .prepare(
        `SELECT s.dim, s.value, SUM(s.count) n FROM stats_dims s ${sc.join}
         WHERE ${sc.where} AND s.day >= ? AND s.day <= ? GROUP BY s.dim, s.value ORDER BY n DESC`,
      )
      .all(...sc.args, fromDay, toDay) as { dim: string; value: string; n: number }[];
    const dims: Record<string, { value: string; count: number }[]> = {};
    for (const r of dimRows) {
      (dims[r.dim] ??= []).push({ value: r.value, count: r.n });
    }
    for (const k of Object.keys(dims)) dims[k] = dims[k].slice(0, 12);

    let top: { id: number; slug: string; host: string; title: string; url: string; clicks: number; previous: number }[] = [];
    if (!scope.linkId) {
      top = this.db
        .prepare(
          `SELECT l.id, l.slug, d.host, l.title, l.url, SUM(s.clicks) clicks,
             (SELECT COALESCE(SUM(p.clicks),0) FROM stats_hourly p WHERE p.link_id = l.id AND p.hour >= ? AND p.hour < ?) previous
           FROM stats_hourly s ${sc.join} JOIN domains d ON d.id = l.domain_id
           WHERE ${sc.where} AND s.hour >= ? AND s.hour < ? GROUP BY l.id HAVING clicks > 0 ORDER BY clicks DESC LIMIT 10`,
        )
        .all(fromHour - span, fromHour, ...sc.args, fromHour, toHour) as typeof top;
    }

    return {
      range: { from: new Date(fromHour * 3600_000).toISOString(), to: new Date(toHour * 3600_000).toISOString(), granularity },
      mode: s.analyticsMode,
      totals: { clicks: total, qr, bots, previous: prev.n },
      series,
      heatmap: heat,
      dims,
      top,
    };
  }

  /** Ergebnisse aller Aufrufe (gelungen, nicht gefunden, abgelaufen …) je Tag */
  outcomesReport(range: StatsRange, domainId?: number) {
    this.flush();
    const tz = this.settings.get().timezone;
    const { fromHour, toHour } = rangeBuckets(range, tz);
    const fromDay = dayKey(fromHour * 3600, tz);
    const toDay = dayKey(toHour * 3600 - 1, tz);
    const rows = this.db
      .prepare(
        `SELECT outcome, SUM(count) n FROM stats_outcomes WHERE day >= ? AND day <= ? ${domainId ? 'AND domain_id = ?' : ''} GROUP BY outcome ORDER BY n DESC`,
      )
      .all(...[fromDay, toDay, ...(domainId ? [domainId] : [])]) as { outcome: string; n: number }[];
    const unknown = this.db
      .prepare(
        `SELECT u.domain_id, d.host, u.slug, SUM(u.count) n, MAX(u.day) last_day FROM stats_unknown u JOIN domains d ON d.id = u.domain_id
         WHERE u.day >= ? AND u.day <= ? ${domainId ? 'AND u.domain_id = ?' : ''}
           AND NOT EXISTS (SELECT 1 FROM links l WHERE l.domain_id = u.domain_id AND l.slug_key = lower(u.slug))
         GROUP BY u.domain_id, u.slug ORDER BY n DESC LIMIT 25`,
      )
      .all(...[fromDay, toDay, ...(domainId ? [domainId] : [])]) as { domain_id: number; host: string; slug: string; n: number; last_day: number }[];
    return {
      outcomes: rows.map((r) => ({ outcome: r.outcome, count: r.n })),
      unknown: unknown.map((u) => ({
        domainId: u.domain_id,
        host: u.host,
        slug: u.slug,
        count: u.n,
        lastSeen: dayKeyToIso(u.last_day),
        suggestion: null as null | { id: number; slug: string },
      })),
    };
  }

  campaigns(range: StatsRange) {
    this.flush();
    const { fromHour, toHour } = rangeBuckets(range, this.settings.get().timezone);
    return this.db
      .prepare(
        `SELECT c.id, c.name, c.color, COUNT(DISTINCT l.id) links, COALESCE(SUM(s.clicks), 0) clicks, COALESCE(SUM(s.qr), 0) qr
         FROM campaigns c LEFT JOIN links l ON l.campaign_id = c.id
         LEFT JOIN stats_hourly s ON s.link_id = l.id AND s.hour >= ? AND s.hour < ?
         WHERE c.archived = 0 GROUP BY c.id ORDER BY clicks DESC`,
      )
      .all(fromHour, toHour) as { id: number; name: string; color: string; links: number; clicks: number; qr: number }[];
  }
}

export interface StatsScope {
  linkId?: number;
  campaignId?: number;
  collectionId?: number;
  domainId?: number;
  tag?: string;
}

export type StatsRange = { preset: '24h' | '7d' | '30d' | '90d' | '365d' } | { from: string; to: string };

/** UTC-Zeitpunkt (Sekunden) der lokalen Mitternacht eines Kalendertags */
export function zonedMidnight(isoDate: string, tz: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d) / 1000;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess * 1000));
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const local = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) / 1000;
    const target = Date.UTC(y, m - 1, d) / 1000;
    const diff = local - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return guess;
}

function isoDay(sec: number, tz: string): string {
  return dayKeyToIso(dayKey(sec, tz));
}

export function rangeBuckets(range: StatsRange, tz: string) {
  const t = now();
  if ('preset' in range && range.preset === '24h') {
    const toHour = Math.floor(t / 3600) + 1;
    const fromHour = toHour - 24;
    const fmt = new Intl.DateTimeFormat('de-DE', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    const buckets = Array.from({ length: 24 }, (_, i) => {
      const h = fromHour + i;
      return { key: h, label: fmt.format(new Date(h * 3600_000)), start: new Date(h * 3600_000).toISOString() };
    });
    return { fromHour, toHour, buckets, granularity: 'hour' as const };
  }
  let fromIso: string;
  let toIso: string;
  if ('preset' in range) {
    const days = ({ '24h': 1, '7d': 7, '30d': 30, '90d': 90, '365d': 365 } as const)[range.preset];
    toIso = isoDay(t, tz);
    fromIso = isoDay(zonedMidnight(toIso, tz) - (days - 1) * 86400 + 3600 * 3, tz);
  } else {
    fromIso = range.from;
    toIso = range.to;
  }
  const fromSec = zonedMidnight(fromIso, tz);
  const toSec = zonedMidnight(isoDay(zonedMidnight(toIso, tz) + 86400 + 3600 * 3, tz), tz);
  const buckets: { key: number; label: string; start: string }[] = [];
  let cur = fromSec;
  for (let i = 0; i < 800 && cur < toSec; i++) {
    const key = dayKey(cur + 3600, tz);
    buckets.push({ key, label: dayKeyToIso(key), start: new Date(cur * 1000).toISOString() });
    cur = zonedMidnight(isoDay(cur + 86400 + 3600 * 3, tz), tz);
  }
  return { fromHour: Math.floor(fromSec / 3600), toHour: Math.ceil(toSec / 3600), buckets, granularity: 'day' as const };
}
