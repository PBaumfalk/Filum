import { describe, expect, it } from 'vitest';
import {
  MAX_SLUG_LENGTH,
  MAX_URL_LENGTH,
  ValidationError,
  applyUtm,
  hostMatches,
  normalizeUrlInput,
  slugKey,
  validateDestination,
  validateHost,
  validateSlug,
  type UrlPolicy,
} from '../src/server/lib/validate.js';

const policy: UrlPolicy = { allowedSchemes: ['http', 'https'], ownHosts: ['go.test', 'kurz.test:8080'], blockedHosts: ['evil.example', 'bad.test'] };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return (e as ValidationError).code;
  }
  throw new Error('keine ValidationError geworfen');
}

describe('validateDestination', () => {
  it('ergänzt ein fehlendes Schema', () => {
    expect(normalizeUrlInput('beispiel.de/x')).toBe('https://beispiel.de/x');
    expect(normalizeUrlInput('  www.beispiel.de  ')).toBe('https://www.beispiel.de');
    expect(normalizeUrlInput('beispiel.de:8443/a?b=1')).toBe('https://beispiel.de:8443/a?b=1');
    expect(validateDestination('beispiel.de/seite', policy)).toBe('https://beispiel.de/seite');
    expect(validateDestination('münchen.de', policy)).toBe('https://xn--mnchen-3ya.de/');
  });

  it('lässt gültige http/https-Adressen unverändert durch (normalisiert)', () => {
    expect(validateDestination('https://www.beispiel.de/a?b=1#c', policy)).toBe('https://www.beispiel.de/a?b=1#c');
    expect(validateDestination('HTTP://Beispiel.DE', policy)).toBe('http://beispiel.de/');
  });

  it.each([
    ['javascript:alert(1)'],
    ['JaVaScRiPt:alert(document.cookie)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['file:///etc/passwd'],
    ['vbscript:msgbox(1)'],
    ['ftp://files.example/x'],
  ])('verbietet das Schema von %s', (url) => {
    expect(codeOf(() => validateDestination(url, policy))).toBe('scheme');
  });

  it('erlaubt zusätzliche Schemata nur, wenn die Richtlinie sie freigibt', () => {
    expect(codeOf(() => validateDestination('mailto:info@beispiel.de', policy))).toBe('scheme');
    expect(validateDestination('mailto:info@beispiel.de', { ...policy, allowedSchemes: ['https', 'mailto'] })).toBe('mailto:info@beispiel.de');
    expect(codeOf(() => validateDestination('http://beispiel.de', { ...policy, allowedSchemes: ['https'] }))).toBe('scheme');
  });

  it('lehnt Zugangsdaten in der Adresse ab', () => {
    expect(codeOf(() => validateDestination('https://user:pass@beispiel.de/', policy))).toBe('credentials');
    expect(codeOf(() => validateDestination('https://user@beispiel.de/', policy))).toBe('credentials');
  });

  it.each([
    ['https://beispiel.de/\u0000x'],
    ['https://beispiel.de/a\u0007'],
    ['https://beispiel.de/a b'],
    ['https://beispiel.de/\tx'],
    ['https://beispiel.de/\u202Etxt.exe'],
    ['https://beispiel.de/\u2066x'],
    ['https://beispiel.de/a\u2028b'],
  ])('lehnt Steuer- und Leerzeichen ab (%j)', (url) => {
    expect(() => validateDestination(url, policy)).toThrow(ValidationError);
  });

  it('erkennt Schleifen auf eigene Kurzlink-Domains (inkl. Port, Groß/klein)', () => {
    expect(codeOf(() => validateDestination('https://go.test/abc', policy))).toBe('loop');
    expect(codeOf(() => validateDestination('http://GO.TEST/', policy))).toBe('loop');
    expect(codeOf(() => validateDestination('go.test/abc', policy))).toBe('loop');
    expect(codeOf(() => validateDestination('https://kurz.test:8080/x', policy))).toBe('loop');
    // anderer Host ist kein Problem
    expect(validateDestination('https://go.test.example/abc', policy)).toBe('https://go.test.example/abc');
  });

  it('beachtet die Sperrliste inklusive Subdomains, aber ohne Fehltreffer', () => {
    expect(codeOf(() => validateDestination('https://evil.example/login', policy))).toBe('blocked');
    expect(codeOf(() => validateDestination('https://login.evil.example/', policy))).toBe('blocked');
    expect(codeOf(() => validateDestination('https://a.b.EVIL.example./', policy))).toBe('blocked');
    expect(validateDestination('https://notevil.example/', policy)).toBe('https://notevil.example/');
    expect(validateDestination('https://evil.example.org/', policy)).toBe('https://evil.example.org/');
    expect(hostMatches('x.bad.test', '*.bad.test')).toBe(true);
    expect(hostMatches('bad.test', '*.bad.test')).toBe(true);
    expect(hostMatches('xbad.test', 'bad.test')).toBe(false);
  });

  it('prüft die Länge und Pflichtangabe', () => {
    expect(codeOf(() => validateDestination('', policy))).toBe('required');
    expect(codeOf(() => validateDestination('   ', policy))).toBe('required');
    const long = `https://beispiel.de/${'a'.repeat(MAX_URL_LENGTH)}`;
    expect(codeOf(() => validateDestination(long, policy))).toBe('too_long');
    const ok = `https://beispiel.de/${'a'.repeat(MAX_URL_LENGTH - 'https://beispiel.de/'.length)}`;
    expect(validateDestination(ok, policy)).toHaveLength(MAX_URL_LENGTH);
  });

  it('meldet unbrauchbare Eingaben mit Feldnamen', () => {
    try {
      validateDestination('http://', policy, 'fallbackUrl');
      throw new Error('nicht geworfen');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).field).toBe('fallbackUrl');
    }
  });
});

