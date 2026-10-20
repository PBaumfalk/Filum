import { describe, expect, it } from 'vitest';
import { effectiveStatus, linkState } from '../src/server/services/links.js';
import { isDynamic, route, routingSchema, ruleMatches, type RequestFacts } from '../src/server/services/rules.js';
import { isBot, platformForRules, primaryLanguage, referrerHost } from '../src/server/lib/ua.js';

const facts = (f: Partial<RequestFacts> = {}): RequestFacts => ({
  platform: 'desktop',
  language: 'de',
  // Mittwoch, 15.10.2025, 12:00 Uhr in Berlin
  at: Date.parse('2025-10-15T10:00:00Z') / 1000,
  timezone: 'Europe/Berlin',
  ...f,
});

describe('route()', () => {
  const routing = routingSchema.parse({
    rules: [
      { id: 'ios', url: 'https://apps.example/ios', when: { platform: ['ios'] } },
      { id: 'en', url: 'https://z.example/en', when: { language: ['en'] } },
      { id: 'nacht', url: 'https://z.example/nacht', when: { timeFrom: '22:00', timeTo: '06:00' } },
    ],
    mainWeight: 50,
    variants: [
      { id: 'b', url: 'https://z.example/b', weight: 30 },
      { id: 'c', url: 'https://z.example/c', weight: 20 },
      { id: 'aus', url: 'https://z.example/aus', weight: 0 },
    ],
  });

  it('ohne Regeln: Hauptziel', () => {
    expect(route('https://z.example/', null, facts())).toEqual({ url: 'https://z.example/', via: 'main' });
  });

  it('erste passende Regel gewinnt', () => {
    expect(route('https://z.example/', routing, facts({ platform: 'ios', language: 'en' })).via).toBe('rule:ios');
    expect(route('https://z.example/', routing, facts({ language: 'en' })).via).toBe('rule:en');
  });

  it('Zeitfenster über Mitternacht', () => {
    const night = Date.parse('2025-10-15T21:30:00Z') / 1000; // 23:30 Berlin
    expect(route('https://z.example/', routing, facts({ at: night }), () => 0).via).toBe('rule:nacht');
    const morning = Date.parse('2025-10-15T05:30:00Z') / 1000; // 07:30 Berlin
    expect(route('https://z.example/', routing, facts({ at: morning }), () => 0).via).toBe('main');
  });

  it('verteilt nach Gewichten (deterministisch mit rnd)', () => {
    // Gesamtgewicht 100: [0,50) Hauptziel, [50,80) b, [80,100) c, Gewicht 0 nie
    const pick = (r: number) => route('https://z.example/', routing, facts(), () => r).via;
    expect(pick(0)).toBe('main');
    expect(pick(0.499)).toBe('main');
    expect(pick(0.5)).toBe('variant:b');
    expect(pick(0.799)).toBe('variant:b');
    expect(pick(0.8)).toBe('variant:c');
    expect(pick(0.9999)).toBe('variant:c');
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(pick(i / 1000));
    expect(seen).toEqual(new Set(['main', 'variant:b', 'variant:c']));
  });

  it('Verteilung entspricht grob den Gewichten', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 10_000; i++) {
      const v = route('https://z.example/', routing, facts(), rnd).via;
      counts[v] = (counts[v] ?? 0) + 1;
    }
    expect(counts.main / 10_000).toBeCloseTo(0.5, 1);
    expect(counts['variant:b'] / 10_000).toBeCloseTo(0.3, 1);
    expect(counts['variant:c'] / 10_000).toBeCloseTo(0.2, 1);
    expect(counts['variant:aus']).toBeUndefined();
  });

  it('Wochentage und Datumsgrenzen', () => {
    const r = routingSchema.parse({ rules: [{ id: 'wd', url: 'https://z.example/wd', when: { weekdays: [3] } }] }).rules[0];
    expect(ruleMatches(r, facts())).toBe(true); // Mittwoch
    expect(ruleMatches(r, facts({ at: facts().at + 86400 }))).toBe(false);
    const d = routingSchema.parse({ rules: [{ id: 'd', url: 'https://z.example/d', when: { dateFrom: '2025-10-15T00:00:00Z', dateTo: '2025-10-16T00:00:00Z' } }] }).rules[0];
    expect(ruleMatches(d, facts())).toBe(true);
    expect(ruleMatches(d, facts({ at: Date.parse('2025-10-16T00:00:00Z') / 1000 }))).toBe(false);
  });

  it('isDynamic', () => {
    expect(isDynamic(null)).toBe(false);
    expect(isDynamic(routingSchema.parse({ variants: [{ id: 'x', url: 'https://a.example', weight: 0 }] }))).toBe(false);
    expect(isDynamic(routing)).toBe(true);
  });
});

describe('effectiveStatus / linkState', () => {
  const base = { redirect_type: 301 as const, starts_at: null, expires_at: null, max_clicks: null, password_hash: null };
  it('stuft permanente Weiterleitungen bei dynamischen Links herab', () => {
    expect(effectiveStatus(base, null)).toBe(301);
    expect(effectiveStatus({ ...base, redirect_type: 308 }, null)).toBe(308);
    expect(effectiveStatus({ ...base, expires_at: 1 }, null)).toBe(302);
    expect(effectiveStatus({ ...base, starts_at: 1 }, null)).toBe(302);
    expect(effectiveStatus({ ...base, max_clicks: 5 }, null)).toBe(302);
    expect(effectiveStatus({ ...base, password_hash: 'x' }, null)).toBe(302);
    expect(effectiveStatus({ ...base, redirect_type: 308, expires_at: 1 }, null)).toBe(307);
    expect(effectiveStatus({ ...base, redirect_type: 302, expires_at: 1 }, null)).toBe(302);
    expect(effectiveStatus({ ...base, redirect_type: 307 }, null)).toBe(307);
  });
  it('bestimmt den Zustand', () => {
    const l = { enabled: 1, starts_at: null, expires_at: null, max_clicks: null, click_count: 0 };
    expect(linkState(l, 100)).toBe('active');
    expect(linkState({ ...l, enabled: 0 }, 100)).toBe('disabled');
    expect(linkState({ ...l, starts_at: 200 }, 100)).toBe('scheduled');
    expect(linkState({ ...l, expires_at: 100 }, 100)).toBe('expired');
    expect(linkState({ ...l, max_clicks: 3, click_count: 3 }, 100)).toBe('limit');
  });
});

describe('ua-Hilfen', () => {
  it('erkennt Bots, Plattform, Sprache und Referrer', () => {
    expect(isBot(undefined)).toBe(true);
    expect(isBot('Slackbot-LinkExpanding 1.0')).toBe(true);
    expect(isBot('curl/8.0')).toBe(true);
    expect(isBot('Mozilla/5.0 (Windows NT 10.0) Chrome/130')).toBe(false);
    expect(platformForRules('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(platformForRules('Mozilla/5.0 (Linux; Android 14; Pixel)')).toBe('android');
    expect(primaryLanguage('en-US,en;q=0.9,de;q=0.8')).toBe('en');
    expect(primaryLanguage(undefined)).toBe('');
    expect(referrerHost('https://www.news.example/a?b=1', 'go.test')).toBe('news.example');
    expect(referrerHost('https://go.test/x', 'go.test')).toBe('(direkt)');
    expect(referrerHost('android-app://x', 'go.test')).toBe('(andere)');
  });
});
