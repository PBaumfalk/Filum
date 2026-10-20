import { z } from 'zod';
import type { DB } from '../db/db.js';

/** Felder ohne Standardwerte – Grundlage für Änderungen (PATCH), damit nur Übergebenes gesetzt wird. */
const fields = {
  /** off: keine Zeitreihen; basic: Aufrufe je Stunde; extended: zusätzlich Herkunft, Gerät, Sprache (je Tag aggregiert) */
  analyticsMode: z.enum(['off', 'basic', 'extended']),
  retentionDays: z.number().int().min(7).max(3650),
  detailRetentionDays: z.number().int().min(7).max(3650),
  trackUnknownSlugs: z.boolean(),
  timezone: z.string().min(1).max(64),
  allowedSchemes: z.array(z.enum(['http', 'https', 'mailto', 'tel', 'sms', 'geo'])).min(1),
  blockedHosts: z.array(z.string().min(1).max(253)).max(5000),
  defaultRedirectType: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]),
  slugStyle: z.enum(['random', 'readable']),
  fetchPreviews: z.boolean(),
  healthChecks: z.boolean(),
  reportsEnabled: z.boolean(),
  memberCanCreateTags: z.boolean(),
  organizationName: z.string().max(120),
};

const DEFAULTS = {
  analyticsMode: 'basic',
  retentionDays: 395,
  detailRetentionDays: 90,
  trackUnknownSlugs: true,
  timezone: 'Europe/Berlin',
  allowedSchemes: ['http', 'https'],
  blockedHosts: [],
  defaultRedirectType: 302,
  slugStyle: 'random',
  fetchPreviews: true,
  healthChecks: true,
  reportsEnabled: true,
  memberCanCreateTags: true,
  organizationName: '',
} as const;

export const settingsSchema = z.object(fields);
/** Für PATCH: nur übergebene Felder, keine Standardwerte, unbekannte Felder abgelehnt. */
export const settingsPatchSchema = z.object(fields).partial().strict();

export type Settings = z.infer<typeof settingsSchema>;

export class SettingsStore {
  private cache: Settings | null = null;
  constructor(private db: DB) {}

  get(): Settings {
    if (this.cache) return this.cache;
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const raw: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        raw[r.key] = JSON.parse(r.value);
      } catch {
        /* defekter Wert → Standard */
      }
    }
    // Feldweise prüfen: Ein defekter Wert fällt auf seinen Standard zurück, die übrigen bleiben erhalten.
    const out: Record<string, unknown> = {};
    for (const [k, schema] of Object.entries(fields)) {
      const r = (schema as z.ZodType).safeParse(raw[k]);
      out[k] = r.success ? r.data : DEFAULTS[k as keyof typeof DEFAULTS];
    }
    this.cache = settingsSchema.parse(out);
    return this.cache;
  }

  update(patch: Partial<Settings>): Settings {
    const next = settingsSchema.parse({ ...this.get(), ...settingsPatchSchema.parse(patch) });
    const stmt = this.db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(next)) stmt.run(k, JSON.stringify(v));
    })();
    this.cache = next;
    return next;
  }
}
