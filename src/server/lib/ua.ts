/**
 * Grobe Einordnung des User-Agents. Das Ergebnis wird nur als Zählerkategorie
 * gespeichert (z. B. „mobil“), nie der User-Agent selbst.
 */

const BOT = /bot\b|crawler|spider|slurp|facebookexternalhit|facebot|embedly|whatsapp|telegram|discord|slack|skypeuripreview|linkedin|vkshare|pinterest|preview|headless|curl\/|wget\/|python-requests|python-urllib|go-http-client|okhttp|java\/|libwww|httpclient|axios\/|node-fetch|undici|scrapy|monitor|uptime|pingdom|lighthouse|outlook-iOS|microsoft office|bingpreview|google-safety|googleimageproxy|safebrowsing|filum-linkpruefung/i;

/** Dienste, die Links für eine Vorschau abrufen (keine echten Besuche). */
const UNFURL = /facebookexternalhit|facebot|whatsapp|telegrambot|discordbot|slackbot|slack-imgproxy|skypeuripreview|linkedinbot|twitterbot|pinterest|embedly|vkshare|teams|microsoft office|bingpreview|googleimageproxy/i;

export function isBot(ua: string | undefined): boolean {
  if (!ua) return true;
  return BOT.test(ua);
}

export function isUnfurler(ua: string | undefined): boolean {
  return Boolean(ua && UNFURL.test(ua));
}

export function deviceClass(ua: string | undefined): 'mobil' | 'tablet' | 'desktop' | 'unbekannt' {
  if (!ua) return 'unbekannt';
  if (/ipad|tablet|(android(?!.*mobile))|kindle|silk/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return 'mobil';
  if (/windows nt|macintosh|x11|linux|cros/i.test(ua)) return 'desktop';
  return 'unbekannt';
}

export function osFamily(ua: string | undefined): string {
  if (!ua) return 'Unbekannt';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if (/android/i.test(ua)) return 'Android';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os x|macintosh/i.test(ua)) return 'macOS';
  if (/cros/i.test(ua)) return 'ChromeOS';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Andere';
}

export function browserFamily(ua: string | undefined): string {
  if (!ua) return 'Unbekannt';
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\/|opera/i.test(ua)) return 'Opera';
  if (/samsungbrowser/i.test(ua)) return 'Samsung Internet';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/chrome|crios|chromium/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Andere';
}

/** Gerätegruppe für Weiterleitungsregeln */
export function platformForRules(ua: string | undefined): 'ios' | 'android' | 'desktop' | 'other' {
  if (!ua) return 'other';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/windows nt|macintosh|x11|linux|cros/i.test(ua)) return 'desktop';
  return 'other';
}

/** Hauptsprache aus Accept-Language, z. B. „de“ */
export function primaryLanguage(header: string | undefined): string {
  if (!header) return '';
  const first = header.split(',')[0]?.split(';')[0]?.trim().toLowerCase() ?? '';
  return /^[a-z]{2,3}/.exec(first)?.[0] ?? '';
}

/** Nur der Hostname des Referrers, ohne Pfad und Parameter. */
export function referrerHost(header: string | undefined, ownHost: string): string {
  if (!header) return '(direkt)';
  try {
    const u = new URL(header);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '(andere)';
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    if (h === ownHost.toLowerCase().split(':')[0]) return '(direkt)';
    return h.slice(0, 120);
  } catch {
    return '(andere)';
  }
}
