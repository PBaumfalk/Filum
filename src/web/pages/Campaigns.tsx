import { useQueryClient } from '@tanstack/react-query';
import { Archive, BarChart3, Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { useToast } from '../components/toast';
import { Empty, Field, Skeleton } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { date, num } from '../lib/format';
import { can, useCampaigns, useSession } from '../lib/queries';
import { useDocumentTitle } from '../lib/title';
import type { Campaign, Color } from '../lib/types';

/** Vorschlag für utm_campaign aus dem Namen: „Herbst-Newsletter 2026“ → „herbst-newsletter-2026“. */
export function utmSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

export const COLORS: { v: Color; label: string }[] = [
  { v: 'amber', label: 'Bernstein' },
  { v: 'moss', label: 'Moos' },
  { v: 'teal', label: 'Petrol' },
  { v: 'indigo', label: 'Indigo' },
  { v: 'plum', label: 'Pflaume' },
  { v: 'rust', label: 'Rost' },
  { v: 'slate', label: 'Schiefer' },
  // Gedämpftes Beerenrot; das Karmin des roten Fadens bleibt der Hauptaktion vorbehalten.
  { v: 'crimson', label: 'Beere' },
];

type Form = {
  name: string;
  color: Color;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  startsAt: string;
  endsAt: string;
  description: string;
};

const empty: Form = { name: '', color: 'indigo', utm_source: '', utm_medium: '', utm_campaign: '', utm_term: '', utm_content: '', startsAt: '', endsAt: '', description: '' };

export function ColorPicker({ value, onChange }: { value: Color; onChange: (c: Color) => void }) {
  return (
    <div className="swatch-row" role="radiogroup" aria-label="Farbe">
      {COLORS.map((c) => (
        <button
          key={c.v}
          type="button"
          className="swatch"
          data-color={c.v}
          style={{ background: 'var(--tc)' }}
          aria-pressed={value === c.v}
          aria-label={c.label}
          title={c.label}
          onClick={() => onChange(c.v)}
        />
      ))}
    </div>
  );
}

export function CampaignsPage() {
  const campaigns = useCampaigns();
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const editor = can(session.data?.user?.role, 'editor');
  /** utm_campaign folgt dem Namen, bis jemand das Feld selbst ändert. */
  const [utmAuto, setUtmAuto] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);
  useDocumentTitle('Kampagnen');

  const open = (c?: Campaign) => {
    setError(null);
    setEditing(c ? c.id : 'new');
    setUtmAuto(!c || !c.utm.utm_campaign || c.utm.utm_campaign === utmSlug(c.name));
    setForm(
      c
        ? {
            name: c.name,
            color: c.color,
            utm_source: c.utm.utm_source ?? '',
            utm_medium: c.utm.utm_medium ?? '',
            utm_campaign: c.utm.utm_campaign ?? '',
            utm_term: c.utm.utm_term ?? '',
            utm_content: c.utm.utm_content ?? '',
            startsAt: c.startsAt?.slice(0, 10) ?? '',
            endsAt: c.endsAt?.slice(0, 10) ?? '',
            description: c.description,
          }
        : { ...empty },
    );
  };

  const save = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError({ field: 'name', message: 'Bitte geben Sie der Kampagne einen Namen.' });
      nameRef.current?.focus();
      return;
    }
    if (form.startsAt && form.endsAt && form.endsAt < form.startsAt) {
      setError({ field: 'endsAt', message: 'Das Ende liegt vor dem Beginn.' });
      return;
    }
    const body = {
      ...form,
      startsAt: form.startsAt ? new Date(`${form.startsAt}T00:00:00`).toISOString() : null,
      endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59`).toISOString() : null,
    };
    try {
      if (editing === 'new') await api.post('/api/v1/campaigns', body);
      else await api.patch(`/api/v1/campaigns/${editing}`, body);
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      void qc.invalidateQueries({ queryKey: ['links'] });
      toast.ok(editing === 'new' ? 'Kampagne angelegt' : 'Kampagne gespeichert');
      setEditing(null);
    } catch (e) {
      setError(e instanceof ApiError ? { message: e.message, field: e.field } : { message: 'Speichern fehlgeschlagen' });
    }
  };

  const archive = async (c: Campaign, archived: boolean) => {
    try {
      await api.patch(`/api/v1/campaigns/${c.id}`, { archived });
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.ok(archived ? 'Kampagne archiviert' : 'Kampagne wieder aktiv');
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async (c: Campaign) => {
    try {
      await api.del(`/api/v1/campaigns/${c.id}`);
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      void qc.invalidateQueries({ queryKey: ['links'] });
      toast.ok('Kampagne gelöscht; ihre Links bleiben erhalten');
      setEditing(null);
    } catch (e) {
      toast.error(e);
    }
  };

  const items = (campaigns.data?.items ?? []).filter((c) => showArchived || !c.archived);
  const archivedCount = (campaigns.data?.items ?? []).filter((c) => c.archived).length;
  const f = (k: keyof Form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((x) => ({ ...x, [k]: e.target.value })) });

  const formPanel = (
    <form
      className="panel panel-pad stack"
      style={{ '--gap': '14px', marginBottom: 16 } as React.CSSProperties}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2>{editing === 'new' ? 'Neue Kampagne' : 'Kampagne bearbeiten'}</h2>
      <div className="grid-2">
        <Field label="Name" error={error?.field === 'name' ? error.message : null}>
          <input
            ref={nameRef}
            className="input"
            autoFocus
            value={form.name}
            onChange={(e) => {
              const name = e.target.value;
              setForm((x) => ({ ...x, name, ...(utmAuto ? { utm_campaign: utmSlug(name) } : {}) }));
              if (error?.field === 'name') setError(null);
            }}
            placeholder="z. B. Herbst-Newsletter 2026"
            aria-required
            aria-invalid={error?.field === 'name' || undefined}
          />
        </Field>
        <Field label="Farbe">
          <ColorPicker value={form.color} onChange={(c) => setForm((x) => ({ ...x, color: c }))} />
        </Field>
      </div>
      <p className="small muted">Diese Parameter hängt Filum bei jedem Aufruf an das Ziel aller Links der Kampagne an. So erkennt Ihre Web-Analyse, woher Besucher kamen.</p>
      <div className="grid-3">
        <Field label="Quelle (utm_source)">
          <input className="input" {...f('utm_source')} placeholder="z. B. newsletter" />
        </Field>
        <Field label="Medium (utm_medium)">
          <input className="input" {...f('utm_medium')} placeholder="z. B. email" />
        </Field>
        <Field label="Kampagne (utm_campaign)" hint={utmAuto && form.utm_campaign ? 'Aus dem Namen vorgeschlagen' : undefined}>
          <input
            className="input"
            value={form.utm_campaign}
            onChange={(e) => {
              setUtmAuto(e.target.value === '');
              setForm((x) => ({ ...x, utm_campaign: e.target.value }));
            }}
            placeholder="z. B. herbst-2026"
          />
        </Field>
        <Field label="Begriff (utm_term)">
          <input className="input" {...f('utm_term')} placeholder="z. B. fristenrechner" />
        </Field>
        <Field label="Inhalt (utm_content)">
          <input className="input" {...f('utm_content')} placeholder="z. B. button-oben" />
        </Field>
      </div>
      <div className="grid-3">
        <Field label="Läuft von">
          <input className="input" type="date" {...f('startsAt')} />
        </Field>
        <Field label="bis" error={error?.field === 'endsAt' ? error.message : null}>
          <input className="input" type="date" {...f('endsAt')} />
        </Field>
      </div>
      <Field label="Beschreibung">
        <textarea className="textarea" rows={2} {...f('description')} placeholder="z. B. Versand am 15. Oktober an die Newsletter-Liste" />
      </Field>
      {error && !['name', 'endsAt'].includes(error.field ?? '') && <div className="callout danger">{error.message}</div>}
      <div className="row">
        <button className="btn primary" type="submit">
          Speichern
        </button>
        <button className="btn" type="button" onClick={() => setEditing(null)}>
          Abbrechen
        </button>
        <span className="spacer" />
        {editing !== 'new' && editing !== null && (
          <button className="btn ghost danger" type="button" onClick={() => void remove(campaigns.data!.items.find((c) => c.id === editing)!)}>
            <Trash2 /> Löschen
          </button>
        )}
      </div>
    </form>
  );

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Kampagnen</h1>
            <p>Bündeln Links einer Aktion, hängen einheitliche UTM-Parameter an und machen Erfolge vergleichbar.</p>
          </div>
          <span className="spacer" />
          {editor && editing === null && (
            <button className="btn primary" onClick={() => open()}>
              <Plus /> Neue Kampagne
            </button>
          )}
        </div>

        {editing !== null && formPanel}

        {campaigns.isLoading && <Skeleton h={120} />}
        {campaigns.data && items.length === 0 && editing === null && (
          <div className="panel">
            <Empty
              title="Noch keine Kampagnen"
              action={
                editor ? (
                  <button className="btn primary" onClick={() => open()}>
                    <Plus /> Erste Kampagne anlegen
                  </button>
                ) : undefined
              }
            >
              Eine Kampagne ist zum Beispiel ein Newsletter, eine Messe oder eine Plakataktion. Links darin bekommen automatisch die passenden Kampagnenparameter.
            </Empty>
          </div>
        )}

        <div className="stat-grid">
          {items.map((c) => (
            <article key={c.id} className="panel span-6" style={{ opacity: c.archived ? 0.7 : 1 }}>
              <div style={{ padding: '18px 20px', display: 'grid', gap: 10 }}>
                <div className="row">
                  <span className="nav-dot" data-color={c.color} style={{ width: 10, height: 10, margin: 0 }} />
                  <h2 className="ellipsis" style={{ flex: 1 }}>
                    {c.name}
                  </h2>
                  {c.archived && <span className="pill">Archiviert</span>}
                  {editor && (
                    <button className="btn ghost icon sm" onClick={() => open(c)} aria-label={`${c.name} bearbeiten`}>
                      <Pencil />
                    </button>
                  )}
                </div>
                {c.description && <p className="small muted">{c.description}</p>}
                <div className="row" style={{ gap: 24 }}>
                  <div>
                    <div className="xsmall muted">Links</div>
                    <strong className="num" style={{ fontSize: 'var(--fs-lg)' }}>
                      {num(c.links)}
                    </strong>
                  </div>
                  <div>
                    <div className="xsmall muted">Aufrufe gesamt</div>
                    <strong className="num" style={{ fontSize: 'var(--fs-lg)' }}>
                      {num(c.clicks)}
                    </strong>
                  </div>
                  {(c.startsAt || c.endsAt) && (
                    <div>
                      <div className="xsmall muted">Zeitraum</div>
                      <span className="small">
                        {date(c.startsAt)} – {date(c.endsAt)}
                      </span>
                    </div>
                  )}
                </div>
                {Object.values(c.utm).some(Boolean) && (
                  <div className="row wrap" style={{ gap: 4 }}>
                    {Object.entries(c.utm)
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <span key={k} className="pill mono" style={{ fontWeight: 500 }}>
                          {k.replace('utm_', '')}={v}
                        </span>
                      ))}
                  </div>
                )}
                <div className="row wrap" style={{ marginTop: 4 }}>
                  <RouterLink className="btn sm" to={`/?campaignId=${c.id}`}>
                    <Link2 /> Links
                  </RouterLink>
                  <RouterLink className="btn sm" to={`/analyse?campaignId=${c.id}`}>
                    <BarChart3 /> Analyse
                  </RouterLink>
                  <span className="spacer" />
                  {editor && (
                    <button className="btn sm ghost" onClick={() => void archive(c, !c.archived)}>
                      <Archive /> {c.archived ? 'Reaktivieren' : 'Archivieren'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
        {archivedCount > 0 && (
          <button className="btn ghost sm" style={{ marginTop: 14 }} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Archivierte ausblenden' : `${archivedCount} archivierte anzeigen`}
          </button>
        )}
      </div>
    </div>
  );
}