describe('validateSlug', () => {
  it('akzeptiert gültige Kurzadressen und entfernt Rand-Schrägstriche', () => {
    expect(validateSlug('Sommer-2026')).toBe('Sommer-2026');
    expect(validateSlug(' /abc/ ')).toBe('abc');
    expect(validateSlug('team/kalender')).toBe('team/kalender');
    expect(validateSlug('a.b_c~d')).toBe('a.b_c~d');
    expect(validateSlug('x'.repeat(MAX_SLUG_LENGTH))).toHaveLength(MAX_SLUG_LENGTH);
  });

  it.each([['-abc'], ['.abc'], ['_abc'], ['abc.'], ['a//b'], ['ümlaut'], ['a b'], ['a?b'], ['a#b'], ['a%20b'], ['a+b'], ['<x>']])(
    'lehnt %j ab',
    (slug) => {
      expect(() => validateSlug(slug)).toThrow(ValidationError);
    },
  );

  it('lehnt leere und zu lange Kurzadressen ab', () => {
    expect(codeOf(() => validateSlug(''))).toBe('required');
    expect(codeOf(() => validateSlug('///'))).toBe('required');
    expect(codeOf(() => validateSlug('x'.repeat(MAX_SLUG_LENGTH + 1)))).toBe('too_long');
  });

  it.each([['api'], ['API'], ['api/v1/links'], ['healthz'], ['robots.txt'], ['favicon.ico'], ['apple-touch-icon.png']])(
    'reserviert %s',
    (slug) => {
      expect(codeOf(() => validateSlug(slug))).toBe('reserved');
    },
  );

  it('reservierte Wörter sind nur als erstes Segment gesperrt', () => {
    expect(validateSlug('team/api')).toBe('team/api');
    expect(validateSlug('apix')).toBe('apix');
  });

  it('slugKey ignoriert Groß-/Kleinschreibung', () => {
    expect(slugKey('Sommer-ABC')).toBe('sommer-abc');
  });
});

describe('validateHost', () => {
  it('normalisiert Hostnamen', () => {
    expect(validateHost('https://Go.Beispiel.DE/pfad')).toBe('go.beispiel.de');
    expect(validateHost('kurz.test:8080')).toBe('kurz.test:8080');
    expect(validateHost('go.beispiel.de.')).toBe('go.beispiel.de');
  });
  it('lehnt Zugangsdaten und leere Eingaben ab', () => {
    expect(() => validateHost('user:pw@go.de')).toThrow(ValidationError);
    expect(() => validateHost('')).toThrow(ValidationError);
    expect(() => validateHost('go.de?x=1')).toThrow(ValidationError);
  });
});

describe('applyUtm', () => {
  it('ergänzt und ersetzt UTM-Parameter', () => {
    const out = new URL(applyUtm('https://z.example/a?utm_source=alt&x=1', { utm_source: 'neu', utm_medium: ' print ', utm_term: '' }));
    expect(out.searchParams.get('utm_source')).toBe('neu');
    expect(out.searchParams.get('utm_medium')).toBe('print');
    expect(out.searchParams.has('utm_term')).toBe(false);
    expect(out.searchParams.get('x')).toBe('1');
  });
  it('lässt Nicht-Webadressen und leere Angaben unverändert', () => {
    expect(applyUtm('mailto:a@b.de', { utm_source: 'x' })).toBe('mailto:a@b.de');
    expect(applyUtm('https://z.example/', null)).toBe('https://z.example/');
    expect(applyUtm('https://z.example/', {})).toBe('https://z.example/');
  });
});
