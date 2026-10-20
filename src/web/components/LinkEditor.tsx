import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  GitFork,
  Globe,
  KeyRound,
  Megaphone,
  Plus,
  Route,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useBlocker } from 'react-router';
import { api, ApiError, qs } from '../lib/api';
import { fromLocalInput, num, relative, toLocalInput } from '../lib/format';
import { useCampaigns, useCollections, useDomains, useInvalidateLinks } from '../lib/queries';
import type { Link, Routing, Rule, Utm, Variant } from '../lib/types';
import { Dialog } from './overlay';
import { TagInput } from './TagInput';
import { useToast } from './toast';
import { Field, Switch, useFieldId } from './ui';

const UTM_FIELDS: { key: keyof Utm; label: string; hint: string }[] = [
  { key: 'utm_source', label: 'Quelle', hint: 'z. B. newsletter, flyer, linkedin' },
  { key: 'utm_medium', label: 'Medium', hint: 'z. B. email, print, social' },
  { key: 'utm_campaign', label: 'Kampagne', hint: 'z. B. herbst-2026' },
  { key: 'utm_term', label: 'Begriff', hint: 'optional' },
  { key: 'utm_content', label: 'Inhalt', hint: 'optional, z. B. button-oben' },
];

interface Draft {
  url: string;
  title: string;
  notes: string;
  tags: string[];
  collectionId: number | null;
  campaignId: number | null;
  domainId: number;
  slug: string;
  protected: boolean;
  startsAt: string;
  expiresAt: string;
  maxClicks: string;
  fallbackUrl: string;
  passwordMode: 'keep' | 'set' | 'remove' | 'none';
  password: string;
  utm: Utm;
  routing: Routing;
  redirectType: 301 | 302 | 307 | 308;
  forwardQuery: boolean;
}

const emptyRouting = (): Routing => ({ rules: [], mainWeight: 50, variants: [] });
const rid = () => Math.random().toString(36).slice(2, 9);

function toDraft(l: Link): Draft {
  return {
    url: l.url,
    title: l.title,
    notes: l.notes,
    tags: l.tags.map((t) => t.name),
    collectionId: l.collection?.id ?? null,
    campaignId: l.campaign?.id ?? null,
    domainId: l.domain.id,
    slug: l.slug,
    protected: l.protected,
    startsAt: toLocalInput(l.startsAt),
    expiresAt: toLocalInput(l.expiresAt),
    maxClicks: l.maxClicks ? String(l.maxClicks) : '',
    fallbackUrl: l.fallbackUrl ?? '',
    passwordMode: l.hasPassword ? 'keep' : 'none',
    password: '',
    utm: { ...(l.utm ?? {}) },
    routing: l.routing ? structuredClone(l.routing) : emptyRouting(),
    redirectType: l.redirectType,
    forwardQuery: l.forwardQuery,
  };
}

function buildPatch(l: Link, d: Draft): Record<string, unknown> {
  const o = toDraft(l);
  const p: Record<string, unknown> = {};
  if (d.url.trim() !== o.url) p.url = d.url.trim();
  if (d.title !== o.title) p.title = d.title;
  if (d.notes !== o.notes) p.notes = d.notes;
  if (JSON.stringify(d.tags) !== JSON.stringify(o.tags)) p.tags = d.tags;
  if (d.collectionId !== o.collectionId) p.collectionId = d.collectionId;
  if (d.campaignId !== o.campaignId) p.campaignId = d.campaignId;
  if (d.domainId !== o.domainId) p.domainId = d.domainId;
  if (d.slug.trim() !== o.slug) p.slug = d.slug.trim();
  if (d.protected !== o.protected) p.protected = d.protected;
  if (d.startsAt !== o.startsAt) p.startsAt = fromLocalInput(d.startsAt);
  if (d.expiresAt !== o.expiresAt) p.expiresAt = fromLocalInput(d.expiresAt);
  if (d.maxClicks !== o.maxClicks) p.maxClicks = d.maxClicks ? Number(d.maxClicks) : null;
  if (d.fallbackUrl !== o.fallbackUrl) p.fallbackUrl = d.fallbackUrl.trim() || null;
  if (d.passwordMode === 'set' && d.password) p.password = d.password;
  if (d.passwordMode === 'remove') p.password = null;
  const utmClean = Object.fromEntries(Object.entries(d.utm).filter(([, v]) => v?.trim()));
  if (JSON.stringify(utmClean) !== JSON.stringify(Object.fromEntries(Object.entries(o.utm).filter(([, v]) => v?.trim())))) {
    p.utm = Object.keys(utmClean).length ? utmClean : null;
  }
  const r = cleanRouting(d.routing).routing;
  const hasRouting = r.rules.length > 0 || r.variants.length > 0;
  if (JSON.stringify(hasRouting ? r : null) !== JSON.stringify(l.routing)) p.routing = hasRouting ? r : null;
  if (d.redirectType !== o.redirectType) p.redirectType = d.redirectType;
  if (d.forwardQuery !== o.forwardQuery) p.forwardQuery = d.forwardQuery;
  return p;
}

type FieldError = { message: string; field?: string; code?: string };

const ruleHasCondition = (r: Rule) => Object.values(r.when).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
const ruleIsEmpty = (r: Rule) => !r.url.trim() && !r.label.trim() && !ruleHasCondition(r);

/**
 * Völlig leere Regeln und Varianten ohne Ziel werden nicht gespeichert.
 * `rules`/`variants` ordnen die Positionen im gespeicherten Stand den Positionen im Formular zu.
 */
