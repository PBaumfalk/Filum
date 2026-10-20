import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ColorPicker } from '../Campaigns';
import { useToast } from '../../components/toast';
import { Empty, Field, TagChip } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { can, useCampaigns, useCollections, useDomains, usePresets, useSession, useTags } from '../../lib/queries';
import type { Color, Preset } from '../../lib/types';
import { SectionTitle } from './common';

export function Organize() {
  const session = useSession();
  const role = session.data?.user?.role;
  return (
    <div>
      <CollectionsBlock editor={can(role, 'editor')} />
      <TagsBlock editor={can(role, 'editor')} />
      <PresetsBlock member={can(role, 'member')} />
    </div>
  );
}

function CollectionsBlock({ editor }: { editor: boolean }) {
  const collections = useCollections();
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<{ id: number | null; name: string; color: Color; description: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!edit) return;
    setError(null);
    try {
      if (edit.id) await api.patch(`/api/v1/collections/${edit.id}`, { name: edit.name, color: edit.color, description: edit.description });
      else await api.post('/api/v1/collections', { name: edit.name, color: edit.color, description: edit.description });
      void qc.invalidateQueries({ queryKey: ['collections'] });
      void qc.invalidateQueries({ queryKey: ['links'] });
      setEdit(null);
      toast.ok('Sammlung gespeichert');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Fehler');
    }
  };

  return (
    <>
      <SectionTitle title="Sammlungen">Wie Ordner: Jeder Link gehört höchstens einer Sammlung an, etwa „Mandanten-Infos“ oder „Formulare“. Sammlungen erscheinen in der Seitenleiste.</SectionTitle>
      {edit && (
        <form
          className="panel panel-pad stack"
          style={{ '--gap': '12px', marginBottom: 12 } as React.CSSProperties}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid-2">
            <Field label="Name" error={error}>
              <input className="input" autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
            </Field>
            <Field label="Farbe">
              <ColorPicker value={edit.color} onChange={(c) => setEdit({ ...edit, color: c })} />
            </Field>
          </div>
          <Field label="Beschreibung">
            <input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          </Field>
          <div className="row">
            <button className="btn primary">Speichern</button>
            <button type="button" className="btn" onClick={() => setEdit(null)}>
              Abbrechen
            </button>
          </div>
        </form>
      )}
      <div className="panel">
        {collections.data?.items.length === 0 && <Empty title="Noch keine Sammlungen" art={false} />}
        {collections.data?.items.map((c) => (
          <div key={c.id} className="setting-row" style={{ alignItems: 'center' }}>
            <div className="row">
              <span className="nav-dot" data-color={c.color} style={{ width: 10, height: 10 }} />
              <div>
                <h3>{c.name}</h3>
                {c.description && <p>{c.description}</p>}
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <span className="small muted">{c.count} Links</span>
              {editor && (
                <>
                  <button className="btn sm ghost icon" onClick={() => setEdit({ id: c.id, name: c.name, color: c.color, description: c.description ?? '' })} aria-label={`${c.name} bearbeiten`}>
                    <Pencil />
                  </button>
                  <button
                    className="btn sm ghost icon"
                    aria-label={`${c.name} löschen`}
                    onClick={async () => {
                      try {
                        await api.del(`/api/v1/collections/${c.id}`);
                        void qc.invalidateQueries({ queryKey: ['collections'] });
                        void qc.invalidateQueries({ queryKey: ['links'] });
                        toast.ok('Sammlung gelöscht; die Links bleiben erhalten');
                      } catch (e) {
                        toast.error(e);
                      }
                    }}
                  >
                    <Trash2 />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {editor && !edit && (
        <button className="btn" style={{ marginTop: 10 }} onClick={() => setEdit({ id: null, name: '', color: 'indigo', description: '' })}>
          <Plus /> Neue Sammlung
        </button>
      )}
    </>
  );
}

function TagsBlock({ editor }: { editor: boolean }) {
  const tags = useTags();
  const qc = useQueryClient();
  const toast = useToast();
  const [rename, setRename] = useState<{ id: number; name: string; color: Color } | null>(null);
  const save = async () => {
    if (!rename) return;
    try {
      await api.patch(`/api/v1/tags/${rename.id}`, { name: rename.name, color: rename.color });
      void qc.invalidateQueries({ queryKey: ['tags'] });
      void qc.invalidateQueries({ queryKey: ['links'] });
      setRename(null);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <>
      <SectionTitle title="Schlagwörter">Ein Link kann viele Schlagwörter tragen. Sie entstehen beim Bearbeiten eines Links; hier lassen sie sich umbenennen, einfärben oder entfernen.</SectionTitle>
      <div className="panel panel-pad">
        {tags.data?.items.length === 0 && <p className="muted small">Noch keine Schlagwörter.</p>}
        <div className="row wrap" style={{ gap: 8 }}>
          {tags.data?.items.map((t) =>
            rename?.id === t.id ? (
              <form
                key={t.id}
                className="row wrap"
                style={{ width: '100%' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <input className="input" style={{ maxWidth: 220 }} autoFocus value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} />
                <ColorPicker value={rename.color} onChange={(c) => setRename({ ...rename, color: c })} />
                <button className="btn sm primary">Speichern</button>
                <button
                  type="button"
                  className="btn sm ghost danger"
                  onClick={async () => {
                    await api.del(`/api/v1/tags/${t.id}`).catch((e) => toast.error(e));
                    void qc.invalidateQueries({ queryKey: ['tags'] });
                    void qc.invalidateQueries({ queryKey: ['links'] });
                    setRename(null);
                  }}
                >
                  <Trash2 /> Entfernen
                </button>
                <button type="button" className="btn sm ghost" onClick={() => setRename(null)}>
                  Abbrechen
                </button>
              </form>
            ) : (
              <button
                key={t.id}
                type="button"
                className="btn sm ghost"
                style={{ padding: 2 }}
                onClick={() => editor && setRename({ id: t.id, name: t.name, color: t.color })}
                disabled={!editor}
                title={editor ? 'Bearbeiten' : undefined}
              >
                <TagChip name={`${t.name} · ${t.count ?? 0}`} color={t.color} />
              </button>
            ),
          )}
        </div>
      </div>
    </>
  );
}

function PresetsBlock({ member }: { member: boolean }) {
  const presets = usePresets();
  const domains = useDomains();
  const collections = useCollections();
  const campaigns = useCampaigns();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<null | { name: string; settings: Preset['settings']; tags: string }>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!form) return;
    setError(null);
    try {
      const settings = { ...form.settings, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) };
      await api.post('/api/v1/presets', { name: form.name, settings });
      void qc.invalidateQueries({ queryKey: ['presets'] });
      setForm(null);
      toast.ok('Vorlage gespeichert. Sie steht jetzt beim Anlegen von Links zur Auswahl.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Fehler');
    }
  };

  const describe = (p: Preset) => {
    const s = p.settings;
    const parts: string[] = [];
    if (s.domainId) parts.push(domains.data?.items.find((d) => d.id === s.domainId)?.host ?? 'Domain');
    if (s.campaignId) parts.push(`Kampagne ${campaigns.data?.items.find((c) => c.id === s.campaignId)?.name ?? ''}`);
    if (s.collectionId) parts.push(`Sammlung ${collections.data?.items.find((c) => c.id === s.collectionId)?.name ?? ''}`);
    if (s.tags?.length) parts.push(s.tags.map((t) => `#${t}`).join(' '));
    if (s.expiresInDays) parts.push(`läuft nach ${s.expiresInDays} Tagen ab`);
    if (s.protected) parts.push('geschützt');
    if (s.slugStyle === 'readable') parts.push('lesbare Adresse');
    if (s.redirectType && s.redirectType !== 302) parts.push(String(s.redirectType));
    return parts.join(' · ') || 'Standardwerte';
  };

  return (
    <>
      <SectionTitle title="Vorlagen">Wiederkehrende Einstellungen für neue Links, z. B. „Flyer“ mit Domain, Kampagne, Schutz und lesbarer Kurzadresse. Auswahl direkt im Eingabefeld.</SectionTitle>
      {form && (
        <form
          className="panel panel-pad stack"
          style={{ '--gap': '12px', marginBottom: 12 } as React.CSSProperties}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid-2">
            <Field label="Name" error={error}>
              <input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="z. B. Flyer" />
            </Field>
            <Field label="Domain">
              <select className="select" value={form.settings.domainId ?? ''} onChange={(e) => setForm({ ...form, settings: { ...form.settings, domainId: e.target.value ? Number(e.target.value) : undefined } })}>
                <option value="">Standard</option>
                {domains.data?.items
                  .filter((d) => d.status === 'active')
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.host}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Kampagne">
              <select className="select" value={form.settings.campaignId ?? ''} onChange={(e) => setForm({ ...form, settings: { ...form.settings, campaignId: e.target.value ? Number(e.target.value) : null } })}>
                <option value="">Keine</option>
                {campaigns.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Sammlung">
              <select className="select" value={form.settings.collectionId ?? ''} onChange={(e) => setForm({ ...form, settings: { ...form.settings, collectionId: e.target.value ? Number(e.target.value) : null } })}>
                <option value="">Keine</option>
                {collections.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Schlagwörter" hint="Kommagetrennt">
              <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            </Field>
            <Field label="Ablauf nach (Tagen)">
              <input
                className="input"
                type="number"
                min={1}
                value={form.settings.expiresInDays ?? ''}
                onChange={(e) => setForm({ ...form, settings: { ...form.settings, expiresInDays: e.target.value ? Number(e.target.value) : null } })}
                placeholder="kein Ablauf"
              />
            </Field>
          </div>
          <div className="row wrap" style={{ gap: 16 }}>
            <label className="check">
              <input type="checkbox" checked={form.settings.slugStyle === 'readable'} onChange={(e) => setForm({ ...form, settings: { ...form.settings, slugStyle: e.target.checked ? 'readable' : undefined } })} />
              Lesbare Kurzadresse
            </label>
            <label className="check">
              <input type="checkbox" checked={Boolean(form.settings.protected)} onChange={(e) => setForm({ ...form, settings: { ...form.settings, protected: e.target.checked } })} />
              Als verteilt schützen
            </label>
          </div>
          <div className="row">
            <button className="btn primary">Vorlage speichern</button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              Abbrechen
            </button>
          </div>
        </form>
      )}
      <div className="panel">
        {presets.data?.items.length === 0 && <Empty title="Noch keine Vorlagen" art={false} />}
        {presets.data?.items.map((p) => (
          <div key={p.id} className="setting-row" style={{ alignItems: 'center' }}>
            <div>
              <h3>{p.name}</h3>
              <p>{describe(p)}</p>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              {member && (
                <button
                  className="btn sm ghost icon"
                  aria-label={`${p.name} löschen`}
                  onClick={async () => {
                    try {
                      await api.del(`/api/v1/presets/${p.id}`);
                      void qc.invalidateQueries({ queryKey: ['presets'] });
                    } catch (e) {
                      toast.error(e);
                    }
                  }}
                >
                  <Trash2 />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {member && !form && (
        <button className="btn" style={{ marginTop: 10 }} onClick={() => setForm({ name: '', settings: {}, tags: '' })}>
          <Plus /> Neue Vorlage
        </button>
      )}
    </>
  );
}
