import { useQuery } from '@tanstack/react-query';
import { Check, CircleAlert, Copy, ExternalLink, Layers, Link2, PanelRight, QrCode, Sparkles, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError, qs } from '../lib/api';
import { num } from '../lib/format';
import { useDomains, useInvalidateLinks, usePresets } from '../lib/queries';
import type { Link, Preset } from '../lib/types';
import { useToast } from './toast';
import { copyText, ThreadGlyph } from './ui';

const URLISH = /^(https?:\/\/|www\.)\S+$|^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d+)?(\/\S*)?$/iu;

const UNSAFE_SCHEMES = /^(javascript|data|vbscript|file|blob|about)$/i;
const EXAMPLE = 'Beispiel: https://www.beispiel.de';

/** Übersetzt Serverfehler zur Zieladresse in freundliche, handlungsleitende Sätze. */
function friendlyError(e: unknown, input: string): { message: string; field?: string } {
  if (!(e instanceof ApiError)) return { message: 'Der Link konnte nicht angelegt werden. Bitte erneut versuchen.' };
  if (e.field === 'url') {
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(input.trim())?.[1];
    if (e.code === 'scheme') {
      if (scheme && UNSAFE_SCHEMES.test(scheme)) return { message: 'Dieser Adresstyp ist aus Sicherheitsgründen nicht erlaubt.', field: e.field };
      return { message: `Adressen mit „${scheme ?? '?'}:“ sind hier nicht freigeschaltet. Möglich sind Webadressen, z. B. https://www.beispiel.de`, field: e.field };
    }
    if (e.code === 'invalid') return { message: `Das sieht nicht nach einer Webadresse aus. ${EXAMPLE}`, field: e.field };
    if (e.code === 'required') return { message: `Bitte eine Webadresse eingeben. ${EXAMPLE}`, field: e.field };
  }
  return { message: e.message, field: e.field };
}