function cleanRouting(r: Routing): { routing: Routing; rules: number[]; variants: number[] } {
  const rules: number[] = [];
  const variants: number[] = [];
  r.rules.forEach((x, i) => !ruleIsEmpty(x) && rules.push(i));
  r.variants.forEach((x, i) => x.url.trim() && variants.push(i));
  return {
    routing: { ...r, rules: rules.map((i) => ({ ...r.rules[i], url: r.rules[i].url.trim() })), variants: variants.map((i) => ({ ...r.variants[i], url: r.variants[i].url.trim() })) },
    rules,
    variants,
  };
}

/** Prüft vor dem Speichern, was der Server sonst mit einer technischen Meldung ablehnen würde. */
function precheck(d: Draft): FieldError | null {
  if (!d.url.trim()) return { field: 'url', message: 'Bitte eine Zieladresse eingeben.' };
  if (d.passwordMode === 'set' && d.password && d.password.length < 8) return { field: 'password', message: 'Das Passwort muss mindestens 8 Zeichen lang sein.' };
  for (const [i, r] of d.routing.rules.entries()) {
    if (ruleIsEmpty(r)) continue;
    if (!r.url.trim()) return { field: `routing.rules.${i}.url`, message: `Regel ${i + 1}: Bitte ein Ziel angeben.` };
    if (!ruleHasCondition(r)) {
      return { field: `routing.rules.${i}`, message: `Regel ${i + 1}: Bitte mindestens eine Bedingung wählen – Gerät, Sprache, Uhrzeit, Wochentag oder Datum.` };
    }
  }
  return null;
}

const UTM_LABEL: Record<string, string> = Object.fromEntries(UTM_FIELDS.map((f) => [f.key, `UTM-${f.label}`]));
const looksTechnical = (m: string) => /^(zu klein|zu groß|ungültig|erwartet|invalid|too (small|big)|expected|required)/i.test(m.trim());

/** Übersetzt Serverfehler (u. a. rohe Zod-Pfade wie „routing.rules.0.url: Zu klein …“) in Klartext. */
function friendlyError(e: ApiError, map?: { rules: number[]; variants: number[] }): FieldError {
  let field = e.field;
  let raw = e.message;
  if (field && raw.startsWith(`${field}: `)) raw = raw.slice(field.length + 2);
  if (!field) return { message: raw, code: e.code };
  const m = /^routing\.(rules|variants)\.(\d+)(?:\.(.+))?$/.exec(field);
  if (m) {
    const kind = m[1] as 'rules' | 'variants';
    const idx = map?.[kind][Number(m[2])] ?? Number(m[2]);
    const sub = m[3] ?? '';
    field = `routing.${kind}.${idx}${sub ? `.${sub}` : ''}`;
    const who = `${kind === 'rules' ? 'Regel' : 'Variante'} ${idx + 1}`;
    let msg = raw;
    if (sub === 'url' && /zu klein|too small|eingeben/i.test(raw)) msg = 'Bitte ein Ziel angeben.';
    else if (sub === 'url' && /zu groß|too big/i.test(raw)) msg = 'Die Zieladresse ist zu lang.';
    else if (/^when\.time/.test(sub)) msg = 'Bitte eine Uhrzeit im Format HH:MM angeben.';
    else if (/^when\.language/.test(sub)) msg = 'Sprachen bitte als Kürzel aus zwei oder drei Buchstaben angeben, z. B. de, en.';
    else if (/^when\.date/.test(sub)) msg = 'Bitte ein gültiges Datum angeben.';
    else if (sub === 'label') msg = 'Die Bezeichnung ist zu lang (höchstens 80 Zeichen).';
    else if (sub === 'weight') msg = 'Das Gewicht muss zwischen 0 und 100 liegen.';
    else if (looksTechnical(raw)) msg = 'Bitte die Angaben prüfen.';
    return { field, code: e.code, message: `${who}: ${msg}` };
  }
  if (field === 'routing' || field.startsWith('routing.')) {
    return { field: 'routing', code: e.code, message: looksTechnical(raw) ? 'Regeln und Varianten: Bitte die Angaben prüfen.' : raw };
  }
  const utm = /^utm\.(utm_\w+)$/.exec(field);
  if (utm) return { field, code: e.code, message: `${UTM_LABEL[utm[1]] ?? 'UTM'}: ${looksTechnical(raw) ? 'Der Wert ist zu lang (höchstens 200 Zeichen).' : raw}` };
  // Feldnamen ohne Übersetzung nicht anzeigen
  if (raw === e.message && /^[a-z]+(\.[\w]+)+: /i.test(raw)) raw = raw.slice(raw.indexOf(': ') + 2);
  return { field, code: e.code, message: looksTechnical(raw) ? 'Bitte die Eingabe prüfen.' : raw };
}

/** Übernimmt einen neueren Serverstand, behält aber die Felder, die gerade bearbeitet werden. */
function rebase(oldLink: Link, next: Link, d: Draft): Draft {
  const o = toDraft(oldLink);
  const n = toDraft(next);
  const out: Record<string, unknown> = { ...n };
  for (const k of Object.keys(d) as (keyof Draft)[]) if (JSON.stringify(d[k]) !== JSON.stringify(o[k])) out[k] = d[k];
  return out as unknown as Draft;
}

