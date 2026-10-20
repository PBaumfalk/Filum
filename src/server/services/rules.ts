import { z } from 'zod';
import { formatter } from '../lib/time.js';

/**
 * Weiterleitungsregeln. Reihenfolge: erste passende Regel gewinnt; sonst
 * entscheidet die Verteilung (A/B), sonst das Hauptziel.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM');

export const ruleSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().max(80).default(''),
  url: z.string().min(1).max(8192),
  when: z
    .object({
      platform: z.array(z.enum(['ios', 'android', 'desktop', 'other'])).max(4).optional(),
      language: z.array(z.string().regex(/^[a-z]{2,3}$/)).max(20).optional(),
      weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
      timeFrom: hhmm.optional(),
      timeTo: hhmm.optional(),
      dateFrom: z.string().datetime({ offset: true }).optional(),
      dateTo: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
});

export const variantSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().max(80).default(''),
  url: z.string().min(1).max(8192),
  weight: z.number().int().min(0).max(100),
});

export const routingSchema = z
  .object({
    rules: z.array(ruleSchema).max(20).default([]),
    /** Gewicht des Hauptziels, wenn Varianten vorhanden sind */
    mainWeight: z.number().int().min(0).max(100).default(50),
    variants: z.array(variantSchema).max(5).default([]),
  })
  .strict();

export type Routing = z.infer<typeof routingSchema>;
export type Rule = z.infer<typeof ruleSchema>;

export interface RequestFacts {
  platform: 'ios' | 'android' | 'desktop' | 'other';
  language: string;
  /** Unix-Sekunden */
  at: number;
  timezone: string;
}

function localParts(at: number, tz: string): { weekday: number; minutes: number } {
  const parts = formatter(tz, 'wd-hm', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-GB').formatToParts(new Date(at * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

export function ruleMatches(rule: Rule, f: RequestFacts): boolean {
  const w = rule.when;
  if (w.platform?.length && !w.platform.includes(f.platform)) return false;
  if (w.language?.length && !w.language.includes(f.language)) return false;
  if (w.dateFrom && f.at < Date.parse(w.dateFrom) / 1000) return false;
  if (w.dateTo && f.at >= Date.parse(w.dateTo) / 1000) return false;
  if (w.weekdays?.length || w.timeFrom || w.timeTo) {
    const { weekday, minutes } = localParts(f.at, f.timezone);
    if (w.weekdays?.length && !w.weekdays.includes(weekday)) return false;
    const from = w.timeFrom ? toMin(w.timeFrom) : 0;
    const to = w.timeTo ? toMin(w.timeTo) : 24 * 60;
    // Zeitfenster über Mitternacht (z. B. 22:00–06:00) ist erlaubt.
    const inside = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
    if (!inside) return false;
  }
  return true;
}

export interface RouteResult {
  url: string;
  /** „rule:<id>“, „variant:<id>“, „main“ */
  via: string;
}

export function route(main: string, routing: Routing | null, f: RequestFacts, rnd = Math.random): RouteResult {
  if (!routing) return { url: main, via: 'main' };
  for (const r of routing.rules) {
    if (ruleMatches(r, f)) return { url: r.url, via: `rule:${r.id}` };
  }
  const variants = routing.variants.filter((v) => v.weight > 0);
  if (variants.length) {
    const total = routing.mainWeight + variants.reduce((s, v) => s + v.weight, 0);
    if (total > 0) {
      let pick = rnd() * total;
      if (pick < routing.mainWeight) return { url: main, via: 'main' };
      pick -= routing.mainWeight;
      for (const v of variants) {
        if (pick < v.weight) return { url: v.url, via: `variant:${v.id}` };
        pick -= v.weight;
      }
    }
  }
  return { url: main, via: 'main' };
}

export function isDynamic(routing: Routing | null): boolean {
  return Boolean(routing && (routing.rules.length || routing.variants.some((v) => v.weight > 0)));
}