function extractUrls(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim().replace(/^[<("']+|[>)"'.,]+$/g, ''))
    .filter((s) => URLISH.test(s));
}

export function Composer({ onCreated }: { onCreated?: (link: Link) => void }) {
  const domains = useDomains();
  const presets = usePresets();
  const invalidate = useInvalidateLinks();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);

  const [url, setUrl] = useState('');
  const [domainId, setDomainId] = useState<number | null>(null);
  const [slug, setSlug] = useState('');
  const [slugDebounced, setSlugDebounced] = useState('');
  const [urlDebounced, setUrlDebounced] = useState('');
  const [preset, setPreset] = useState<Preset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [result, setResult] = useState<{ link: Link; copied: boolean; drawKey: number } | null>(null);
  const [batch, setBatch] = useState<string[] | null>(null);

  const activeDomains = useMemo(() => (domains.data?.items ?? []).filter((d) => d.status === 'active'), [domains.data]);
  const defaultDomain = activeDomains.find((d) => d.isDefault) ?? activeDomains[0];
  const effectiveDomain = activeDomains.find((d) => d.id === domainId) ?? defaultDomain;

  // Lesezeichen „Mit Filum kürzen“ und ⌘K „… kürzen“: /neu?url=… – auch wenn der Composer schon sichtbar ist.
  const preUrl = params.get('url');
  useEffect(() => {
    if (!preUrl) return;
    setUrl(preUrl);
    setBatch(null);
    setError(null);
    setResult(null);
    const next = new URLSearchParams(params);
    next.delete('url');
    next.delete('title');
    const search = next.toString();
    navigate({ pathname: location.pathname === '/neu' ? '/' : location.pathname, search: search ? `?${search}` : '' }, { replace: true });
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preUrl]);

  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('filum:compose', focus);
    return () => window.removeEventListener('filum:compose', focus);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setSlugDebounced(slug.trim()), 250);
    return () => window.clearTimeout(t);
  }, [slug]);
  useEffect(() => {
    const t = window.setTimeout(() => setUrlDebounced(url.trim()), 350);
    return () => window.clearTimeout(t);
  }, [url]);

  const slugCheck = useQuery({
    queryKey: ['slug-check', effectiveDomain?.id, slugDebounced],
    queryFn: () => api.get<{ available: boolean; reason?: string }>(`/api/v1/slug/check${qs({ domainId: effectiveDomain?.id, slug: slugDebounced })}`),
    enabled: Boolean(slugDebounced && effectiveDomain),
  });

  const existing = useQuery({
    queryKey: ['lookup', urlDebounced],
    queryFn: () => api.get<{ items: Link[] }>(`/api/v1/lookup${qs({ url: urlDebounced })}`),
    enabled: URLISH.test(urlDebounced) && !batch,
  });

  const reset = () => {
    setUrl('');
    setSlug('');
    setError(null);
    setBatch(null);
  };

  const applyPreset = (p: Preset | null) => {
    setPreset(p);
    if (p?.settings.domainId) setDomainId(p.settings.domainId);
  };

  const presetPayload = () => {
    const s = preset?.settings;
    if (!s) return {};
    return {
      redirectType: s.redirectType,
      tags: s.tags,
      collectionId: s.collectionId ?? undefined,
      campaignId: s.campaignId ?? undefined,
      forwardQuery: s.forwardQuery,
      protected: s.protected,
      expiresAt: s.expiresInDays ? new Date(Date.now() + s.expiresInDays * 86400_000).toISOString() : undefined,
    };
  };

  const create = async () => {
    setError(null);
    const urls = extractUrls(url);
    if (urls.length > 1) {
      setBatch(urls);
      return;
    }
    if (!url.trim()) {
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      let finalSlug = slug.trim() || undefined;
      if (!finalSlug && preset?.settings.slugStyle === 'readable') {
        finalSlug = (await api.get<{ slug: string }>(`/api/v1/slug/suggest${qs({ domainId: effectiveDomain?.id, url: url.trim(), style: 'readable' })}`)).slug;
      }
      const link = await api.post<Link>('/api/v1/links', { url: url.trim(), domainId: effectiveDomain?.id, slug: finalSlug, ...presetPayload() });
      const copied = await copyText(link.shortUrl);
      setResult({ link, copied, drawKey: Date.now() });
      reset();
      invalidate();
      onCreated?.(link);
    } catch (e) {
      setError(friendlyError(e, url));
    } finally {
      setBusy(false);
    }
  };

  const createBatch = async () => {
    if (!batch) return;
    setBusy(true);
    try {
      const r = await api.post<{ created: Link[]; errors: { url: string; message: string }[] }>('/api/v1/links/batch', {
        urls: batch,
        defaults: { domainId: effectiveDomain?.id, ...presetPayload() },
      });
      invalidate();
      const list = r.created.map((l) => l.shortUrl).join('\n');
      const copied = r.created.length ? await copyText(list) : false;
      toast.ok(`${num(r.created.length)} Kurzlinks angelegt${copied ? ' und kopiert' : ''}${r.errors.length ? `, ${num(r.errors.length)} übersprungen` : ''}`);
      if (r.errors.length) setError({ message: r.errors.map((e) => `${e.url}: ${e.message}`).slice(0, 3).join(' · ') });
      reset();
      if (r.created[0]) setResult({ link: r.created[0], copied: false, drawKey: Date.now() });
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : 'Fehler' });
    } finally {
      setBusy(false);
    }
  };

  const suggestReadable = async () => {
    if (!url.trim()) return;
    try {
      const r = await api.get<{ slug: string }>(`/api/v1/slug/suggest${qs({ domainId: effectiveDomain?.id, url: url.trim(), style: 'readable' })}`);
      setSlug(r.slug);
    } catch (e) {
      toast.error(e);
    }
  };

  const showOptions = url.trim().length > 0 || slug.length > 0;
  const slugState = !slugDebounced ? null : slugCheck.data?.available ? 'ok' : slugCheck.data ? 'bad' : null;
  const dup = existing.data?.items[0];

  if (!activeDomains.length && domains.isSuccess) {
    return (
      <div className="callout warn">
        <CircleAlert />
        <span>
          Es ist noch keine aktive Kurzlink-Domain eingerichtet. Ein Admin legt sie unter{' '}
          <a href="/domains" onClick={(e) => (e.preventDefault(), navigate('/domains'))}>
            Domains
          </a>{' '}
          an, zum Beispiel <code>go.firma.de</code>.
        </span>
      </div>
    );
  }

  return (
    <div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void (batch ? createBatch() : create());
        }}
      >
        <div className="composer-main">
          <Link2 aria-hidden />
          <input
            ref={inputRef}
            className="composer-input"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setBatch(null);
              setError(null);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text');
              const urls = extractUrls(text);
              if (urls.length > 1) {
                e.preventDefault();
                setUrl(urls.join(' '));
                setBatch(urls);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') reset();
            }}
            placeholder="Lange Adresse einfügen"
            aria-label="Zieladresse"
            aria-invalid={error?.field === 'url' || undefined}
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
          />
          {url && (
            <button type="button" className="btn ghost icon sm" onClick={reset} aria-label="Eingabe leeren">
              <X />
            </button>
          )}
          <button type="submit" className="btn thread lg" disabled={busy || !url.trim() || slugState === 'bad'}>
            {busy ? <span className="spinner" /> : batch ? <Layers /> : <Sparkles />}
            {batch ? `${batch.length} kürzen` : 'Kürzen'}
          </button>
        </div>
        {showOptions && !batch && (
          <div className="composer-options">
            <div className="composer-slug">
              {activeDomains.length > 1 ? (
                <select value={effectiveDomain?.id} onChange={(e) => setDomainId(Number(e.target.value))} aria-label="Domain">
                  {activeDomains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.host}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="mono xsmall muted" style={{ padding: '0 4px 0 10px' }}>
                  {effectiveDomain?.host}
                </span>
              )}
              <span className="slash">/</span>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value.replace(/\s+/g, '-'))}
                placeholder="automatisch"
                aria-label="Eigene Kurzadresse (optional)"
                aria-invalid={slugState === 'bad' || undefined}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="button" className="btn ghost icon sm" onClick={() => void suggestReadable()} title="Lesbare Kurzadresse vorschlagen" aria-label="Lesbare Kurzadresse vorschlagen">
                <Wand2 />
              </button>
            </div>
            {slugState === 'ok' && (
              <span className="slug-status ok">
                <Check /> frei
              </span>
            )}
            {slugState === 'bad' && (
              <span className="slug-status bad" title={slugCheck.data?.reason}>
                <CircleAlert /> {slugCheck.data?.reason && slugCheck.data.reason.length < 60 ? slugCheck.data.reason : 'nicht verfügbar'}
              </span>
            )}
            <span className="spacer" />
            {!!presets.data?.items.length && (
              <select
                className="select"
                style={{ width: 'auto', minHeight: 34, fontSize: 'var(--fs-sm)' }}
                value={preset?.id ?? ''}
                onChange={(e) => applyPreset(presets.data!.items.find((p) => p.id === Number(e.target.value)) ?? null)}
                aria-label="Vorlage"
              >
                <option value="">Ohne Vorlage</option>
                {presets.data.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    Vorlage: {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {batch && (
          <div className="composer-options">
            <Layers size={16} className="muted" />
            <span className="small">
              <strong>{batch.length} Adressen</strong> erkannt. Jede bekommt eine eigene Kurzadresse auf <span className="mono">{effectiveDomain?.host}</span>.
            </span>
          </div>
        )}
      </form>

      {error && (
        <div className="callout danger" style={{ marginTop: 10 }} role="alert">
          <CircleAlert />
          <span>{error.message}</span>
        </div>
      )}

      {dup && !error && url.trim() && (
        <div className="callout info composer-dup" style={{ marginTop: 10 }}>
          <Link2 />
          <span style={{ flex: 1 }}>
            Für dieses Ziel gibt es schon <span className="mono">{dup.domain.host}/{dup.slug}</span>
            {dup.clicks ? ` (${num(dup.clicks)} Aufrufe)` : ''}. Sie können ihn wiederverwenden oder trotzdem einen neuen anlegen.
          </span>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              void copyText(dup.shortUrl).then((ok) => ok && toast.ok('Vorhandener Kurzlink kopiert'));
            }}
          >
            <Copy /> Vorhandenen kopieren
          </button>
        </div>
      )}

      {result && <ResultCard key={result.drawKey} result={result} onClose={() => setResult(null)} onOpen={() => navigate(`/links/${result.link.id}`)} />}
    </div>
  );
}