function shortDate(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return local;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
  return d.getHours() || d.getMinutes() ? `${day}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : day;
}

function scheduleSummary(d: Draft): string {
  return [
    d.startsAt && `ab ${shortDate(d.startsAt)}`,
    d.expiresAt && `bis ${shortDate(d.expiresAt)}`,
    d.maxClicks && `max. ${num(Number(d.maxClicks))} Aufrufe`,
    d.fallbackUrl.trim() && 'Ersatzziel',
  ]
    .filter(Boolean)
    .join(' · ');
}

function Section({ icon, title, note, children, open }: { icon: ReactNode; title: string; note?: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="section" open={open}>
      <summary>
        {icon}
        {title}
        {note && <span className="summary-note">{note}</span>}
        <ChevronRight className="chev" />
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

/**
 * Formular des Inspectors. Bleibt montiert, solange derselbe Link offen ist (auch auf anderen Reitern und nach dem Speichern),
 * damit Entwurf, aufgeklappte Abschnitte und Scrollposition erhalten bleiben.
 */
export function LinkEditor({
  link,
  hidden = false,
  leaveRef,
  onReveal,
}: {
  link: Link;
  /** Formular ausblenden (anderer Reiter aktiv), Entwurf und Speicherleiste bleiben erhalten */
  hidden?: boolean;
  /** true: Navigation ohne Rückfrage zulassen (z. B. nach dem Löschen) */
  leaveRef?: RefObject<boolean>;
  /** Formular zeigen, etwa wenn ein Feld einen Fehler hat */
  onReveal?: () => void;
}) {
  // Stand, auf den sich der Entwurf bezieht. Neuere Serverstände werden eingearbeitet, ohne laufende Eingaben zu überschreiben.
  const [base, setBase] = useState<Link>(link);
  const [draft, setDraft] = useState<Draft>(() => toDraft(link));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FieldError | null>(null);
  // Nach einer Zieländerung: auf die neue Seitenvorschau warten und deren Titel anbieten
  const [metaWait, setMetaWait] = useState<{ since: string | null; until: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const domains = useDomains();
  const collections = useCollections();
  const campaigns = useCampaigns();
  const invalidate = useInvalidateLinks();
  const toast = useToast();
  const readOnly = !link.canEdit;
  const ids = { url: useFieldId(), title: useFieldId(), tags: useFieldId(), notes: useFieldId(), slug: useFieldId() };

  if (link !== base && link.updatedAt >= base.updatedAt) {
    // Während des Renderns abgleichen (statt im Effekt), damit kein veralteter Entwurf aufblitzt.
    // Ältere Stände (z. B. eine Antwort, die nach dem Speichern eintrifft) werden ignoriert.
    if (link.updatedAt !== base.updatedAt) setDraft((d) => rebase(base, link, d));
    setBase(link);
  }

  const patch = useMemo(() => buildPatch(base, draft), [base, draft]);
  const dirty = Object.keys(patch).length > 0;
  const guard = dirty && !readOnly;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setError((e) => (e?.field && (e.field === k || e.field.startsWith(`${k}.`)) ? null : e));
  };

  const slugChanged = draft.slug.trim() !== base.slug || draft.domainId !== base.domain.id;
  const slugCheck = useQuery({
    queryKey: ['slug-check', draft.domainId, draft.slug.trim(), link.id],
    queryFn: () => api.get<{ available: boolean; reason?: string }>(`/api/v1/slug/check${qs({ domainId: draft.domainId, slug: draft.slug.trim(), exceptId: link.id })}`),
    enabled: slugChanged && draft.slug.trim().length > 0,
  });

  /** Speichert den Entwurf; true bei Erfolg. */
  const save = async (): Promise<boolean> => {
    const problem = precheck(draft);
    if (problem) {
      setError(problem);
      onReveal?.();
      return false;
    }
    setSaving(true);
    setError(null);
    const map = cleanRouting(draft.routing);
    try {
      const saved = await api.patch<Link>(`/api/v1/links/${link.id}`, patch);
      if (patch.url) setMetaWait({ since: base.meta.fetchedAt, until: Date.now() + 30_000 });
      qc.setQueryData(['link', link.id], saved);
      setBase(saved);
      setDraft(toDraft(saved));
      invalidate();
      toast.ok(patch.url ? 'Gespeichert. Das neue Ziel gilt ab sofort.' : 'Gespeichert');
      return true;
    } catch (e) {
      const fe = e instanceof ApiError ? friendlyError(e, map) : { message: 'Speichern fehlgeschlagen.' };
      setError(fe);
      if (fe.field) onReveal?.();
      return false;
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(toDraft(base));
    setError(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty && !saving && !readOnly) void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, patch, draft]);

  // Ungespeicherte Änderungen schützen: Routenwechsel (Zeile, Seitenleiste, ⌘K, Tastenkürzel, Esc, Schließen) und Neuladen.
  // Nur der Pfad zählt – Filter ändern lediglich die Suchparameter, der Inspector bleibt dabei offen.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => guard && !leaveRef?.current && currentLocation.pathname !== nextLocation.pathname);
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  // Stabil, damit der Dialog seinen Fokus nicht bei jedem Rendern neu setzt
  const keepEditing = useCallback(() => blockerRef.current.reset?.(), []);
  useEffect(() => {
    if (!guard) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [guard]);

  // Fehlerhaftes Feld sichtbar machen: Abschnitt aufklappen, hinscrollen, fokussieren
  useEffect(() => {
    const root = bodyRef.current;
    if (!error?.field || !root) return;
    let f = error.field;
    let el: HTMLElement | null = null;
    while (f && !(el = root.querySelector<HTMLElement>(`[data-field="${CSS.escape(f)}"]`))) f = f.includes('.') ? f.slice(0, f.lastIndexOf('.')) : '';
    if (!el) return;
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
    const target = el;
    requestAnimationFrame(() => {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
      const focusable = target.matches('input, select, textarea') ? target : target.querySelector<HTMLElement>('input:not([type="range"]), select, textarea');
      focusable?.focus({ preventScroll: true });
    });
  }, [error]);

  // Neue Seitenvorschau abwarten (der Server lädt sie nach einer Zieländerung im Hintergrund)
  const metaArrived = metaWait !== null && link.meta.fetchedAt !== metaWait.since;
  useEffect(() => {
    if (!metaWait || metaArrived) return;
    if (Date.now() > metaWait.until) {
      setMetaWait(null);
      return;
    }
    const t = window.setTimeout(() => void qc.invalidateQueries({ queryKey: ['link', link.id] }), 2500);
    return () => window.clearTimeout(t);
  }, [metaWait, metaArrived, link, qc]);
  const pageTitle = link.meta.title?.trim() ?? '';
  const titleOffer = metaArrived && pageTitle && draft.title.trim() && pageTitle !== draft.title.trim() ? pageTitle : null;

  const err = (f: string) => (error?.field === f || error?.field?.startsWith(`${f}.`) ? error.message : null);
  const campaign = campaigns.data?.items.find((c) => c.id === draft.campaignId);
  const finalUrl = useMemo(() => {
    try {
      const u = new URL(draft.url.trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return draft.url;
      const merged: Utm = { ...(campaign?.utm ?? {}), ...Object.fromEntries(Object.entries(draft.utm).filter(([, v]) => v?.trim())) };
      for (const [k, v] of Object.entries(merged)) if (v) u.searchParams.set(k, v);
      return u.toString();
    } catch {
      return draft.url;
    }
  }, [draft.url, draft.utm, campaign]);

  const permanent = draft.redirectType === 301 || draft.redirectType === 308;
  const dynamic = Boolean(draft.startsAt || draft.expiresAt || draft.maxClicks || draft.routing.rules.length || draft.routing.variants.length || draft.passwordMode === 'keep' || draft.passwordMode === 'set');
  const scheduleNote = scheduleSummary(draft);
  const nRules = draft.routing.rules.length;
  const nVariants = draft.routing.variants.length;
  const routingNote = [nRules && `${nRules} ${nRules === 1 ? 'Regel' : 'Regeln'}`, nVariants && `${nVariants} ${nVariants === 1 ? 'Variante' : 'Varianten'}`].filter(Boolean).join(', ');
  const utmCount = Object.values(draft.utm).filter((v) => v?.trim()).length;
  const activeDomains = (domains.data?.items ?? []).filter((d) => d.status === 'active' || d.id === link.domain.id);
  const domainLabel = `${activeDomains.find((d) => d.id === draft.domainId)?.host ?? link.domain.host}/`;

  return (
    <>
      <div className="inspector-body" ref={bodyRef} hidden={hidden}>
        {readOnly && (
          <div className="callout info">
            <CircleHelp />
            <span>Sie können diesen Link ansehen, aber nicht ändern. Bearbeiten dürfen die Person, der er gehört, und die Redaktion.</span>
          </div>
        )}

        <Preview link={link} />

        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 16, minWidth: 0 }}>
          <Field label="Ziel" htmlFor={ids.url} error={err('url')}>
            <input
              id={ids.url}
              className="input mono editor-url"
              type="text"
              inputMode="url"
              autoComplete="off"
              data-field="url"
              value={draft.url}
              onChange={(e) => set('url', e.target.value.replace(/[\r\n]+/g, ''))}
              title={draft.url}
              spellCheck={false}
              aria-invalid={Boolean(err('url')) || undefined}
            />
          </Field>
          {draft.url.trim() !== link.url && link.protected && (
            <div className="callout warn">
              <TriangleAlert />
              <span>Dieser Link ist verteilt. Wer ihn bereits hat, landet nach dem Speichern sofort beim neuen Ziel. Die bisherige Adresse bleibt im Verlauf und lässt sich zurückholen.</span>
            </div>
          )}

          <Field label="Titel" htmlFor={ids.title} hint="Nur für Sie und Ihr Team sichtbar, hilft beim Wiederfinden.">
            <input id={ids.title} className="input" data-field="title" value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder={link.meta.title ?? 'Titel'} />
          </Field>
          {titleOffer && !readOnly && (
            <div className="title-offer" role="status">
              <span className="small muted">Die neue Zielseite heißt anders.</span>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  set('title', titleOffer);
                  setMetaWait(null);
                }}
              >
                <span>Seitentitel übernehmen:</span>
                <span className="title-offer-text">„{titleOffer}“</span>
              </button>
              <button type="button" className="btn ghost icon sm" onClick={() => setMetaWait(null)} aria-label="Vorschlag ausblenden" title="Vorschlag ausblenden">
                <X />
              </button>
            </div>
          )}

          <Field label="Schlagwörter" htmlFor={ids.tags}>
            <TagInput id={ids.tags} value={draft.tags} onChange={(v) => set('tags', v)} disabled={readOnly} />
          </Field>

          <div className="grid-2">
            <Field label="Sammlung">
              <select className="select" value={draft.collectionId ?? ''} onChange={(e) => set('collectionId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Keine</option>
                {collections.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kampagne">
              <select className="select" value={draft.campaignId ?? ''} onChange={(e) => set('campaignId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Keine</option>
                {campaigns.data?.items
                  .filter((c) => !c.archived || c.id === draft.campaignId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>

          <Field label="Notiz" htmlFor={ids.notes}>
            <textarea id={ids.notes} className="textarea" rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} placeholder="z. B. Wo wurde der Link verteilt?" />
          </Field>

          <Section icon={<Globe />} title="Kurzadresse" note={`${link.domain.host}/${link.slug}`}>
            <div className="input-group">
              {activeDomains.length > 1 ? (
                <select
                  className="select editor-domain"
                  // Breite nach Inhalt: Martian Mono ist dicktengleich, „ch“ trifft also genau.
                  style={{ width: `calc(${domainLabel.length}ch + 48px)` }}
                  value={draft.domainId}
                  onChange={(e) => set('domainId', Number(e.target.value))}
                  aria-label="Domain"
                  data-field="domainId"
                >
                  {activeDomains.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.host}/
                    </option>
                  ))}
                </select>
              ) : (
                <span className="addon">{domainLabel}</span>
              )}
              <input
                id={ids.slug}
                className="input mono"
                data-field="slug"
                value={draft.slug}
                onChange={(e) => set('slug', e.target.value.replace(/\s+/g, '-'))}
                aria-label="Kurzadresse"
                aria-invalid={Boolean(err('slug')) || undefined}
                spellCheck={false}
              />
            </div>
            {err('slug') && <span className="error-text">{err('slug')}</span>}
            {slugChanged && slugCheck.data && (
              <span className={`slug-status ${slugCheck.data.available ? 'ok' : 'bad'}`}>
                {slugCheck.data.available ? <Check /> : <CircleAlert />}
                {slugCheck.data.available ? 'Frei' : slugCheck.data.reason}
              </span>
            )}
            {slugChanged && link.clicks > 0 && (
              <div className="callout warn">
                <TriangleAlert />
                <span>Die alte Adresse {link.domain.host}/{link.slug} funktioniert danach nicht mehr und bleibt reserviert. Für gedruckte Links besser einen zusätzlichen Link anlegen.</span>
              </div>
            )}
            <label className="radio-card" style={{ gridTemplateColumns: 'auto 1fr' }}>
              <input type="checkbox" checked={draft.protected} onChange={(e) => set('protected', e.target.checked)} />
              <strong>
                <ShieldCheck size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
                Verteilt – vor Versehen schützen
              </strong>
              <span>Für gedruckte oder verschickte Links. Die Kurzadresse lässt sich nicht mehr ändern, Löschen braucht eine ausdrückliche Bestätigung, Zieländerungen werden markiert.</span>
            </label>
          </Section>

          <Section icon={<CalendarClock />} title="Zeitplan und Limit" note={scheduleNote}>
            <div className="grid-2">
              <Field label="Aktiv ab" error={err('startsAt')}>
                <input className="input" type="datetime-local" data-field="startsAt" value={draft.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
              </Field>
              <Field label="Läuft ab" error={err('expiresAt')}>
                <input className="input" type="datetime-local" data-field="expiresAt" value={draft.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
              </Field>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="xsmall muted">Ablauf in</span>
              {[
                ['1 Woche', 7],
                ['30 Tagen', 30],
                ['3 Monaten', 91],
                ['1 Jahr', 365],
              ].map(([label, days]) => (
                <button key={label} type="button" className="btn sm" onClick={() => set('expiresAt', toLocalInput(new Date(Date.now() + Number(days) * 86400_000).toISOString()))}>
                  {label}
                </button>
              ))}
              {draft.expiresAt && (
                <button type="button" className="btn sm" onClick={() => set('expiresAt', '')}>
                  <X /> Kein Ablauf
                </button>
              )}
            </div>
            <div className="grid-2">
              <Field label="Höchstens … Aufrufe" error={err('maxClicks')} hint="Danach gilt der Link als abgelaufen. Link-Vorschauen zählen nicht.">
                <input className="input" type="number" min={1} inputMode="numeric" data-field="maxClicks" value={draft.maxClicks} onChange={(e) => set('maxClicks', e.target.value.replace(/\D/g, ''))} placeholder="unbegrenzt" />
              </Field>
              <Field label="Ersatzziel" error={err('fallbackUrl')} hint="Wohin, wenn der Link (noch) nicht aktiv ist. Leer: Hinweisseite.">
                <input className="input mono" data-field="fallbackUrl" value={draft.fallbackUrl} onChange={(e) => set('fallbackUrl', e.target.value)} placeholder="https://…" spellCheck={false} />
              </Field>
            </div>
          </Section>

          <Section icon={<KeyRound />} title="Passwortschutz" note={draft.passwordMode === 'keep' ? 'aktiv' : draft.passwordMode === 'set' ? 'wird gesetzt' : draft.passwordMode === 'remove' ? 'wird entfernt' : undefined}>
            {draft.passwordMode === 'keep' ? (
              <div className="row wrap">
                <span className="pill ok">
                  <KeyRound /> Passwort gesetzt
                </span>
                <button type="button" className="btn sm" onClick={() => set('passwordMode', 'set')}>
                  Ändern
                </button>
                <button type="button" className="btn sm danger" onClick={() => set('passwordMode', 'remove')}>
                  Entfernen
                </button>
              </div>
            ) : draft.passwordMode === 'remove' ? (
              <div className="row">
                <span className="small muted">Der Schutz wird beim Speichern entfernt.</span>
                <button type="button" className="btn sm ghost" onClick={() => set('passwordMode', 'keep')}>
                  <Undo2 /> Doch behalten
                </button>
              </div>
            ) : (
              <Field label="Passwort" error={err('password')} hint="Besucher geben es auf einer neutralen Seite ein, bevor sie weitergeleitet werden. Mindestens 8 Zeichen.">
                <input
                  className="input"
                  type="text"
                  autoComplete="off"
                  data-field="password"
                  value={draft.password}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDraft((d) => ({ ...d, password: v, passwordMode: v ? 'set' : base.hasPassword ? 'set' : 'none' }));
                    setError((er) => (er?.field === 'password' ? null : er));
                  }}
                  placeholder="Kein Passwort"
                />
              </Field>
            )}
          </Section>

          <Section icon={<Megaphone />} title="Kampagnenparameter (UTM)" note={utmCount ? `${utmCount} gesetzt` : campaign ? `von „${campaign.name}“` : undefined}>
            {campaign && Object.values(campaign.utm).some(Boolean) && (
              <p className="small muted">Die Kampagne „{campaign.name}“ setzt bereits Werte. Felder hier überschreiben sie für diesen Link.</p>
            )}
            <div className="grid-2">
              {UTM_FIELDS.map((f) => (
                <Field key={f.key} label={f.label} error={err(`utm.${f.key}`)}>
                  <input
                    className="input"
                    data-field={`utm.${f.key}`}
                    value={draft.utm[f.key] ?? ''}
                    onChange={(e) => set('utm', { ...draft.utm, [f.key]: e.target.value })}
                    placeholder={campaign?.utm[f.key] || f.hint}
                    spellCheck={false}
                  />
                </Field>
              ))}
            </div>
            {finalUrl !== draft.url.trim() && (
              <div className="field">
                <span className="label">Besucher landen auf</span>
                <span className="code-block" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                  {finalUrl}
                </span>
              </div>
            )}
          </Section>

          <Section icon={<GitFork />} title="Regeln und Varianten" note={routingNote}>
            <RoutingEditor value={draft.routing} onChange={(r) => set('routing', r)} mainUrl={draft.url} error={error?.field?.startsWith('routing') ? error : null} />
          </Section>

          <Section icon={<Route />} title="Weiterleitung" note={`${draft.redirectType}${dynamic && permanent ? ' → wirkt als temporär' : ''}`}>
            <div className="radio-cards" role="radiogroup" aria-label="Weiterleitungsart">
              <label className="radio-card">
                <input type="radio" name="rt" checked={draft.redirectType === 302} onChange={() => set('redirectType', 302)} />
                <strong>Temporär (302) – empfohlen</strong>
                <span>Browser fragen jedes Mal nach. Zieländerungen wirken sofort, Statistik ist vollständig.</span>
              </label>
              <label className="radio-card">
                <input type="radio" name="rt" checked={draft.redirectType === 301} onChange={() => set('redirectType', 301)} />
                <strong>Permanent (301)</strong>
                <span>
                  Für dauerhafte Umzüge und Suchmaschinen. Browser merken sich das Ziel bis zu {Math.round((domains.data?.items.find((d) => d.id === draft.domainId)?.permanentMaxAge ?? 3600) / 60)} Minuten; so lange zählen wiederholte Aufrufe nicht und Änderungen wirken verzögert.
                </span>
              </label>
              <details>
                <summary className="small muted" style={{ cursor: 'pointer', padding: '4px 2px' }}>
                  Weitere Arten (307, 308)
                </summary>
                <div className="radio-cards" style={{ marginTop: 8 }}>
                  <label className="radio-card">
                    <input type="radio" name="rt" checked={draft.redirectType === 307} onChange={() => set('redirectType', 307)} />
                    <strong>Temporär, Methode bleibt (307)</strong>
                    <span>Wie 302, aber Formulare werden mit derselben Methode weitergeschickt.</span>
                  </label>
                  <label className="radio-card">
                    <input type="radio" name="rt" checked={draft.redirectType === 308} onChange={() => set('redirectType', 308)} />
                    <strong>Permanent, Methode bleibt (308)</strong>
                    <span>Wie 301 für Formulare und APIs.</span>
                  </label>
                </div>
              </details>
            </div>
            {permanent && dynamic && (
              <div className="callout info">
                <CircleHelp />
                <span>Weil dieser Link einen Zeitplan, ein Limit, ein Passwort oder Regeln hat, sendet Filum automatisch eine temporäre Weiterleitung. Sonst würden Browser ein veraltetes Ziel zwischenspeichern.</span>
              </div>
            )}
            <Switch checked={draft.forwardQuery} onChange={(v) => set('forwardQuery', v)}>
              Parameter weitergeben (z. B. <code>?ref=mail</code> landet auch am Ziel)
            </Switch>
          </Section>
        </fieldset>
      </div>

      {dirty && !readOnly && (
        <div className="inspector-foot">
          {error ? (
            <span className="error-text" style={{ flex: 1 }} role="alert">
              {error.message}
            </span>
          ) : (
            <span className="small muted" style={{ flex: 1 }}>
              Ungespeicherte Änderungen
            </span>
          )}
          <button className="btn" onClick={discard} disabled={saving}>
            Verwerfen
          </button>
          {error?.code === 'protected' ? (
            <button
              className="btn primary"
              disabled={saving}
              onClick={() => {
                setDraft((d) => ({ ...d, protected: false }));
                setError(null);
              }}
            >
              Schutz aufheben
            </button>
          ) : (
            <button className="btn primary" onClick={() => void save()} disabled={saving || (slugChanged && slugCheck.data?.available === false)}>
              {saving ? <span className="spinner" /> : <Check />}
              Speichern
              <span className="kbd" style={{ background: 'transparent', color: 'inherit', borderColor: 'currentColor', opacity: 0.6 }}>
                ⌘S
              </span>
            </button>
          )}
        </div>
      )}

      <Dialog open={blocker.state === 'blocked'} onClose={keepEditing} label="Ungespeicherte Änderungen" className="confirm-dialog">
        <div className="confirm-body">
          <h2>Ungespeicherte Änderungen</h2>
          <p>
            Ihre Änderungen an <span className="mono">{base.domain.host}/{base.slug}</span> sind noch nicht gespeichert. Was soll damit geschehen?
          </p>
        </div>
        <div className="confirm-foot">
          <button type="button" className="btn" onClick={keepEditing} disabled={saving}>
            Weiter bearbeiten
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="btn danger"
            disabled={saving}
            onClick={() => {
              discard();
              blocker.proceed?.();
            }}
          >
            Verwerfen
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={saving}
            onClick={() =>
              void save().then((ok) => {
                // Bei einem Fehler im Formular bleiben – das Feld ist dann markiert.
                if (ok) blocker.proceed?.();
                else blocker.reset?.();
              })
            }
          >
            {saving ? <span className="spinner" /> : <Check />}
            Speichern
          </button>
        </div>
      </Dialog>
    </>
  );
}

function Preview({ link }: { link: Link }) {
  const h = link.health;
  const healthView =
    h.status === 'ok'
      ? { cls: 'ok', icon: <CircleCheck size={14} />, text: 'Ziel erreichbar' }
      : h.status === 'broken'
        ? { cls: 'warn', icon: <TriangleAlert size={14} />, text: 'Ziel gestört' }
        : h.status === 'warning'
          ? { cls: 'warn', icon: <CircleAlert size={14} />, text: 'Ziel antwortet eingeschränkt' }
          : h.status === 'skipped'
            ? { cls: '', icon: <CircleHelp size={14} />, text: 'Nicht prüfbar' }
            : null;
  const hasMeta = link.meta.title || link.meta.description || link.meta.imageUrl;
  if (!hasMeta && !healthView) return null;
  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      {link.meta.imageUrl && <img src={link.meta.imageUrl} alt="" style={{ width: '100%', aspectRatio: '1.91', objectFit: 'cover', display: 'block', borderBottom: '1px solid var(--line)' }} />}
      <div style={{ padding: '12px 14px', display: 'grid', gap: 4 }}>
        {link.meta.title && <strong style={{ fontSize: 'var(--fs-md)' }}>{link.meta.title}</strong>}
        {link.meta.description && (
          <p className="small muted" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {link.meta.description}
          </p>
        )}
        {healthView && (
          <div className="row" style={{ marginTop: 4 }} title={h.detail ?? undefined}>
            <span className={`pill ${healthView.cls}`}>
              {healthView.icon}
              {healthView.text}
            </span>
            <span className="xsmall muted ellipsis">
              {h.detail} {h.checkedAt ? `· geprüft ${relative(h.checkedAt)}` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const PLATFORMS: { v: 'ios' | 'android' | 'desktop'; label: string }[] = [
  { v: 'ios', label: 'iPhone/iPad' },
  { v: 'android', label: 'Android' },
  { v: 'desktop', label: 'Computer' },
];
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function RoutingEditor({ value, onChange, mainUrl, error }: { value: Routing; onChange: (r: Routing) => void; mainUrl: string; error: FieldError | null }) {
  const errAt = (path: string) => (error?.field === path || error?.field?.startsWith(`${path}.`) ? error.message : null);
  const setRule = (i: number, r: Rule) => onChange({ ...value, rules: value.rules.map((x, j) => (j === i ? r : x)) });
  const setVariant = (i: number, v: Variant) => onChange({ ...value, variants: value.variants.map((x, j) => (j === i ? v : x)) });
  const total = value.mainWeight + value.variants.reduce((s, v) => s + v.weight, 0);
  const pct = (w: number) => (total ? Math.round((w / total) * 100) : 0);

  return (
    <div className="stack" style={{ '--gap': '16px' } as React.CSSProperties}>
      <p className="small muted">Regeln leiten bestimmte Besucher zu einem anderen Ziel, etwa Smartphones in den App-Store oder Aufrufe außerhalb der Bürozeiten auf eine Hinweisseite. Die erste passende Regel gewinnt.</p>
      {error?.field === 'routing' && (
        <span className="error-text" data-field="routing">
          {error.message}
        </span>
      )}
      {value.rules.map((r, i) => (
        <div
          key={r.id}
          className={`panel rule-panel${errAt(`routing.rules.${i}`) ? ' has-error' : ''}`}
          data-field={`routing.rules.${i}`}
          style={{ padding: 12, display: 'grid', gap: 10, background: 'var(--surface-2)' }}
        >
          <div className="row">
            <strong className="small">Regel {i + 1}</strong>
            <input className="input" style={{ minHeight: 30, padding: '4px 8px', fontSize: 'var(--fs-sm)' }} placeholder="Bezeichnung (optional)" value={r.label} onChange={(e) => setRule(i, { ...r, label: e.target.value })} />
            <button type="button" className="btn ghost icon sm" onClick={() => onChange({ ...value, rules: value.rules.filter((_, j) => j !== i) })} aria-label="Regel entfernen">
              <Trash2 />
            </button>
          </div>
          <div className="field">
            <span className="label">Wenn Gerät</span>
            <div className="row wrap" style={{ gap: 6 }}>
              {PLATFORMS.map((p) => {
                const on = r.when.platform?.includes(p.v) ?? false;
                return (
                  <button
                    key={p.v}
                    type="button"
                    className="filter-chip"
                    aria-pressed={on}
                    onClick={() => {
                      const cur = new Set(r.when.platform ?? []);
                      if (on) cur.delete(p.v);
                      else cur.add(p.v);
                      setRule(i, { ...r, when: { ...r.when, platform: cur.size ? [...cur] : undefined } });
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid-2">
            <Field label="und Sprache" hint="Kürzel, z. B. de, en">
              <input
                className="input"
                value={(r.when.language ?? []).join(', ')}
                onChange={(e) => {
                  const langs = e.target.value
                    .toLowerCase()
                    .split(/[\s,]+/)
                    .filter((x) => /^[a-z]{2,3}$/.test(x));
                  setRule(i, { ...r, when: { ...r.when, language: langs.length ? langs : undefined } });
                }}
                placeholder="beliebig"
              />
            </Field>
            <Field label="und Uhrzeit">
              <div className="row">
                <input className="input" type="time" value={r.when.timeFrom ?? ''} onChange={(e) => setRule(i, { ...r, when: { ...r.when, timeFrom: e.target.value || undefined } })} aria-label="Von" />
                <span className="muted">–</span>
                <input className="input" type="time" value={r.when.timeTo ?? ''} onChange={(e) => setRule(i, { ...r, when: { ...r.when, timeTo: e.target.value || undefined } })} aria-label="Bis" />
              </div>
            </Field>
          </div>
          <div className="field">
            <span className="label">und Wochentag</span>
            <div className="row wrap" style={{ gap: 4 }}>
              {WEEKDAYS.map((d, wi) => {
                const on = r.when.weekdays?.includes(wi + 1) ?? false;
                return (
                  <button
                    key={d}
                    type="button"
                    className="filter-chip"
                    style={{ minWidth: 40, justifyContent: 'center' }}
                    aria-pressed={on}
                    onClick={() => {
                      const cur = new Set(r.when.weekdays ?? []);
                      if (on) cur.delete(wi + 1);
                      else cur.add(wi + 1);
                      setRule(i, { ...r, when: { ...r.when, weekdays: cur.size ? [...cur].sort() : undefined } });
                    }}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid-2">
            <Field label="und ab Datum">
              <input className="input" type="datetime-local" value={toLocalInput(r.when.dateFrom)} onChange={(e) => setRule(i, { ...r, when: { ...r.when, dateFrom: fromLocalInput(e.target.value) ?? undefined } })} />
            </Field>
            <Field label="bis Datum">
              <input className="input" type="datetime-local" value={toLocalInput(r.when.dateTo)} onChange={(e) => setRule(i, { ...r, when: { ...r.when, dateTo: fromLocalInput(e.target.value) ?? undefined } })} />
            </Field>
          </div>
          <Field label="dann weiter zu">
            <input
              className="input mono"
              data-field={`routing.rules.${i}.url`}
              value={r.url}
              onChange={(e) => setRule(i, { ...r, url: e.target.value })}
              placeholder="https://…"
              spellCheck={false}
              aria-invalid={Boolean(errAt(`routing.rules.${i}.url`)) || undefined}
            />
          </Field>
          {errAt(`routing.rules.${i}`) && <span className="error-text">{errAt(`routing.rules.${i}`)}</span>}
        </div>
      ))}
      <button type="button" className="btn sm" style={{ justifySelf: 'start' }} onClick={() => onChange({ ...value, rules: [...value.rules, { id: rid(), label: '', url: '', when: {} }] })}>
        <Plus /> Regel hinzufügen
      </button>

      <hr className="divider" />
      <p className="small muted">Varianten verteilen alle übrigen Besucher zufällig nach Gewicht auf mehrere Ziele, etwa für einen A/B-Vergleich. Die Statistik zeigt, wie oft jede Variante gewählt wurde.</p>
      {value.variants.length > 0 && (
        <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
          <div className="row">
            <span className="small ellipsis" style={{ flex: 1 }}>
              Hauptziel <span className="mono muted">{mainUrl}</span>
            </span>
            <input type="range" min={0} max={100} value={value.mainWeight} onChange={(e) => onChange({ ...value, mainWeight: Number(e.target.value) })} aria-label="Gewicht Hauptziel" style={{ accentColor: 'var(--focus)' }} />
            <span className="num small" style={{ width: 40, textAlign: 'right' }}>
              {pct(value.mainWeight)} %
            </span>
          </div>
          {value.variants.map((v, i) => (
            <div key={v.id} className="row wrap variant-row" data-field={`routing.variants.${i}`}>
              <input
                className="input mono"
                style={{ flex: 1 }}
                data-field={`routing.variants.${i}.url`}
                aria-invalid={Boolean(errAt(`routing.variants.${i}`)) || undefined}
                aria-label={`Ziel Variante ${i + 1}`}
                value={v.url}
                onChange={(e) => setVariant(i, { ...v, url: e.target.value })}
                placeholder="https://… Variante"
                spellCheck={false}
              />
              <input type="range" min={0} max={100} value={v.weight} onChange={(e) => setVariant(i, { ...v, weight: Number(e.target.value) })} aria-label={`Gewicht Variante ${i + 1}`} style={{ accentColor: 'var(--focus)' }} />
              <span className="num small" style={{ width: 40, textAlign: 'right' }}>
                {pct(v.weight)} %
              </span>
              <button type="button" className="btn ghost icon sm" onClick={() => onChange({ ...value, variants: value.variants.filter((_, j) => j !== i) })} aria-label="Variante entfernen">
                <Trash2 />
              </button>
              {errAt(`routing.variants.${i}`) && <span className="error-text variant-error">{errAt(`routing.variants.${i}`)}</span>}
            </div>
          ))}
        </div>
      )}
      {value.variants.length < 5 && (
        <button
          type="button"
          className="btn sm"
          style={{ justifySelf: 'start' }}
          onClick={() => onChange({ ...value, variants: [...value.variants, { id: rid(), label: '', url: '', weight: 50 }] })}
        >
          <Plus /> Variante hinzufügen
        </button>
      )}
    </div>
  );
}
