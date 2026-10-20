import crypto from 'node:crypto';

/**
 * Kleine, eigenständige HTML-Seiten für die öffentliche Seite (Fehler, Passwort,
 * Vorschau). Keine externen Ressourcen, keine Skripte, alle Werte maskiert.
 */

export function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
:root{--bg:#f3f5f7;--paper:#fff;--ink:#18202b;--muted:#5b6675;--line:#dfe4ea;--thread:#d1183b;--ok:#2f8f5b;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#10151d;--paper:#171e28;--ink:#e6eaf0;--muted:#97a1ae;--line:#2a3442;--thread:#ff4d6a}}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;padding:24px}
main{width:100%;max-width:520px;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:32px 28px;position:relative;overflow:hidden}
main:before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--thread)}
h1{font-size:1.35rem;line-height:1.3;margin:0 0 8px;font-weight:650;letter-spacing:-.01em}
p{margin:0 0 12px;color:var(--muted)}
.code{font:600 .95rem/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink);word-break:break-all}
.dest{display:block;margin:14px 0;padding:12px 14px;border:1px solid var(--line);border-radius:10px;font:.9rem/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;color:var(--ink)}
form{display:grid;gap:10px;margin-top:16px}
label{font-weight:600;font-size:.9rem}
input[type=password],select,textarea{width:100%;font:inherit;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
input:focus-visible,select:focus-visible,textarea:focus-visible,a:focus-visible,button:focus-visible{outline:2px solid var(--thread);outline-offset:2px}
button,.btn{display:inline-flex;justify-content:center;align-items:center;gap:8px;font:600 1rem/1 system-ui,sans-serif;padding:13px 18px;border-radius:10px;border:0;background:var(--ink);color:var(--paper);cursor:pointer;text-decoration:none}
.err{color:var(--thread);font-weight:600}
.meta{font-size:.85rem;color:var(--muted);margin-top:18px}
.meta a{color:var(--muted)}
.mark{display:flex;align-items:center;gap:8px;margin-bottom:20px;color:var(--muted);font-size:.85rem}
.mark svg{width:22px;height:22px}
`;

const STYLE_HASH = `'sha256-${crypto.createHash('sha256').update(STYLE).digest('base64')}'`;

export const PAGE_CSP = `default-src 'none'; style-src ${STYLE_HASH}; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;

const MARK = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M3 17c4 0 5-10 9-10 2.6 0 3 3 1 4.2-2.1 1.3-4.2-.6-2.6-2.6C12.6 6 16 5 21 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

export function page(opts: { title: string; body: string; org?: string }): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(opts.title)}</title><style>${STYLE}</style></head>
<body><main><div class="mark">${MARK}<span>${esc(opts.org || 'Kurzlink')}</span></div>${opts.body}</main></body></html>`;
}

export function messagePage(title: string, text: string, shortLabel?: string, org?: string): string {
  return page({
    title,
    org,
    body: `<h1>${esc(title)}</h1>${shortLabel ? `<p class="code">${esc(shortLabel)}</p>` : ''}<p>${esc(text)}</p>`,
  });
}

export function notFoundPage(shortLabel: string, suggestion: { href: string; label: string } | null, org?: string): string {
  return page({
    title: 'Link nicht gefunden',
    org,
    body: `<h1>Link nicht gefunden</h1><p class="code">${esc(shortLabel)}</p><p>Diesen Kurzlink gibt es nicht. Bitte prüfen Sie die Schreibweise.</p>${
      suggestion ? `<p>Meinten Sie <a class="code" href="${esc(suggestion.href)}">${esc(suggestion.label)}</a>?</p>` : ''
    }`,
  });
}

export function passwordPage(opts: { shortLabel: string; action: string; error?: string; org?: string; waitSeconds?: number }): string {
  return page({
    title: 'Geschützter Link',
    org: opts.org,
    body: `<h1>Dieser Link ist geschützt</h1><p class="code">${esc(opts.shortLabel)}</p>
<p>Bitte geben Sie das Passwort ein, das Sie zusammen mit dem Link erhalten haben.</p>
${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ''}
<form method="post" action="${esc(opts.action)}"><label for="pw">Passwort</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus maxlength="200">
<button type="submit"${opts.waitSeconds ? ' disabled' : ''}>Link öffnen</button></form>`,
  });
}

export function previewPage(opts: {
  shortLabel: string;
  destination: string | null;
  title?: string | null;
  description?: string | null;
  note?: string;
  continueHref: string | null;
  reportHref?: string | null;
  org?: string;
}): string {
  return page({
    title: `Vorschau ${opts.shortLabel}`,
    org: opts.org,
    body: `<h1>Wohin führt dieser Link?</h1><p class="code">${esc(opts.shortLabel)}</p>
${opts.title ? `<p><strong>${esc(opts.title)}</strong></p>` : ''}
${opts.description ? `<p>${esc(opts.description)}</p>` : ''}
${opts.destination ? `<span class="dest">${esc(opts.destination)}</span>` : ''}
${opts.note ? `<p>${esc(opts.note)}</p>` : ''}
${opts.continueHref ? `<p><a class="btn" href="${esc(opts.continueHref)}" rel="noreferrer">Weiter zum Ziel</a></p>` : ''}
${opts.reportHref ? `<p class="meta"><a href="${esc(opts.reportHref)}">Diesen Link als missbräuchlich melden</a></p>` : ''}`,
  });
}

export function reportPage(opts: { shortLabel: string; action: string; done?: boolean; error?: string; org?: string }): string {
  if (opts.done) {
    return messagePage('Danke für Ihre Meldung', 'Die Betreiber prüfen den Link. Sie müssen nichts weiter tun.', opts.shortLabel, opts.org);
  }
  return page({
    title: 'Link melden',
    org: opts.org,
    body: `<h1>Link als missbräuchlich melden</h1><p class="code">${esc(opts.shortLabel)}</p>
<p>Ihre Meldung geht an die Betreiber dieses Kurzlink-Dienstes. Es werden keine Daten über Sie gespeichert.</p>
${opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : ''}
<form method="post" action="${esc(opts.action)}"><label for="r">Grund</label>
<select id="r" name="reason" required><option value="phishing">Phishing oder Betrug</option><option value="malware">Schadsoftware</option>
<option value="spam">Spam</option><option value="illegal">Rechtswidriger Inhalt</option><option value="broken">Link funktioniert nicht</option><option value="other">Anderes</option></select>
<label for="m">Beschreibung (freiwillig)</label><textarea id="m" name="message" rows="3" maxlength="1000"></textarea>
<button type="submit">Meldung senden</button></form>`,
  });
}