function ResultCard({ result, onClose, onOpen }: { result: { link: Link; copied: boolean }; onClose: () => void; onOpen: () => void }) {
  const { link } = result;
  const toast = useToast();
  const [copied, setCopied] = useState(result.copied);
  const short = link.shortUrl.replace(/^https?:\/\//, '');
  const slash = short.indexOf('/');
  return (
    <div className="result-card" role="status" aria-live="polite">
      <img className="qr-mini" src={`/api/v1/links/${link.id}/qr?format=svg&margin=1`} alt="" />
      <div style={{ minWidth: 0 }}>
        <a className="result-short" href={link.shortUrl} target="_blank" rel="noreferrer">
          <span className="host">{short.slice(0, slash + 1)}</span>
          {short.slice(slash + 1)}
        </a>
        <div className="result-thread">
          <ThreadGlyph draw />
          <span className="ellipsis">{link.url}</span>
        </div>
      </div>
      <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
        <button
          className={`btn ${copied ? '' : 'primary'}`}
          onClick={() => {
            void copyText(link.shortUrl).then((ok) => {
              if (ok) {
                setCopied(true);
                toast.ok('Kurzlink kopiert');
              }
            });
          }}
        >
          {copied ? <Check style={{ color: 'var(--ok)' }} /> : <Copy />}
          {copied ? 'Kopiert' : 'Kopieren'}
        </button>
        <a className="btn icon" href={`/api/v1/links/${link.id}/qr?format=png&size=1024&download=1`} title="QR-Code herunterladen" aria-label="QR-Code herunterladen">
          <QrCode />
        </a>
        <a className="btn icon" href={link.shortUrl} target="_blank" rel="noreferrer" title="Kurzlink testen" aria-label="Kurzlink in neuem Tab testen">
          <ExternalLink />
        </a>
        <button className="btn" onClick={onOpen}>
          <PanelRight /> Details
        </button>
        <button className="btn ghost icon" onClick={onClose} aria-label="Hinweis schließen">
          <X />
        </button>
      </div>
    </div>
  );
}
